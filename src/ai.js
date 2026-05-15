import OpenAI from 'openai';
import { printAIChunk, printAIEnd, printWarn, printInfo, c } from './ui.js';

// ─── Spark Code 1.2 — internal engine registry ───────────────────────────────
const ENGINES = {
  gpt:      { label: 'GPT-4o',          id: 'gpt-4o',           provider: 'openai'   },
  gemini:   { label: 'Gemini 2.0 Flash', id: 'gemini-2.0-flash', provider: 'gemini'   },
  grok:     { label: 'Grok 3',           id: 'grok-3',           provider: 'grok'     },
  deepseek: { label: 'DeepSeek Chat',    id: 'deepseek-chat',    provider: 'deepseek' },
};

// ─── Task-type → engine routing ───────────────────────────────────────────────
//
//  deepseek  → algorithms, math, low-level (C/Rust/Go), performance
//  grok      → bash scripts, real-time info, quick one-liners, trending
//  gemini    → docs, large file analysis, markdown, data pipelines
//  gpt       → everything else (React, TS, architecture, refactor, build)
//              GPT is the default / fallback

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
      'what is the latest', 'current version', 'quick', 'one liner', 'one-liner',
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
  // GPT handles everything else — React, TS, Next.js, architecture, full apps
];

export let lastEngine = 'gpt';

export function routeTask(userInput) {
  const lower = userInput.toLowerCase();
  for (const rule of ROUTING_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        lastEngine = rule.engine;
        return rule.engine;
      }
    }
  }
  lastEngine = 'gpt';
  return 'gpt';
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystem(cwd) {
  return `You are Spark Code 1.2 — the world's most capable terminal AI coding agent.
You have FULL access to the user's filesystem and can execute any shell command.
Current working directory: ${cwd}
Today: ${new Date().toDateString()}

## TOOLS — use these to act, not just talk

Emit ONE \`\`\`tool\`\`\` block per response turn. After the result is returned, call another tool or give your final answer.

### Available tools

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

## AGENTIC RULES

1. **Plan first** — for 3+ file tasks, write a numbered plan then execute every step yourself.
2. **Read before write** — always read_file before write_file or patch_file.
3. **Prefer patch_file** for changes < 30% of a file.
4. **Verify builds** — run \`npm install && npm run build\` after creating an app.
5. **Self-heal** — if a command fails, fix the error yourself and re-run. Never ask the user.
6. **Complete the task** — never stop mid-way. Do it all.
7. **One tool per turn** — exactly one \`\`\`tool\`\`\` block per response.
8. **Summarise** — when done, print a table of every file touched and what changed.

## TONE
Direct. Fast. Zero filler. Maximum signal. You are Spark Code 1.2.`;
}

// ─── Unified OpenAI-compat streamer ───────────────────────────────────────────
async function streamEngine(engine, messages, cwd, onChunk) {
  const configs = {
    gpt: {
      apiKey:  process.env.SPARKCODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    },
    gemini: {
      apiKey:  process.env.GOOGLE_API_KEY || process.env.SPARKCODE_GOOGLE_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    },
    grok: {
      apiKey:  process.env.GROK_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    },
    deepseek: {
      apiKey:  process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com/v1',
    },
  };

  const cfg = configs[engine];
  if (!cfg) throw new Error(`Unknown engine: ${engine}`);

  const client = new OpenAI({ apiKey: cfg.apiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });
  const stream = await client.chat.completions.create({
    model: ENGINES[engine].id,
    messages: [{ role: 'system', content: buildSystem(cwd) }, ...messages],
    stream: true,
    max_tokens: 8192,
  });

  let full = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    full += text;
    onChunk(text);
  }
  return full;
}

// ─── Main call — auto-routes ──────────────────────────────────────────────────
export async function callAI(messages, cwd, forcedEngine = null) {
  let engine = forcedEngine;
  if (!engine) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    engine = routeTask(lastUser?.content || '');
  }

  printInfo(`Spark Code 1.2  ·  ${c.spark(ENGINES[engine].label)}`);

  let response = '';
  try {
    response = await streamEngine(engine, messages, cwd, printAIChunk);
  } catch (err) {
    // Fallback chain: failed engine → gpt → deepseek → throw
    const fallbacks = ['gpt', 'deepseek', 'grok', 'gemini'].filter(e => e !== engine);
    let fell = false;
    for (const fb of fallbacks) {
      try {
        printWarn(`${ENGINES[engine].label} failed — retrying with ${ENGINES[fb].label}`);
        response = await streamEngine(fb, messages, cwd, printAIChunk);
        fell = true;
        break;
      } catch { /* try next */ }
    }
    if (!fell) throw err;
  }

  printAIEnd();
  return response;
}

// ─── Parse tool calls ─────────────────────────────────────────────────────────
export function parseToolCall(text) {
  const match = text.match(/```tool\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

export function isToolOnly(text) {
  return text.replace(/```tool[\s\S]*?```/g, '').trim().length < 10;
}

export function getEngineLabel(engine) {
  return ENGINES[engine]?.label || engine;
}
