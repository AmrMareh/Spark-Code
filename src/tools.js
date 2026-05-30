import fs from 'fs';
import path from 'path';
import { execFileSync, exec } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import { printTool, printError, printSuccess, printInfo, c } from './ui.js';

const execAsync = promisify(exec);

// ─── Result types ─────────────────────────────────────────────────────────────
function ok(data)  { return { success: true,  data }; }
function err(msg)  { return { success: false, error: msg }; }

// ─── Path traversal guard ─────────────────────────────────────────────────────
function safePath(cwd, userPath) {
  const abs = path.resolve(cwd, userPath);
  const base = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (abs !== cwd && !abs.startsWith(base)) {
    throw new Error(`Path traversal blocked: "${userPath}" escapes working directory`);
  }
  return abs;
}

// ─── SSRF block list ──────────────────────────────────────────────────────────
const SSRF_BLOCK = /^https?:\/\/(localhost|127\.|0\.0\.0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|\[::1\]|metadata\.google\.internal)/i;

function checkSSRF(url) {
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error(`SSRF blocked: invalid URL "${url}"`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`SSRF blocked: protocol "${parsed.protocol}" not allowed`);
  }
  if (SSRF_BLOCK.test(url)) {
    throw new Error(`SSRF blocked: "${url}" targets a private/internal address`);
  }
}

// ─── read_file ────────────────────────────────────────────────────────────────
export async function readFile(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Read', params.path);
  try {
    const content = fs.readFileSync(abs, 'utf8');
    const allLines = content.split('\n');

    // Optional line range — handy for large files
    const start = params.start_line ? Math.max(0, params.start_line - 1) : 0;
    const end   = params.end_line   ? Math.min(allLines.length, params.end_line) : allLines.length;
    const slice = allLines.slice(start, end).join('\n');

    printInfo(`${allLines.length} lines total${params.start_line ? `, showing ${start + 1}–${end}` : ''}`);
    return ok(slice);
  } catch (e) {
    printError(`Cannot read: ${e.message}`);
    return err(e.message);
  }
}

// ─── write_file ───────────────────────────────────────────────────────────────
export async function writeFile(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  const existed = fs.existsSync(abs);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, params.content, 'utf8');
    const lines = params.content.split('\n').length;
    printTool(existed ? 'Write' : 'Create', params.path, `${lines} lines`);
    return ok(`Written: ${params.path}`);
  } catch (e) {
    printError(`Cannot write: ${e.message}`);
    return err(e.message);
  }
}

// ─── create_file ─────────────────────────────────────────────────────────────
export async function createFile(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, params.content || '', 'utf8');
    const lines = (params.content || '').split('\n').length;
    printTool('Create', params.path, `${lines} lines`);
    return ok(`Created: ${params.path}`);
  } catch (e) {
    printError(`Cannot create: ${e.message}`);
    return err(e.message);
  }
}

// ─── append_file ──────────────────────────────────────────────────────────────
export async function appendFile(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Write', params.path, '(append)');
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, params.content, 'utf8');
    printInfo(`Appended ${params.content.split('\n').length} lines`);
    return ok(`Appended to: ${params.path}`);
  } catch (e) {
    printError(`Cannot append: ${e.message}`);
    return err(e.message);
  }
}

// ─── delete_file ─────────────────────────────────────────────────────────────
export async function deleteFile(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Delete', params.path);
  try {
    if (!fs.existsSync(abs)) return err('File not found');
    fs.unlinkSync(abs);
    printSuccess(`Deleted ${params.path}`);
    return ok(`Deleted: ${params.path}`);
  } catch (e) {
    printError(`Cannot delete: ${e.message}`);
    return err(e.message);
  }
}

// ─── copy_file ────────────────────────────────────────────────────────────────
export async function copyFile(params, cwd) {
  let src, dst;
  try {
    src = safePath(cwd, params.from);
    dst = safePath(cwd, params.to);
  } catch (e) { printError(e.message); return err(e.message); }
  printTool('Write', `${params.from} → ${params.to}`, '(copy)');
  try {
    if (!fs.existsSync(src)) return err(`Source not found: ${params.from}`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    printSuccess(`Copied`);
    return ok(`Copied: ${params.from} → ${params.to}`);
  } catch (e) {
    printError(`copy_file failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── move_file ────────────────────────────────────────────────────────────────
export async function moveFile(params, cwd) {
  let src, dst;
  try {
    src = safePath(cwd, params.from);
    dst = safePath(cwd, params.to);
  } catch (e) { printError(e.message); return err(e.message); }
  printTool('Write', `${params.from} → ${params.to}`);
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    printSuccess(`Moved`);
    return ok(`Moved: ${params.from} → ${params.to}`);
  } catch (e) {
    printError(`move_file failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── mkdir ───────────────────────────────────────────────────────────────────
export async function mkdir(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Create', params.path, '(dir)');
  try {
    fs.mkdirSync(abs, { recursive: true });
    printSuccess(`Directory created: ${params.path}`);
    return ok(`Created dir: ${params.path}`);
  } catch (e) {
    printError(`mkdir failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── open_file — open in user's editor or OS default app ──────────────────────
export async function openFile(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Read', params.path, '(open)');
  try {
    if (!fs.existsSync(abs)) return err(`File not found: ${params.path}`);
    const platform = process.platform;
    if (platform === 'darwin')     execFileSync('open',     [abs]);
    else if (platform === 'win32') execFileSync('cmd',      ['/c', 'start', '', abs]);
    else                           execFileSync('xdg-open', [abs]);
    printInfo(`Opened ${params.path}`);
    return ok(`Opened: ${params.path}`);
  } catch (e) {
    printError(`open_file failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── run_command ──────────────────────────────────────────────────────────────
const BLOCKED_PATTERNS = [
  /rm\s+-[a-z]*r[a-z]*f?\s+\/[^/]/i,   // rm -rf /anything
  /rm\s+-[a-z]*f[a-z]*r?\s+\/[^/]/i,   // rm -fr /anything
  /rm\s+-rf\b/i,                         // rm -rf (any target)
  /rm\s+-fr\b/i,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /:\(\)\s*\{.*\}/,                      // fork bomb
  /\bsudo\s+rm\b/,
  /\bshred\b.*\//,
  />\s*\/dev\/(sd|hd|nvme|vd)/,         // overwrite block devices
  /\bchmod\s+-[Rr].*777\b/,             // recursive 777
  /\bchown\s+-[Rr]/,
  /curl\s+.*\|\s*(ba)?sh/i,             // curl | bash
  /wget\s+.*\|\s*(ba)?sh/i,
  /\bpython[23]?\s+-c\s+.*exec\b/i,
];

export async function runCommand(params, cwd) {
  const cmd = params.cmd;

  // Safety guard
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      printError(`Blocked dangerous command: ${cmd}`);
      return err('Blocked: command matched safety rules');
    }
  }

  printTool('Run', cmd);
  const timeout = params.timeout_ms ?? 120000;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout,
      env: { ...process.env },
    });
    const output = (stdout + stderr).slice(0, 8000);
    if (output.trim()) {
      console.log(c.muted('  ┌─ output ──────────────────────────'));
      output.split('\n').slice(0, 60).forEach(l => console.log(c.muted('  │ ') + l));
      console.log(c.muted('  └──────────────────────────────────'));
    }
    return ok(output || '(no output)');
  } catch (e) {
    const out = ((e.stdout ?? '') + (e.stderr ?? '')).slice(0, 4000);
    printError(`Command failed: ${e.message.split('\n')[0]}`);
    if (out) console.log(c.error(out));
    return err(out || e.message);
  }
}

// ─── list_dir ─────────────────────────────────────────────────────────────────
export async function listDir(params, cwd) {
  let target;
  try { target = safePath(cwd, params.path || '.'); } catch (e) { printError(e.message); return err(e.message); }
  printTool('List', params.path || '.');
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const out = entries
      .filter(e => !e.name.startsWith('.') || params.hidden)
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: e.isFile() ? fs.statSync(path.join(target, e.name)).size : null,
      }));

    const dirs  = out.filter(e => e.type === 'dir');
    const files = out.filter(e => e.type === 'file');
    dirs.forEach(d  => console.log('  ' + c.code('📁 ' + d.name + '/')));
    files.forEach(f => {
      const kb = f.size ? ` ${(f.size / 1024).toFixed(1)}kb` : '';
      console.log('  ' + c.muted('📄 ' + f.name) + c.muted(kb));
    });
    return ok(out.map(e => (e.type === 'dir' ? e.name + '/' : e.name)).join('\n'));
  } catch (e) {
    printError(`Cannot list: ${e.message}`);
    return err(e.message);
  }
}

// ─── search_code ──────────────────────────────────────────────────────────────
export async function searchCode(params, cwd) {
  const pattern = params.pattern;
  let dir;
  try { dir = safePath(cwd, params.dir || '.'); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Search', pattern, `in ${params.dir || '.'}`);

  try {
    const files = await glob('**/*.{js,ts,tsx,jsx,py,go,rs,java,css,html,json,md,sh,yaml,yml,toml}', {
      cwd: dir,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**', '**/build/**'],
    });

    const results = [];
    for (const file of files) {
      const abs = path.join(dir, file);
      const content = fs.readFileSync(abs, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(pattern.toLowerCase())) {
          results.push({ file, line: i + 1, text: line.trim() });
        }
      });
    }

    if (results.length === 0) {
      printInfo(`No matches for "${pattern}"`);
    } else {
      results.slice(0, 20).forEach(r => {
        console.log(
          '  ' + c.code(r.file + ':' + r.line) + '  ' +
          c.muted(r.text.slice(0, 80))
        );
      });
      if (results.length > 20) printInfo(`... and ${results.length - 20} more`);
    }

    return ok(results.map(r => `${r.file}:${r.line}: ${r.text}`).join('\n') || 'No matches');
  } catch (e) {
    printError(`Search failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── patch_file — surgical find-and-replace inside a file ────────────────────
export async function patchFile(params, cwd) {
  let abs;
  try { abs = safePath(cwd, params.path); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Write', params.path, '(patch)');
  try {
    if (!fs.existsSync(abs)) return err(`File not found: ${params.path}`);
    let content = fs.readFileSync(abs, 'utf8');
    const oldStr = params.old_string;
    const newStr = params.new_string ?? '';
    if (!content.includes(oldStr)) {
      printError(`patch_file: old_string not found in ${params.path}`);
      return err('old_string not found — read the file first to get exact text');
    }
    const patched = params.replace_all
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr);
    fs.writeFileSync(abs, patched, 'utf8');
    printTool('Write', params.path, 'patched');
    return ok(`Patched: ${params.path}`);
  } catch (e) {
    printError(`patch_file failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── fetch_url — pull content from a URL ─────────────────────────────────────
export async function fetchUrl(params) {
  try { checkSSRF(params.url); } catch (e) { printError(e.message); return err(e.message); }
  printTool('Search', params.url);
  try {
    const res = await fetch(params.url, {
      headers: { 'User-Agent': 'Spark-Agent/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return err(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    let text;
    if (ct.includes('json')) {
      text = JSON.stringify(await res.json(), null, 2);
    } else {
      text = await res.text();
      text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
                 .replace(/<script[\s\S]*?<\/script>/gi, '')
                 .replace(/<[^>]+>/g, ' ')
                 .replace(/\s{3,}/g, '\n')
                 .trim();
    }
    const excerpt = text.slice(0, 6000);
    printInfo(`${excerpt.length} chars fetched`);
    return ok(excerpt);
  } catch (e) {
    printError(`fetch_url failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
export async function dispatchTool(call, cwd) {
  switch (call.tool) {
    case 'read_file':    return readFile(call.params, cwd);
    case 'write_file':   return writeFile(call.params, cwd);
    case 'create_file':  return createFile(call.params, cwd);
    case 'append_file':  return appendFile(call.params, cwd);
    case 'delete_file':  return deleteFile(call.params, cwd);
    case 'copy_file':    return copyFile(call.params, cwd);
    case 'patch_file':   return patchFile(call.params, cwd);
    case 'move_file':    return moveFile(call.params, cwd);
    case 'mkdir':        return mkdir(call.params, cwd);
    case 'open_file':    return openFile(call.params, cwd);
    case 'run_command':  return runCommand(call.params, cwd);
    case 'list_dir':     return listDir(call.params, cwd);
    case 'search_code':  return searchCode(call.params, cwd);
    case 'fetch_url':    return fetchUrl(call.params);
    default:
      printError(`Unknown tool: ${call.tool}`);
      return err(`Unknown tool: ${call.tool}`);
  }
}

// ─── Collect all files touched in a session (for DB logging) ─────────────────
export function summarizeWork(history) {
  const files = new Set();
  const commands = [];

  history.forEach(msg => {
    if (msg.role !== 'tool') return;
    const data = msg.data;
    if (['write_file', 'create_file', 'append_file', 'copy_file', 'move_file'].includes(data?.tool)) {
      files.add(data.params?.path || data.params?.to);
    }
    if (data?.tool === 'run_command') commands.push(data.params?.cmd);
  });

  return { files_touched: [...files], commands_run: commands };
}
