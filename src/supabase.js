import { createClient } from '@supabase/supabase-js';
import { printWarn } from './ui.js';
import { loadAuth } from './auth.js';

let supabase = null;

export function getSupabase() {
  if (supabase) return supabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    printWarn('Supabase not configured — sessions will not be saved to the database');
    return null;
  }

  supabase = createClient(url, key, {
    auth: { persistSession: false },
  });
  return supabase;
}

// ─── Create a new agent session row ──────────────────────────────────────────
export async function createAgentSession({ userId, model, cwd }) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('spark_agent_sessions')
    .insert({
      user_id:   userId || null,
      model,
      working_dir: cwd,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    printWarn(`DB: could not create session — ${error.message}`);
    return null;
  }
  return data.id;
}

// ─── Append a message to the session ─────────────────────────────────────────
export async function logMessage({ sessionId, role, content }) {
  const db = getSupabase();
  if (!db || !sessionId) return;

  const { error } = await db
    .from('spark_agent_messages')
    .insert({ session_id: sessionId, role, content });

  if (error) printWarn(`DB: message log failed — ${error.message}`);
}

// ─── Record a build (files created / commands run) ───────────────────────────
export async function logBuild({ sessionId, userId, description, filesTouched, commandsRun, cwd }) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('spark_agent_builds')
    .insert({
      session_id:     sessionId || null,
      user_id:        userId || null,
      description,
      files_touched:  filesTouched,
      commands_run:   commandsRun,
      working_dir:    cwd,
      built_at:       new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    printWarn(`DB: build log failed — ${error.message}`);
    return null;
  }
  return data?.id;
}

// ─── Close a session ─────────────────────────────────────────────────────────
export async function closeAgentSession(sessionId, stats) {
  const db = getSupabase();
  if (!db || !sessionId) return;

  await db
    .from('spark_agent_sessions')
    .update({
      ended_at:       new Date().toISOString(),
      message_count:  stats.messageCount,
      files_touched:  stats.filesTouched,
      commands_run:   stats.commandsRun,
    })
    .eq('id', sessionId);
}

// ─── Fetch builds for a user (for /builds command) ───────────────────────────
export async function fetchBuilds(userId, limit = 10) {
  const db = getSupabase();
  if (!db) return [];

  const query = db
    .from('spark_agent_builds')
    .select('id, description, files_touched, commands_run, working_dir, built_at')
    .order('built_at', { ascending: false })
    .limit(limit);

  if (userId) query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) {
    printWarn(`DB: fetch builds failed — ${error.message}`);
    return [];
  }
  return data || [];
}

// ─── Get current user from local auth file ────────────────────────────────────
export async function getCurrentUser() {
  const auth = loadAuth();
  if (!auth?.user_id) return null;
  return { id: auth.user_id, email: auth.email };
}
