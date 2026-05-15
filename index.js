#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

// Load .env — cwd first, then ~/.spark-code/.env
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(os.homedir(), '.env') });
dotenv.config({ path: path.join(os.homedir(), '.spark-code', '.env') });

import { printBanner, startStarField, stopStarField, printError, printInfo, printSuccess, c } from './src/ui.js';
import { initSession, runREPL } from './src/agent.js';
import { isLoggedIn, login, logout, loadAuth } from './src/auth.js';

async function main() {
  const args = process.argv.slice(2);

  // Handle logout command
  if (args.includes('logout')) {
    await logout();
    process.exit(0);
  }

  // Print banner + star animation
  printBanner();
  startStarField(2);
  await new Promise(r => setTimeout(r, 1200));
  stopStarField();

  // ── Auth gate ───────────────────────────────────────────────────────────
  if (!isLoggedIn()) {
    console.log(
      '  ' + c.star('✦ ') +
      c.white.bold('Sign in to Spark to continue') +
      '\n'
    );
    try {
      await login();
    } catch (e) {
      printError(`Login failed: ${e.message}`);
      process.exit(1);
    }
  } else {
    const auth = loadAuth();
    printInfo(`Signed in as ${c.spark(auth.email)}`);
  }

  // ── Init DB session ─────────────────────────────────────────────────────
  try {
    await initSession();
  } catch {
    // Non-fatal — continue without DB
  }

  console.log(c.muted('  Type /help for commands, or just ask me anything.\n'));

  await runREPL();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
