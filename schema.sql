-- ============================================================
--  Spark Agent  —  Terminal AI Coding Agent Database Schema
--  Run this in your Supabase SQL Editor
--  https://dnnbnwsqcixcwhrbohwn.supabase.co
-- ============================================================

-- ============================================================
-- 1. spark_agent_sessions
--    One row per terminal session (each time you run `spark`)
-- ============================================================
CREATE TABLE IF NOT EXISTS spark_agent_sessions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    model         TEXT        NOT NULL DEFAULT 'claude-sonnet-4-6',
    working_dir   TEXT,
    started_at    TIMESTAMPTZ DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    message_count INT         DEFAULT 0,
    files_touched TEXT[]      DEFAULT '{}',
    commands_run  TEXT[]      DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id
    ON spark_agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_started_at
    ON spark_agent_sessions(started_at DESC);

ALTER TABLE spark_agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own sessions"
    ON spark_agent_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on sessions"
    ON spark_agent_sessions FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================
-- 2. spark_agent_messages
--    Every message exchanged in a session (user + assistant + tools)
-- ============================================================
CREATE TABLE IF NOT EXISTS spark_agent_messages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID        NOT NULL REFERENCES spark_agent_sessions(id) ON DELETE CASCADE,
    role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session_id
    ON spark_agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_created_at
    ON spark_agent_messages(created_at ASC);

ALTER TABLE spark_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see messages in own sessions"
    ON spark_agent_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM spark_agent_sessions s
            WHERE s.id = spark_agent_messages.session_id
            AND   s.user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access on messages"
    ON spark_agent_messages FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================
-- 3. spark_agent_builds
--    One row per "build event" — whenever the agent creates or
--    modifies files in response to a user prompt.
--    This is the table you can browse to see what users built.
-- ============================================================
CREATE TABLE IF NOT EXISTS spark_agent_builds (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID        REFERENCES spark_agent_sessions(id) ON DELETE SET NULL,
    user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    description   TEXT,                        -- the user's original prompt (truncated)
    files_touched TEXT[]      DEFAULT '{}',    -- list of file paths written/created
    commands_run  TEXT[]      DEFAULT '{}',    -- list of shell commands executed
    working_dir   TEXT,                        -- filesystem path of the project
    built_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_builds_user_id
    ON spark_agent_builds(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_builds_built_at
    ON spark_agent_builds(built_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_builds_session_id
    ON spark_agent_builds(session_id);

ALTER TABLE spark_agent_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own builds"
    ON spark_agent_builds FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on builds"
    ON spark_agent_builds FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================
-- 4. Convenience view — spark_agent_build_summary
--    Shows each user's builds with email pulled from auth.users
--    Useful in Supabase Studio Table Editor
-- ============================================================
CREATE OR REPLACE VIEW spark_agent_build_summary AS
SELECT
    b.id,
    u.email                                      AS user_email,
    b.description,
    array_length(b.files_touched, 1)             AS files_count,
    b.files_touched,
    array_length(b.commands_run, 1)              AS commands_count,
    b.commands_run,
    b.working_dir,
    b.built_at,
    s.model                                      AS ai_model,
    s.started_at                                 AS session_started
FROM  spark_agent_builds b
LEFT  JOIN auth.users               u ON u.id = b.user_id
LEFT  JOIN spark_agent_sessions     s ON s.id = b.session_id
ORDER BY b.built_at DESC;

-- Grant read on the view to the service role
GRANT SELECT ON spark_agent_build_summary TO service_role;

-- ============================================================
-- 5. Convenience view — spark_agent_session_summary
--    Overview of all terminal sessions with user email
-- ============================================================
CREATE OR REPLACE VIEW spark_agent_session_summary AS
SELECT
    s.id,
    u.email                                  AS user_email,
    s.model                                  AS ai_model,
    s.working_dir,
    s.started_at,
    s.ended_at,
    EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::INT AS duration_seconds,
    s.message_count,
    array_length(s.files_touched, 1)         AS files_count,
    s.files_touched,
    array_length(s.commands_run, 1)          AS commands_count
FROM  spark_agent_sessions s
LEFT  JOIN auth.users u ON u.id = s.user_id
ORDER BY s.started_at DESC;

GRANT SELECT ON spark_agent_session_summary TO service_role;

-- ============================================================
-- Done!
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '✦ Spark Agent schema created successfully!';
    RAISE NOTICE '   Tables  : spark_agent_sessions, spark_agent_messages, spark_agent_builds';
    RAISE NOTICE '   Views   : spark_agent_build_summary, spark_agent_session_summary';
    RAISE NOTICE '   Security: RLS enabled on all tables (service_role bypasses for agent)';
END $$;
