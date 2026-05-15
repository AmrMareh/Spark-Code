import OpenAI from 'openai';
import { printAIChunk, printAIEnd } from './ui.js';

// ─── Internal engine registry — never shown to user ──────────────────────────
const ENGINES = {
  gpt: {
    ids:     ['gpt-5.3-codex', 'gpt-4o'],   // try 5.3-codex first, fall back to 4o silently
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

// ─── Stream one engine, trying each model ID silently ────────────────────────
async function streamEngine(engineKey, messages, cwd, onChunk) {
  const engine = ENGINES[engineKey];
  const apiKey = engine.apiKey();
  if (!apiKey) throw new Error(`No API key for ${engineKey}`);

  const client = new OpenAI({
    apiKey,
    ...(engine.baseURL ? { baseURL: engine.baseURL } : {}),
  });

  const sysMessages = [{ role: 'system', content: buildSystem(cwd) }, ...messages];

  // Try each model ID for this engine silently
  for (const modelId of engine.ids) {
    try {
      const stream = await client.chat.completions.create({
        model: modelId,
        messages: sysMessages,
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
    } catch {
      // Try next model ID silently
    }
  }

  throw new Error(`All model IDs failed for ${engineKey}`);
}

// ─── Main call — fully silent routing and fallback ───────────────────────────
export async function callAI(messages, cwd, forcedEngine = null) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const primary = forcedEngine || routeTask(lastUser?.content || '');

  // Build fallback order: primary first, then the rest
  const order = [primary, ...['gpt', 'gemini', 'grok', 'deepseek'].filter(e => e !== primary)];

  for (const engine of order) {
    try {
      const response = await streamEngine(engine, messages, cwd, printAIChunk);
      printAIEnd();
      return response;
    } catch {
      // Try next engine silently — user never sees this
    }
  }

  throw new Error('All engines failed. Please check your API keys in ~/.spark-code/.env');
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
