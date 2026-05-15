import chalk from 'chalk';
import readline from 'readline';

// ─── Colour palette matching Spark's brand ───────────────────────────────────
export const c = {
  spark:   chalk.hex('#FF6B35'),        // Spark orange
  star:    chalk.hex('#FFD700'),        // Gold star
  dim:     chalk.hex('#4A4A6A'),        // muted purple-grey
  code:    chalk.hex('#7FDBCA'),        // teal for code/files
  success: chalk.hex('#00FF88'),        // bright green
  error:   chalk.hex('#FF4757'),        // bright red
  warn:    chalk.hex('#FFA502'),        // amber
  ai:      chalk.hex('#A78BFA'),        // purple for AI responses
  user:    chalk.hex('#38BDF8'),        // sky blue for user input
  muted:   chalk.hex('#6B7280'),        // grey
  white:   chalk.white,
  bold:    chalk.bold,
};

// ─── Star field — simple spinner-based animation, no cursor movement ─────────
const STAR_FRAMES = [
  '  ✦   ·   ✸   ·   ✦   ·   ∗   ·   ✧   ·   ✹   ·   ⋆   ·   ✦',
  '  ·   ✸   ·   ✦   ·   ✺   ·   ✦   ·   ∗   ·   ✧   ·   ✹   ·',
  '  ✧   ·   ✦   ·   ⋆   ·   ✸   ·   ✦   ·   ✹   ·   ∗   ·   ✧',
  '  ·   ✦   ·   ∗   ·   ✧   ·   ✸   ·   ⋆   ·   ✺   ·   ✦   ·',
];

let starTimer = null;
let starFrame  = 0;

export function startStarField() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\n');
  starTimer = setInterval(() => {
    const f   = STAR_FRAMES[starFrame % STAR_FRAMES.length];
    const col = starFrame % 2 === 0 ? '#FFD700' : '#FF6B35';
    process.stdout.write('\r' + chalk.hex(col)(f) + '  ');
    starFrame++;
  }, 180);
}

export function stopStarField() {
  if (starTimer) {
    clearInterval(starTimer);
    starTimer = null;
    process.stdout.write('\r' + ' '.repeat(70) + '\r\n');
  }
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
const SPIN_FRAMES = ['◐', '◓', '◑', '◒'];
const STAR_SPIN   = ['✦ ', ' ✦', '  ', '✦ '];

let spinInterval = null;
let spinFrame = 0;

export function startSpinner(label = 'Thinking') {
  spinFrame = 0;
  process.stdout.write('\n');
  spinInterval = setInterval(() => {
    const f = SPIN_FRAMES[spinFrame % SPIN_FRAMES.length];
    const s = STAR_SPIN[spinFrame % STAR_SPIN.length];
    process.stdout.write(
      `\r  ${c.star(s)} ${c.spark(f)} ${c.muted(label + '...')}   `
    );
    spinFrame++;
  }, 80);
}

export function stopSpinner(msg = '') {
  if (spinInterval) {
    clearInterval(spinInterval);
    spinInterval = null;
    process.stdout.write(`\r${' '.repeat(60)}\r`);
    if (msg) process.stdout.write(msg + '\n');
  }
}

// ─── Banner ───────────────────────────────────────────────────────────────────
export function printBanner() {
  const cols = process.stdout.columns || 80;

  // Animate stars dropping across the banner area
  const topStars = Array.from({ length: cols }, (_, i) => {
    if (i % 7 === 0) return c.star(STAR_CHARS[i % STAR_CHARS.length]);
    if (i % 13 === 0) return c.spark('·');
    return ' ';
  }).join('');

  console.log(topStars);
  console.log();
  console.log(
    c.spark.bold('  ███████╗██████╗  █████╗ ██████╗ ██╗  ██╗') + '  ' + c.star('✦')
  );
  console.log(
    c.spark.bold('  ██╔════╝██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝') + '  ' + c.ai('agent')
  );
  console.log(
    c.spark.bold('  ███████╗██████╔╝███████║██████╔╝█████╔╝ ')
  );
  console.log(
    c.spark.bold('  ╚════██║██╔═══╝ ██╔══██║██╔══██╗██╔═██╗ ')
  );
  console.log(
    c.spark.bold('  ███████║██║     ██║  ██║██║  ██║██║  ██╗') + '  ' + c.muted('v1.0.0')
  );
  console.log(
    c.spark.bold('  ╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝')
  );
  console.log();
  console.log(
    '  ' + c.star('✦ ') +
    c.white.bold('Spark Code 1.2') +
    c.spark('  Terminal AI Coding Agent') +
    c.star(' ✦')
  );
  console.log(
    '  ' + c.muted('Auto-routing · GPT-5.3 Codex · Gemini · Grok · DeepSeek')
  );
  console.log(topStars);
  console.log();
}

// ─── Section headers ──────────────────────────────────────────────────────────
export function printSection(title) {
  const line = c.dim('─'.repeat(Math.max(0, (process.stdout.columns || 80) - 4)));
  console.log('\n' + c.star('  ✦ ') + c.white.bold(title));
  console.log('  ' + line);
}

// ─── Tool use display ─────────────────────────────────────────────────────────
export function printTool(verb, target, extra = '') {
  const icons = {
    Read:    c.code('📖'),
    Write:   c.success('✏️ '),
    Create:  c.success('✨'),
    Delete:  c.error('🗑 '),
    Run:     c.warn('⚡'),
    Search:  c.ai('🔍'),
    Think:   c.ai('💭'),
    List:    c.code('📂'),
  };
  const icon = icons[verb] || c.muted('·');
  const label = c.muted(verb.padEnd(8));
  const tgt   = c.code(target);
  const ext   = extra ? c.muted('  ' + extra) : '';
  console.log(`  ${icon} ${label} ${tgt}${ext}`);
}

// ─── AI response stream printer ───────────────────────────────────────────────
export function printAIChunk(chunk) {
  process.stdout.write(c.ai(chunk));
}

export function printAIEnd() {
  process.stdout.write('\n\n');
}

// ─── Error / success banners ──────────────────────────────────────────────────
export function printError(msg) {
  console.log('\n  ' + c.error('✖ ') + c.error.bold(msg) + '\n');
}

export function printSuccess(msg) {
  console.log('\n  ' + c.success('✔ ') + c.success.bold(msg) + '\n');
}

export function printWarn(msg) {
  console.log('  ' + c.warn('⚠ ') + c.warn(msg));
}

export function printInfo(msg) {
  console.log('  ' + c.muted('ℹ ') + c.muted(msg));
}

// ─── Prompt line ─────────────────────────────────────────────────────────────
export function promptLine(cwd) {
  const dir = cwd.replace(process.env.HOME || '', '~');
  return c.spark('  ✦ ') + c.code(dir) + c.spark(' › ') + c.user('');
}

// ─── Diff / file change preview ───────────────────────────────────────────────
export function printFileDiff(path, oldLines, newLines) {
  console.log('\n  ' + c.code('📄 ') + c.code.bold(path));
  const maxShow = 20;
  let shown = 0;
  for (let i = 0; i < Math.max(oldLines.length, newLines.length) && shown < maxShow; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o !== n) {
      if (o !== undefined) console.log(c.error('  - ' + o));
      if (n !== undefined) console.log(c.success('  + ' + n));
      shown++;
    }
  }
  if (shown === maxShow) console.log(c.muted('  ... (truncated)'));
  console.log();
}

// ─── Help text ────────────────────────────────────────────────────────────────
export function printHelp() {
  printSection('Commands');
  const cmds = [
    ['/help',         'Show this help'],
    ['/whoami',       'Show who you are signed in as'],
    ['/logout',       'Sign out of Spark'],
    ['/cd <path>',    'Change working directory'],
    ['/ls [path]',    'List directory contents'],
    ['/history',      'Show session history'],
    ['/builds',       'Show your saved builds in Spark DB'],
    ['/clear',        'Clear the screen'],
    ['/exit  (or q)', 'Exit Spark Code 1.2'],
  ];
  cmds.forEach(([cmd, desc]) => {
    console.log('  ' + c.code(cmd.padEnd(22)) + c.muted(desc));
  });
  console.log();
  printSection('What I can do');
  const caps = [
    '✦  Auto-routes each task to the best AI engine',
    '✦  Read, create, edit, and delete files',
    '✦  Run shell commands and scripts',
    '✦  Build full apps from a single prompt',
    '✦  Explain, refactor, and debug your code',
    '✦  Save every build to your Spark database',
  ];
  caps.forEach(cap => console.log('  ' + c.spark(cap)));
  console.log();
}
