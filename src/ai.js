import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { printAIChunk, printAIEnd, printWarn, printInfo, c } from './ui.js';

// ─── Spark Code 1.2 — internal engine registry ───────────────────────────────
// These are never exposed to the user. The product is always "Spark Code 1.2".
const ENGINES = {
  claude:   { label: 'Claude',    id: 'claude-sonnet-4-6',  provider: 'anthropic' },
  gpt:      { label: 'GPT-4o',    id: 'gpt-4o',             provider: 'openai'    },
  gemini:   { label: 'Gemini',    id: 'gemini-2.0-flash',   provider: 'gemini'    },
  grok:     { label: 'Grok',      id: 'grok-3',             provider: 'grok'      },
  deepseek: { label: 'DeepSeek',  id: 'deepseek-chat',      provider: 'deepseek'  },
};

// ─── Task-type → engine routing table ────────────────────────────────────────
//
//  Spark Code 1.2 analyses the user's prompt and selects the best engine.
//  The routing is done locally (no extra API call) using keyword heuristics.
//
//  Route logic:
//   claude    → architecture, refactoring, complex multi-file builds, explanations
//   gpt       → web APIs, TypeScript/React, debugging, unit tests
//   gemini    → large file analysis, documentation, markdown, data pipelines
//   grok      → real-time info, trending tech, quick one-liners, bash one-offs
//   deepseek  → algorithms, math, low-level C/Rust/Go, performance optimisation

const ROUTING_RULES = [
  // DeepSeek — algorithms, math, low-level
  {
    engine: 'deepseek',
    keywords: [
      'algorithm', 'leetcode', 'dynamic programming', 'binary search', 'graph',
      'tree', 'sort', 'complexity', 'big o', 'recursion', 'rust', 'golang',
      'c++', 'assembly', 'performance', 'optimise', 'optimize', 'benchmark',
      'memory', 'pointer', 'bitwise', 'math', 'calculus', 'matrix',
    ],
  },
  // Grok — quick answers, bash, real-time, trending
  {
    engine: 'grok',
    keywords: [
      'what is the latest', 'current version', 'quick', 'one liner',
      'bash script', 'shell script', 'cron job', 'terminal command',
      'brew install', 'apt install', 'docker run', 'trending',
    ],
  },
  // Gemini — docs, large files, data, markdown
  {
    engine: 'gemini',
    keywords: [
      'document', 'readme', 'markdown', 'summarise', 'summarize',
      'analyse this file', 'analyze this file', 'data pipeline',
      'csv', 'json file', 'large file', 'pdf', 'spreadsheet',
      'explain this codebase', 'explain this repo',
    ],
  },
  // GPT — React, TypeScript, web, tests
  {
    engine: 'gpt',
    keywords: [
      'react', 'next.js', 'nextjs', 'typescript', 'unit test', 'jest',
      'vitest', 'cypress', 'playwright', 'tailwind', 'component', 'hook',
      'redux', 'zustand', 'api route', 'rest api', 'graphql', 'prisma',
      'express', 'fastapi', 'django', 'flask',
    ],
  },
  // Claude — everything else (complex reasoning, architecture, refactor)
  // This is the default / fallback
];

// Last engine used (shown in UI)
export let lastEngine = 'claude';

// ─── Route a task to the best engine ─────────────────────────────────────────
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

  // Default to Claude for complex/unknown tasks
  lastEngine = 'claude';
  return 'claude';
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

1. **Plan first** — for 3+ file tasks, write a numbered plan, then execute every step yourself.
2. **Read before write** — always read_file before write_file or patch_file.
3. **Prefer patch_file** for changes < 30% of a file.
4. **Verify builds** — run \`npm install && npm run build\` (or equivalent) after creating an app.
5. **Self-heal** — if a command fails, fix the error yourself and re-run. Never ask the user to fix it.
6. **Complete the task** — never stop mid-way or say "you should also…". Do it all.
7. **One tool per turn** — exactly one \`\`\`tool\`\`\` block per response.
8. **Summarise** — when done, print a table of every file touched and what changed.

## TONE
Direct. Fast. Zero filler. Maximum signal. You are Spark Code 1.2.`;
}

// ─── Stream helpers ───────────────────────────────────────────────────────────
async function streamClaude(messages, cwd, onChunk) {
  const client = new Anthropic({ apiKey: process.env.SPARKCODE_ANTHROPIC_API_KEY });
  const stream = await client.messages.stream({
    model: ENGINES.claude.id,
    max_tokens: 8192,
    system: buildSystem(cwd),
    messages,
  });
  let full = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      full += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }
  return full;
}

async function streamOpenAICompat(messages, cwd, { modelId, apiKey, baseURL }, onChunk) {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const stream = await client.chat.completions.create({
    model: modelId,
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

// ─── Per-engine stream dispatch ───────────────────────────────────────────────
async function streamEngine(engine, messages, cwd, onChunk) {
  switch (engine) {
    case 'claude':
      return streamClaude(messages, cwd, onChunk);

    case 'gpt':
      return streamOpenAICompat(messages, cwd, {
        modelId: ENGINES.gpt.id,
        apiKey:  process.env.SPARKCODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      }, onChunk);

    case 'gemini':
      return streamOpenAICompat(messages, cwd, {
        modelId: ENGINES.gemini.id,
        apiKey:  process.env.GOOGLE_API_KEY || process.env.SPARKCODE_GOOGLE_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      }, onChunk);

    case 'grok':
      return streamOpenAICompat(messages, cwd, {
        modelId: ENGINES.grok.id,
        apiKey:  process.env.GROK_API_KEY,
        baseURL: 'https://api.x.ai/v1',
      }, onChunk);

    case 'deepseek':
      return streamOpenAICompat(messages, cwd, {
        modelId: ENGINES.deepseek.id,
        apiKey:  process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com/v1',
      }, onChunk);

    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

// ─── Main call — routes automatically ────────────────────────────────────────
export async function callAI(messages, cwd, forcedEngine = null) {
  // Determine engine: use forced (follow-up turns) or route from latest user message
  let engine = forcedEngine;
  if (!engine) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    engine = routeTask(lastUser?.content || '');
  }

  const engineInfo = ENGINES[engine];
  printInfo(`Spark Code 1.2  ·  routed to ${c.spark(engineInfo.label)}`);

  let response = '';
  try {
    response = await streamEngine(engine, messages, cwd, printAIChunk);
  } catch (err) {
    // Fallback chain: failed engine → claude → gpt → throw
    const fallbacks = ['claude', 'gpt'].filter(e => e !== engine);
    let fell = false;
    for (const fb of fallbacks) {
      try {
        printWarn(`${engineInfo.label} failed (${err.message}) — retrying with ${ENGINES[fb].label}`);
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

// ─── Parse tool calls from AI response ───────────────────────────────────────
export function parseToolCall(text) {
  const match = text.match(/```tool\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

// ─── Detect if response is ONLY a tool call (no prose) ───────────────────────
export function isToolOnly(text) {
  return text.replace(/```tool[\s\S]*?```/g, '').trim().length < 10;
}

// ─── For the session logger ───────────────────────────────────────────────────
export function getEngineLabel(engine) {
  return ENGINES[engine]?.label || engine;
}
