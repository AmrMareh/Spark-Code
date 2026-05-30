import readline from 'readline';
import path from 'path';
import fs from 'fs';
import {
  c, printSection, printTool, printError, printSuccess,
  printInfo, printWarn, printHelp, startSpinner, stopSpinner,
  promptLine, startStarField, stopStarField,
} from './ui.js';
import { callAI, parseToolCall, isToolOnly } from './ai.js';
import { logout, loadAuth } from './auth.js';
import { dispatchTool, summarizeWork } from './tools.js';
import {
  createAgentSession, logMessage, logBuild,
  closeAgentSession, fetchBuilds, getCurrentUser,
} from './supabase.js';

// ─── Strip tool blocks from untrusted content to prevent prompt injection ─────
function sanitizeToolResult(text) {
  return text.replace(/```tool[\s\S]*?```/g, '[tool block removed]');
}

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
    model: 'okran-code-1.3',
    cwd,
  });

  printInfo(`Session started${sessionId ? ' · saved to Okran DB' : ' · (offline mode)'}`);
  if (userId) printInfo(`User: ${user.email}`);
  printInfo(`Model: ${c.spark('Okran Code 1.3')}  ${c.muted('(auto-routing enabled)')}`);
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
          : c.spark('okran');
        const preview = msg.content.slice(0, 120).replace(/\n/g, ' ');
        console.log(`  ${role}: ${c.muted(preview)}`);
      });
      return true;
    }

    case '/builds': {
      printSection('Your builds in Okran DB');
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

    case '/open': {
      const target = parts.slice(1).join(' ');
      if (!target) { printError('Usage: /open <file>'); return true; }
      const abs = path.resolve(cwd, target);
      if (!fs.existsSync(abs)) { printError(`Not found: ${abs}`); return true; }
      try {
        const { execFileSync } = await import('child_process');
        const editor = process.env.EDITOR || process.env.VISUAL;
        if (editor) {
          execFileSync(editor, [abs], { stdio: 'inherit' });
        } else {
          const platform = process.platform;
          if (platform === 'darwin')     execFileSync('open',     [abs]);
          else if (platform === 'win32') execFileSync('cmd',      ['/c', 'start', '', abs]);
          else                           execFileSync('xdg-open', [abs]);
        }
      } catch (e) { printError(`Could not open file: ${e.message}`); }
      return true;
    }

    case '/run': {
      const file = parts.slice(1).join(' ');
      if (!file) { printError('Usage: /run <file>'); return true; }
      const abs = path.resolve(cwd, file);
      if (!fs.existsSync(abs)) { printError(`Not found: ${abs}`); return true; }
      const ext = path.extname(file);
      const runners = { '.js': 'node', '.ts': 'npx ts-node', '.py': 'python3', '.sh': 'bash', '.rb': 'ruby' };
      const runner = runners[ext];
      if (!runner) { printError(`No runner known for ${ext} files`); return true; }
      const { execSync } = await import('child_process');
      try {
        const out = execSync(`${runner} "${abs}"`, { cwd, encoding: 'utf8', timeout: 120000 });
        console.log(c.muted('  ┌─ output ──────────────────────────'));
        out.split('\n').slice(0, 60).forEach(l => console.log(c.muted('  │ ') + l));
        console.log(c.muted('  └──────────────────────────────────'));
      } catch (e) {
        printError(`Run failed: ${e.message.split('\n')[0]}`);
        if (e.stdout || e.stderr) console.log(c.error((e.stdout + e.stderr).slice(0, 1000)));
      }
      return true;
    }

    case '/logout':
      await logout();
      process.exit(0);

    case '/whoami': {
      const auth = loadAuth();
      if (auth) printInfo(`Signed in as ${c.spark(auth.email)}`);
      else printInfo('Not signed in');
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

// ─── User confirmation for destructive tools ──────────────────────────────────
function confirmDestructive(rl, toolCall) {
  const DESTRUCTIVE = ['run_command', 'delete_file'];
  if (!DESTRUCTIVE.includes(toolCall.tool)) return Promise.resolve(true);

  const label = toolCall.tool === 'run_command'
    ? `run: ${c.warn(toolCall.params?.cmd)}`
    : `delete: ${c.error(toolCall.params?.path)}`;

  return new Promise(resolve => {
    rl.question(
      `\n  ${c.warn('⚠ ')}${c.white.bold('Allow Okran to ' + label)}? ${c.muted('[y/N] ')}`,
      answer => resolve(answer.trim().toLowerCase() === 'y')
    );
  });
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
async function agentTurn(userInput, rl) {
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

    // Confirm destructive tools before executing
    const allowed = await confirmDestructive(rl, toolCall);
    if (!allowed) {
      history.push({ role: 'user', content: `Tool (${toolCall.tool}) was denied by the user.` });
      break;
    }

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

    // Sanitize tool result to prevent prompt injection via file contents / URLs
    const rawData = result.success ? result.data : result.error;
    const safeData = sanitizeToolResult(rawData ?? '');

    const toolMsg = result.success
      ? `Tool result (${toolCall.tool}):\n${safeData}`
      : `Tool error (${toolCall.tool}): ${safeData}`;

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
        console.log('\n' + c.star('  ✦ ') + c.spark.bold('Goodbye! Stay sharp. ✦') + '\n');
        stopStarField();
        rl.close();
        return;
      }

      if (result === false) {
        // Not a slash command — treat as AI message
        await agentTurn(input, rl);
      }

      ask();
    });
  };

  ask();
}
