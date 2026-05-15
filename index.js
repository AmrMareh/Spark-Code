#!/usr/bin/env node
import 'dotenv/config';
import { printBanner, startStarField, stopStarField, printError, c } from './src/ui.js';
import { initSession, runREPL } from './src/agent.js';

// ─── Startup ──────────────────────────────────────────────────────────────────
async function main() {
  // Parse CLI flags
  const args = process.argv.slice(2);
  const modelFlag = args.find(a => a.startsWith('--model='));
  if (modelFlag) {
    const { setModel } = await import('./src/ai.js');
    setModel(modelFlag.split('=')[1]);
  }

  // Print animated banner with star field
  printBanner();

  // Kick off a brief star animation above the prompt
  startStarField(2);

  // Give stars a moment to sparkle before the prompt appears
  await new Promise(r => setTimeout(r, 1200));
  stopStarField();

  // Init DB session
  try {
    await initSession();
  } catch (e) {
    // Non-fatal — continue without DB
    printError(`DB init skipped: ${e.message}`);
  }

  // Print quick tip
  console.log(c.muted('  Type /help for commands, or just ask me anything.\n'));

  // Start the interactive REPL
  await runREPL();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
