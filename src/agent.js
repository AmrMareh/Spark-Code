import readline from 'readline';
import path from 'path';
import fs from 'fs';
import {
  c, printSection, printTool, printError, printSuccess,
  printInfo, printHelp, startSpinner, stopSpinner,
  promptLine, startStarField, stopStarField,
} from './ui.js';
import { callAI, parseToolCall, isToolOnly } from './ai.js';
import { dispatchTool, summarizeWork } from './tools.js';
import {
  createAgentSession, logMessage, logBuild,
  closeAgentSession, fetchBuilds, getCurrentUser,
} from './supabase.js';

// ─── Session state ────────────────────────────────────────────────────────────
let cwd         = process.cwd();
let history     = [];           // { role, content }[]
let toolHistory = [];           // raw tool calls for build logging
let sessionId   = null;
let userId      = null;
let currentModel = 'claude';
let messageCount = 0;
let filesTouched = new Set();
let commandsRun  = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
export async function initSession() {
  const user = await getCurrentUser();
  userId = user?.id || null;

  sessionId = await createAgentSession({
    userId,
    model: 'spark-code-1.2',
    cwd,
  });

  printInfo(`Session started${sessionId ? ' · saved to Spark DB' : ' · (offline mode)'}`);
  if (userId) printInfo(`User: ${user.email}`);
  printInfo(`Model: ${c.spark('Spark Code 1.2')}  ${c.muted('(auto-routing enabled)')}`);
  printInfo(`Working dir: ${c.code(cwd)}`);
  console.log();
}

// ─── Slash commands ───────────────────────────────────────────────────────────
async function handleCommand(input) {
  const parts = input.trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase();

  switch (cmd) {
    case '/help': printHelp(); return true;

    case '/clear':
      process.stdout.write('\x1Bc');
      return true;

    case '/cd': {
      const target = parts.slice(1).join(' ') || process.env.HOME;
      const resolved = path.resolve(cwd, target);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        cwd = resolved;
        printSuccess(`Now in ${cwd}`);
      } else {
        printError(`Directory not found: ${resolved}`);
      }
      return true;
    }

    case '/ls': {
      const target = path.resolve(cwd, parts[1] || '.');
      try {
        const entries = fs.readdirSync(target, { withFileTypes: true });
        entries.filter(e => !e.name.startsWith('.')).forEach(e => {
          if (e.isDirectory()) console.log('  ' + c.code('📁 ' + e.name + '/'));
          else console.log('  ' + c.muted('📄 ' + e.name));
        });
      } catch (e) {
        printError(e.message);
      }
      return true;
    }

    case '/history': {
      printSection('Conversation history');
      history.slice(-20).forEach(msg => {
        const role = msg.role === 'user'
          ? c.user('you')
          : c.spark('spark');
        const preview = msg.content.slice(0, 120).replace(/\n/g, ' ');
        console.log(`  ${role}: ${c.muted(preview)}`);
      });
      return true;
    }

    case '/builds': {
      printSection('Your builds in Spark DB');
      const builds = await fetchBuilds(userId, 10);
      if (builds.length === 0) {
        printInfo('No builds recorded yet.');
      } else {
        builds.forEach((b, i) => {
          const date = new Date(b.built_at).toLocaleString();
          console.log(`  ${c.star((i + 1) + '.')} ${c.white.bold(b.description || 'Untitled build')}`);
          console.log(`     ${c.muted(date + ' · ' + b.working_dir)}`);
          if (b.files_touched?.length) {
            console.log(`     ${c.code('Files: ' + b.files_touched.slice(0, 5).join(', '))}`);
          }
          console.log();
        });
      }
      return true;
    }

    case '/exit':
    case 'exit':
    case 'q':
    case 'quit':
      return 'exit';

    default:
      return false;
  }
}

// ─── Detect multi-step tasks (to trigger planning mode) ──────────────────────
function looksComplex(input) {
  const kw = ['build', 'create', 'app', 'refactor', 'migrate', 'add', 'implement',
               'setup', 'integrate', 'convert', 'update all', 'fix all'];
  const lower = input.toLowerCase();
  return kw.some(k => lower.includes(k));
}

// ─── Print a clean build summary table ───────────────────────────────────────
function printBuildSummary(touched, cmds) {
  if (touched.size === 0 && cmds.length === 0) return;
  printSection('Build summary');
  if (touched.size > 0) {
    console.log('  ' + c.muted('Files:'));
    [...touched].forEach(f => console.log('    ' + c.success('✔ ') + c.code(f)));
  }
  if (cmds.length > 0) {
    console.log('  ' + c.muted('Commands run:'));
    cmds.forEach(cmd => console.log('    ' + c.warn('⚡ ') + c.muted(cmd)));
  }
  console.log();
}

// ─── Agentic turn (AI → tools → AI loop) ─────────────────────────────────────
async function agentTurn(userInput) {
  messageCount++;

  history.push({ role: 'user', content: userInput });
  await logMessage({ sessionId, role: 'user', content: userInput });

  console.log();

  // For complex tasks, inject a planning nudge
  const augmented = [...history];
  if (looksComplex(userInput) && history.filter(m => m.role === 'user').length === 1) {
    augmented[augmented.length - 1] = {
      role: 'user',
      content: userInput + '\n\n[Start with a numbered plan, then execute each step with tools. Finish the entire task before responding.]',
    };
  }

  let loopCount = 0;
  const MAX_LOOPS = 30;
  const sessionFilesTouched = new Set();
  const sessionCmds = [];

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    // Stream the AI response (callAI prints the routed engine label itself)
    let aiResponse;
    try {
      aiResponse = await callAI(loopCount === 1 ? augmented : history, cwd);
    } catch (e) {
      printError(`AI error: ${e.message}`);
      return;
    }

    history.push({ role: 'assistant', content: aiResponse });
    await logMessage({ sessionId, role: 'assistant', content: aiResponse });

    // Check for a tool call
    const toolCall = parseToolCall(aiResponse);
    if (!toolCall) break;

    // Execute the tool
    toolHistory.push(toolCall);
    const result = await dispatchTool(toolCall, cwd);

    // Track for DB + summary
    if (['write_file', 'create_file', 'patch_file', 'move_file'].includes(toolCall.tool)) {
      const p = toolCall.params?.path || toolCall.params?.to;
      if (p) { sessionFilesTouched.add(p); filesTouched.add(p); }
    }
    if (toolCall.tool === 'run_command') {
      sessionCmds.push(toolCall.params?.cmd);
      commandsRun.push(toolCall.params?.cmd);
    }

    const toolMsg = result.success
      ? `Tool result (${toolCall.tool}):\n${result.data}`
      : `Tool error (${toolCall.tool}): ${result.error}`;

    history.push({ role: 'user', content: toolMsg });

    if (!isToolOnly(aiResponse)) {
      console.log(c.dim('  ─'.repeat(20)));
      console.log();
    }
  }

  if (loopCount >= MAX_LOOPS) {
    printWarn('Reached maximum tool steps (30). Stopping.');
  }

  // Print build summary if files were touched this turn
  printBuildSummary(sessionFilesTouched, sessionCmds);

  // Log to DB
  if (filesTouched.size > 0) {
    await logBuild({
      sessionId,
      userId,
      description: userInput.slice(0, 120),
      filesTouched: [...filesTouched],
      commandsRun,
      cwd,
    });
    filesTouched.clear();
    commandsRun = [];
  }
}

// ─── REPL ─────────────────────────────────────────────────────────────────────
export async function runREPL() {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
  });

  // Enable readline history (up-arrow)
  rl.on('close', () => process.exit(0));

  const ask = () => {
    const prompt = promptLine(cwd);
    rl.question(prompt, async (input) => {
      input = input.trim();
      if (!input) return ask();

      const result = await handleCommand(input);

      if (result === 'exit') {
        await closeAgentSession(sessionId, {
          messageCount,
          filesTouched: [...filesTouched],
          commandsRun,
        });
        console.log('\n' + c.star('  ✦ ') + c.spark.bold('Goodbye! Stay sparked. ✦') + '\n');
        stopStarField();
        rl.close();
        return;
      }

      if (result === false) {
        // Not a slash command — treat as AI message
        await agentTurn(input);
      }

      ask();
    });
  };

  ask();
}
