#!/usr/bin/env node

// ── Load env FIRST before any other imports ──────────────────────────────────
import { config } from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';

config({ path: join(process.cwd(), '.env') });
config({ path: join(homedir(), '.okran-code', '.env') });
config({ path: join(homedir(), '.env') });

// ── Now import everything else ────────────────────────────────────────────────
import { printBanner, startStarField, stopStarField, printError, printInfo, c } from './src/ui.js';
import { initSession, runREPL } from './src/agent.js';
import { isLoggedIn, login, logout, loadAuth } from './src/auth.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('logout')) {
    await logout();
    process.exit(0);
  }

  // Banner + star animation
  printBanner();
  startStarField();
  await new Promise(r => setTimeout(r, 1400));
  stopStarField();

  // Auth gate — must be signed in
  if (!isLoggedIn()) {
    console.log('  ' + c.star('✦ ') + c.white.bold('Sign in to Okran to continue\n'));
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

  // Init DB session (non-fatal)
  try { await initSession(); } catch {}

  console.log(c.muted('\n  Type /help for commands, or just ask Okran anything.\n'));
  await runREPL();
}

main().catch(e => { console.error(e); process.exit(1); });
