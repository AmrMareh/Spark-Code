import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import { printTool, printFileDiff, printError, printSuccess, printInfo, c } from './ui.js';

const execAsync = promisify(exec);

// ─── Result types ─────────────────────────────────────────────────────────────
function ok(data)  { return { success: true,  data }; }
function err(msg)  { return { success: false, error: msg }; }

// ─── read_file ────────────────────────────────────────────────────────────────
export async function readFile(params, cwd) {
  const abs = path.resolve(cwd, params.path);
  printTool('Read', params.path);
  try {
    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split('\n').length;
    printInfo(`${lines} lines`);
    return ok(content);
  } catch (e) {
    printError(`Cannot read: ${e.message}`);
    return err(e.message);
  }
}

// ─── write_file ───────────────────────────────────────────────────────────────
export async function writeFile(params, cwd) {
  const abs = path.resolve(cwd, params.path);
  printTool('Write', params.path);

  // Show diff if file already exists
  let oldLines = [];
  if (fs.existsSync(abs)) {
    oldLines = fs.readFileSync(abs, 'utf8').split('\n');
  }

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, params.content, 'utf8');
    const newLines = params.content.split('\n');
    if (oldLines.length > 0) {
      printFileDiff(params.path, oldLines, newLines);
    } else {
      printSuccess(`Written ${newLines.length} lines`);
    }
    return ok(`Written: ${params.path}`);
  } catch (e) {
    printError(`Cannot write: ${e.message}`);
    return err(e.message);
  }
}

// ─── create_file ─────────────────────────────────────────────────────────────
export async function createFile(params, cwd) {
  const abs = path.resolve(cwd, params.path);
  printTool('Create', params.path);
  if (fs.existsSync(abs)) {
    printError(`File already exists: ${params.path}  (use write_file to overwrite)`);
    return err('File already exists');
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, params.content || '', 'utf8');
    printSuccess(`Created ${params.path}`);
    return ok(`Created: ${params.path}`);
  } catch (e) {
    printError(`Cannot create: ${e.message}`);
    return err(e.message);
  }
}

// ─── delete_file ─────────────────────────────────────────────────────────────
export async function deleteFile(params, cwd) {
  const abs = path.resolve(cwd, params.path);
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

// ─── run_command ──────────────────────────────────────────────────────────────
const BLOCKED = ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:', 'sudo rm'];

export async function runCommand(params, cwd) {
  const cmd = params.cmd;

  // Safety guard
  for (const b of BLOCKED) {
    if (cmd.includes(b)) {
      printError(`Blocked dangerous command: ${cmd}`);
      return err('Blocked');
    }
  }

  printTool('Run', cmd);
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: 60000,
      env: { ...process.env },
    });
    const output = (stdout + stderr).slice(0, 4000);
    if (output.trim()) {
      console.log(c.muted('  ┌─ output ──────────────────────────'));
      output.split('\n').slice(0, 40).forEach(l => console.log(c.muted('  │ ') + l));
      console.log(c.muted('  └──────────────────────────────────'));
    }
    return ok(output);
  } catch (e) {
    const out = (e.stdout + e.stderr).slice(0, 2000);
    printError(`Command failed: ${e.message.split('\n')[0]}`);
    if (out) console.log(c.error(out));
    return err(out || e.message);
  }
}

// ─── list_dir ─────────────────────────────────────────────────────────────────
export async function listDir(params, cwd) {
  const target = path.resolve(cwd, params.path || '.');
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

    // Pretty print
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
  const dir = path.resolve(cwd, params.dir || '.');
  printTool('Search', pattern, `in ${params.dir || '.'}`);

  try {
    const files = await glob('**/*.{js,ts,tsx,jsx,py,go,rs,java,css,html,json,md}', {
      cwd: dir,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**'],
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

    return ok(results.map(r => `${r.file}:${r.line}: ${r.text}`).join('\n'));
  } catch (e) {
    printError(`Search failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── patch_file — surgical find-and-replace inside a file ────────────────────
export async function patchFile(params, cwd) {
  const abs = path.resolve(cwd, params.path);
  printTool('Write', params.path, '(patch)');
  try {
    let content = fs.readFileSync(abs, 'utf8');
    const oldStr = params.old_string;
    const newStr = params.new_string;
    if (!content.includes(oldStr)) {
      printError(`patch_file: old_string not found in ${params.path}`);
      return err('old_string not found — read the file first to get exact text');
    }
    const patched = params.replace_all
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr);
    const oldLines = content.split('\n');
    const newLines = patched.split('\n');
    fs.writeFileSync(abs, patched, 'utf8');
    printFileDiff(params.path, oldLines, newLines);
    return ok(`Patched: ${params.path}`);
  } catch (e) {
    printError(`patch_file failed: ${e.message}`);
    return err(e.message);
  }
}

// ─── fetch_url — pull content from a URL ─────────────────────────────────────
export async function fetchUrl(params) {
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
      // Strip HTML tags to save tokens
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

// ─── move_file ────────────────────────────────────────────────────────────────
export async function moveFile(params, cwd) {
  const src = path.resolve(cwd, params.from);
  const dst = path.resolve(cwd, params.to);
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

// ─── Dispatcher ───────────────────────────────────────────────────────────────
export async function dispatchTool(call, cwd) {
  switch (call.tool) {
    case 'read_file':    return readFile(call.params, cwd);
    case 'write_file':   return writeFile(call.params, cwd);
    case 'create_file':  return createFile(call.params, cwd);
    case 'delete_file':  return deleteFile(call.params, cwd);
    case 'patch_file':   return patchFile(call.params, cwd);
    case 'run_command':  return runCommand(call.params, cwd);
    case 'list_dir':     return listDir(call.params, cwd);
    case 'search_code':  return searchCode(call.params, cwd);
    case 'fetch_url':    return fetchUrl(call.params);
    case 'move_file':    return moveFile(call.params, cwd);
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
    if (data?.tool === 'write_file' || data?.tool === 'create_file') files.add(data.params?.path);
    if (data?.tool === 'run_command') commands.push(data.params?.cmd);
  });

  return {
    files_touched: [...files],
    commands_run: commands,
  };
}
