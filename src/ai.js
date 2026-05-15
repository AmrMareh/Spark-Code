import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { printAIChunk, printAIEnd, printWarn, c } from './ui.js';

// ─── Model registry ───────────────────────────────────────────────────────────
export const MODELS = {
  claude:   { label: 'Claude 4 Sonnet',    id: 'claude-sonnet-4-6',       provider: 'anthropic' },
  gpt:      { label: 'GPT-4o',             id: 'gpt-4o',                  provider: 'openai'    },
  gemini:   { label: 'Gemini 2.0 Flash',   id: 'gemini-2.0-flash',        provider: 'gemini'    },
  grok:     { label: 'Grok 3',             id: 'grok-3',                  provider: 'grok'      },
  deepseek: { label: 'DeepSeek Chat',      id: 'deepseek-chat',           provider: 'deepseek'  },
};

export let activeModel = 'claude';

export function setModel(name) {
  if (MODELS[name]) {
    activeModel = name;
    return true;
  }
  return false;
}

export function getModelInfo() {
  return MODELS[activeModel];
}

// ─── System prompt injected into every session ───────────────────────────────
function buildSystem(cwd) {
  return `You are Spark Agent — the most capable terminal AI coding assistant ever built.
You have FULL access to the user's filesystem and can run ANY shell command.
Current working directory: ${cwd}
Today: ${new Date().toDateString()}

## TOOLS — use these to act, not just talk

Emit a single \`\`\`tool\`\`\` block to call a tool. Use ONE tool per response turn.
After the tool result is returned, you may call another tool or give your final answer.

### Available tools

\`\`\`tool
{ "tool": "read_file",   "params": { "path": "src/index.ts" } }
\`\`\`
\`\`\`tool
{ "tool": "write_file",  "params": { "path": "src/index.ts", "content": "<full file>" } }
\`\`\`
\`\`\`tool
{ "tool": "create_file", "params": { "path": "src/new.ts",   "content": "<full file>" } }
\`\`\`
\`\`\`tool
{ "tool": "patch_file",  "params": { "path": "src/x.ts", "old_string": "exact text to replace", "new_string": "replacement", "replace_all": false } }
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
{ "tool": "fetch_url",   "params": { "url": "https://api.github.com/repos/owner/repo" } }
\`\`\`

## AGENTIC RULES — follow these exactly

1. **Plan first** — for any task involving 3+ files, start with a brief numbered plan, then execute it tool by tool.
2. **Read before write** — always read_file before write_file or patch_file.
3. **Prefer patch_file** over write_file when changing < 30% of a file. It's surgical and shows clean diffs.
4. **Run after build** — after creating an app, always run \`npm install\` then \`npm run build\` (or equivalent) to verify it compiles.
5. **Fix your own errors** — if a run_command fails, read the error, fix the file, and re-run. Don't ask the user.
6. **Complete the task** — never stop mid-way or say "you should also…". Finish everything yourself.
7. **One tool per turn** — emit exactly one \`\`\`tool\`\`\` block per response. No exceptions.
8. **Summarise at the end** — when all tools are done, print a clean table of what you created/modified.

## OUTPUT FORMAT

- Before first tool: one sentence plan.
- While using tools: say nothing except the tool block (the UI shows tool output already).
- After all tools done: print a clean summary with file paths and what changed.
- Never wrap tool blocks inside prose paragraphs.

## TONE
You are Spark — the brightest, fastest AI coding agent. Direct. Zero filler. Maximum signal.`;
}

// ─── Anthropic (Claude) ───────────────────────────────────────────────────────
async function streamClaude(messages, cwd, onChunk) {
  const client = new Anthropic({ apiKey: process.env.SPARKCODE_ANTHROPIC_API_KEY });
  const stream = await client.messages.stream({
    model: MODELS.claude.id,
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

// ─── OpenAI ───────────────────────────────────────────────────────────────────
async function streamOpenAI(messages, cwd, modelId, apiKey, onChunk) {
  const client = new OpenAI({ apiKey });
  const sysMessages = [
    { role: 'system', content: buildSystem(cwd) },
    ...messages,
  ];
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
}

// ─── Gemini via OpenAI-compat endpoint ───────────────────────────────────────
async function streamGemini(messages, cwd, onChunk) {
  const client = new OpenAI({
    apiKey: process.env.GOOGLE_API_KEY || process.env.SPARKCODE_GOOGLE_API_KEY,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  });
  return streamOpenAI(messages, cwd, MODELS.gemini.id,
    process.env.GOOGLE_API_KEY || process.env.SPARKCODE_GOOGLE_API_KEY, onChunk);
}

// ─── Grok via xAI ────────────────────────────────────────────────────────────
async function streamGrok(messages, cwd, onChunk) {
  return streamOpenAI(
    messages, cwd, MODELS.grok.id,
    process.env.GROK_API_KEY,
    onChunk,
  );
}

// Actually Grok needs different base URL
async function streamGrokFixed(messages, cwd, onChunk) {
  const client = new OpenAI({
    apiKey: process.env.GROK_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  });
  const sysMessages = [
    { role: 'system', content: buildSystem(cwd) },
    ...messages,
  ];
  const stream = await client.chat.completions.create({
    model: MODELS.grok.id,
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
}

// ─── DeepSeek ─────────────────────────────────────────────────────────────────
async function streamDeepSeek(messages, cwd, onChunk) {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
  });
  const sysMessages = [
    { role: 'system', content: buildSystem(cwd) },
    ...messages,
  ];
  const stream = await client.chat.completions.create({
    model: MODELS.deepseek.id,
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
}

// ─── Unified call ─────────────────────────────────────────────────────────────
export async function callAI(messages, cwd) {
  const model = MODELS[activeModel];
  let response = '';

  try {
    switch (activeModel) {
      case 'claude':
        response = await streamClaude(messages, cwd, printAIChunk);
        break;
      case 'gpt':
        response = await streamOpenAI(
          messages, cwd, model.id,
          process.env.SPARKCODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
          printAIChunk,
        );
        break;
      case 'gemini':
        response = await streamGemini(messages, cwd, printAIChunk);
        break;
      case 'grok':
        response = await streamGrokFixed(messages, cwd, printAIChunk);
        break;
      case 'deepseek':
        response = await streamDeepSeek(messages, cwd, printAIChunk);
        break;
      default:
        throw new Error(`Unknown model: ${activeModel}`);
    }
  } catch (err) {
    if (activeModel !== 'claude' && process.env.SPARKCODE_ANTHROPIC_API_KEY) {
      printWarn(`${model.label} failed (${err.message}). Falling back to Claude...`);
      response = await streamClaude(messages, cwd, printAIChunk);
    } else {
      throw err;
    }
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

// ─── Detect if response contains only a tool call ────────────────────────────
export function isToolOnly(text) {
  const stripped = text.replace(/```tool[\s\S]*?```/g, '').trim();
  return stripped.length < 10;
}
