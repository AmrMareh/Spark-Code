import OpenAI from 'openai';
import { printAIChunk, printAIEnd, startSpinner, stopSpinner } from './ui.js';

// ─── Internal engine registry — never shown to user ──────────────────────────
const ENGINES = {
  gpt: {
    ids:     ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],  // reliable models that actually work
    apiKey:  () => process.env.SPARKCODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  },
  gemini: {
    ids:     ['gemini-2.0-flash', 'gemini-1.5-pro'],
    apiKey:  () => process.env.GOOGLE_API_KEY || process.env.SPARKCODE_GOOGLE_API_KEY,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },
  grok: {
    ids:     ['grok-3', 'grok-2'],
    apiKey:  () => process.env.GROK_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  },
  deepseek: {
    ids:     ['deepseek-chat'],
    apiKey:  () => process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
  },
};

// ─── Routing rules ────────────────────────────────────────────────────────────
const ROUTING_RULES = [
  {
    engine: 'deepseek',
    keywords: [
      'algorithm', 'leetcode', 'dynamic programming', 'binary search', 'graph',
      'tree traversal', 'complexity', 'big o', 'recursion', 'rust', 'golang',
      'c++', 'assembly', 'performance', 'optimise', 'optimize', 'benchmark',
      'memory management', 'pointer', 'bitwise', 'math', 'calculus', 'matrix',
      'data structure',
    ],
  },
  {
    engine: 'grok',
    keywords: [
      'what is the latest', 'current version', 'one liner', 'one-liner',
      'bash script', 'shell script', 'cron job', 'terminal command',
      'brew install', 'apt install', 'docker run', 'trending', 'news',
    ],
  },
  {
    engine: 'gemini',
    keywords: [
      'document', 'readme', 'markdown', 'summarise', 'summarize',
      'analyse this file', 'analyze this file', 'data pipeline',
      'csv', 'large file', 'pdf', 'spreadsheet',
      'explain this codebase', 'explain this repo', 'generate docs',
    ],
  },
];

export function routeTask(input) {
  const lower = input.toLowerCase();
  for (const rule of ROUTING_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.engine;
    }
  }
  return 'gpt';
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystem(cwd) {
  return `You are Spark Code 1.2 — the world's most capable terminal AI coding agent.
You have FULL access to the user's filesystem and can execute any shell command.
Current working directory: ${cwd}
Today: ${new Date().toDateString()}

## TOOLS

Emit ONE \`\`\`tool\`\`\` block per response turn.

\`\`\`tool
{ "tool": "read_file",   "params": { "path": "src/index.ts" } }
\`\`\`
\`\`\`tool
{ "tool": "write_file",  "params": { "path": "src/index.ts", "content": "<full file content>" } }
\`\`\`
\`\`\`tool
{ "tool": "create_file", "params": { "path": "src/new.ts", "content": "<full file content>" } }
\`\`\`
\`\`\`tool
{ "tool": "patch_file",  "params": { "path": "src/x.ts", "old_string": "exact text", "new_string": "replacement", "replace_all": false } }
\`\`\`
\`\`\`tool
{ "tool": "delete_file", "params": { "path": "src/old.ts" } }
\`\`\`
\`\`\`tool
{ "tool": "move_file",   "params": { "from": "old/path.ts", "to": "new/path.ts" } }
\`\`\`
\`\`\`tool
{ "tool": "run_command", "params": { "cmd": "npm install && npm run build" } }
\`\`\`
\`\`\`tool
{ "tool": "list_dir",    "params": { "path": "." } }
\`\`\`
\`\`\`tool
{ "tool": "search_code", "params": { "pattern": "useState", "dir": "src" } }
\`\`\`
\`\`\`tool
{ "tool": "fetch_url",   "params": { "url": "https://example.com/api" } }
\`\`\`

## RULES
1. Plan first for 3+ file tasks, then execute every step yourself.
2. Always read_file before write_file or patch_file.
3. Prefer patch_file for small changes.
4. Run npm install && npm run build after creating an app.
5. Fix errors yourself and re-run. Never ask the user.
6. Complete the entire task. Never stop mid-way.
7. One tool block per response turn.
8. End with a summary table of files touched.

## TONE
Direct. Fast. Zero filler. You are Spark Code 1.2.`;
}

// ─── GPT via Responses API (supports gpt-5.3-codex) ─────────────────────────
async function streamGPTResponses(messages, cwd) {
  const apiKey = process.env.SPARKCODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('No OpenAI API key');

  const client = new OpenAI({ apiKey });
  const input = [
    { role: 'system', content: buildSystem(cwd) },
    ...messages,
  ];

  // Responses API — supports gpt-5.3-codex
  const stream = await client.responses.create({
    model: 'gpt-5.3-codex',
    input,
    stream: true,
    max_output_tokens: 8192,
  });

  let full = '';
  let inToolBlock = false;
  let toolBuf = '';

  for await (const event of stream) {
    const text = event.delta ?? event.output_text ?? '';
    if (!text) continue;
    full += text;

    // Suppress tool blocks from screen
    if (text.includes('```tool') || inToolBlock) {
      inToolBlock = true;
      toolBuf += text;
      if (toolBuf.includes('```\n') || toolBuf.endsWith('```')) {
        inToolBlock = false;
        toolBuf = '';
      }
      continue;
    }
    printAIChunk(text);
  }
  return full;
}

// ─── Other engines via chat completions ──────────────────────────────────────
async function streamChatEngine(engineKey, messages, cwd) {
  const engine = ENGINES[engineKey];
  const apiKey = engine.apiKey();
  if (!apiKey) throw new Error(`No API key for ${engineKey}`);

  const client = new OpenAI({
    apiKey,
    ...(engine.baseURL ? { baseURL: engine.baseURL } : {}),
  });

  const sysMessages = [{ role: 'system', content: buildSystem(cwd) }, ...messages];

  for (const modelId of engine.ids) {
    try {
      const stream = await client.chat.completions.create({
        model: modelId,
        messages: sysMessages,
        stream: true,
        max_tokens: 8192,
      });

      let full = '';
      let inToolBlock = false;
      let toolBuf = '';

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        full += text;

        if (text.includes('```tool') || inToolBlock) {
          inToolBlock = true;
          toolBuf += text;
          if (toolBuf.includes('```\n') || toolBuf.endsWith('```')) {
            inToolBlock = false;
            toolBuf = '';
          }
          continue;
        }
        printAIChunk(text);
      }
      return full;
    } catch {
      // try next model id
    }
  }
  throw new Error(`All model IDs failed for ${engineKey}`);
}

// ─── Main call — gpt-5.3-codex first, silent fallback ────────────────────────
export async function callAI(messages, cwd, forcedEngine = null) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const primary = forcedEngine || routeTask(lastUser?.content || '');

  startSpinner('Thinking');

  // GPT always tries gpt-5.3-codex via Responses API first
  if (primary === 'gpt' || !forcedEngine) {
    try {
      stopSpinner();
      const response = await streamGPTResponses(messages, cwd);
      printAIEnd();
      return response;
    } catch { /* fall through to chat engines */ }
  }

  // Fallback order for non-GPT tasks or if Responses API fails
  const order = [primary, ...['gemini', 'deepseek', 'grok', 'gpt'].filter(e => e !== primary)];
  for (const engine of order) {
    try {
      stopSpinner();
      const response = await streamChatEngine(engine, messages, cwd);
      printAIEnd();
      return response;
    } catch { /* try next */ }
  }

  stopSpinner();
  throw new Error('All engines failed. Check your API keys in ~/.spark-code/.env');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function parseToolCall(text) {
  const match = text.match(/```tool\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

export function isToolOnly(text) {
  return text.replace(/```tool[\s\S]*?```/g, '').trim().length < 10;
}
