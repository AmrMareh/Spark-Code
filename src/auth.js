import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { c, printSuccess, printError, printInfo, startSpinner, stopSpinner } from './ui.js';

const AUTH_FILE  = path.join(os.homedir(), '.spark-code', 'auth.json');
const APP_URL    = 'https://sparkchat.live';
const POLL_MS    = 2000;
const EXPIRE_MS  = 10 * 60 * 1000; // 10 minutes

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
}

// ─── Save / load local auth token ────────────────────────────────────────────
export function saveAuth(data) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function loadAuth() {
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearAuth() {
  try { fs.unlinkSync(AUTH_FILE); } catch {}
}

export function isLoggedIn() {
  const auth = loadAuth();
  if (!auth) return false;
  // Check token not expired
  if (auth.expires_at && Date.now() > auth.expires_at) return false;
  return true;
}

// ─── Open browser cross-platform ─────────────────────────────────────────────
function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === 'darwin')      execFileSync('open',     [url]);
    else if (platform === 'win32')  execFileSync('cmd',      ['/c', 'start', '', url]);
    else                            execFileSync('xdg-open', [url]);
  } catch {
    // If browser open fails, user sees the URL printed
  }
}

// ─── Prompt user for input ────────────────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Main login flow ──────────────────────────────────────────────────────────
export async function login() {
  const db = getSupabase();

  // 1. Generate a unique device code
  const deviceCode = crypto.randomUUID();

  // 2. Insert pending session into DB
  const { error: insertErr } = await db
    .from('spark_cli_sessions')
    .insert({ device_code: deviceCode, status: 'pending' });

  if (insertErr) {
    printError(`Auth error: ${insertErr.message}`);
    process.exit(1);
  }

  // 3. Open browser
  const authUrl = `${APP_URL}/cli-auth?device=${deviceCode}`;
  console.log('\n' + c.star('  ✦ ') + c.white.bold('Opening Spark in your browser...'));
  console.log('  ' + c.muted('If it didn\'t open, go to:'));
  console.log('  ' + c.code(authUrl) + '\n');
  openBrowser(authUrl);

  // 4. Ask for the 6-digit code (max 3 attempts)
  const MAX_PIN_ATTEMPTS = 3;
  let session = null;

  for (let attempt = 1; attempt <= MAX_PIN_ATTEMPTS; attempt++) {
    const pin = await prompt(c.spark(`  ✦ Enter the 6-digit code from your browser (attempt ${attempt}/${MAX_PIN_ATTEMPTS}): `));

    if (!pin || !/^\d{6}$/.test(pin)) {
      printError('Code must be exactly 6 digits.');
      if (attempt === MAX_PIN_ATTEMPTS) {
        await db.from('spark_cli_sessions').delete().eq('device_code', deviceCode);
        process.exit(1);
      }
      continue;
    }

    // 5. Verify pin against DB
    startSpinner('Verifying');
    const { data: row, error: fetchErr } = await db
      .from('spark_cli_sessions')
      .select('*')
      .eq('device_code', deviceCode)
      .eq('pin', pin)
      .eq('status', 'pin_ready')
      .gte('expires_at', new Date().toISOString())
      .single();
    stopSpinner();

    if (!fetchErr && row) {
      session = row;
      break;
    }

    if (attempt < MAX_PIN_ATTEMPTS) {
      printError(`Incorrect code. ${MAX_PIN_ATTEMPTS - attempt} attempt(s) remaining.`);
    } else {
      printError('Too many incorrect attempts. Please run spark-code again to retry.');
      await db.from('spark_cli_sessions').delete().eq('device_code', deviceCode);
      process.exit(1);
    }
  }

  if (!session) {
    await db.from('spark_cli_sessions').delete().eq('device_code', deviceCode);
    process.exit(1);
  }

  // 6. Mark session as verified
  await db
    .from('spark_cli_sessions')
    .update({ status: 'verified' })
    .eq('device_code', deviceCode);

  // 7. Save auth locally
  saveAuth({
    user_id:    session.user_id,
    email:      session.user_email,
    device_code: deviceCode,
    logged_in_at: Date.now(),
    expires_at:   Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
  });

  printSuccess(`Logged in as ${session.user_email}`);
  console.log();
  return session.user_email;
}

// ─── Logout ───────────────────────────────────────────────────────────────────
export async function logout() {
  const auth = loadAuth();
  if (auth?.device_code) {
    const db = getSupabase();
    await db.from('spark_cli_sessions').delete().eq('device_code', auth.device_code);
  }
  clearAuth();
  printSuccess('Logged out.');
}
