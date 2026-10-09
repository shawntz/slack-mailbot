CREATE TABLE IF NOT EXISTS email_usage_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  category TEXT,
  gmail_message_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_usage_events_ws_user_time
  ON email_usage_events (workspace_id, slack_user_id, occurred_at);

-- Best-effort, idempotent backfill so the heatmap is not empty on first use.
-- Each existing Gmail thread mapping is treated as one inbound email event,
-- attributed to the Slack user who owns the mapping. workspace_id is stored as
-- the Slack team id (TEXT) to match how events are recorded at runtime, so we
-- join through workspaces to translate the internal workspace id. Guarded so
-- re-running the migration never duplicates rows.
INSERT INTO email_usage_events
  (workspace_id, slack_user_id, direction, category, gmail_message_id, occurred_at)
SELECT
  w.slack_team_id,
  t.slack_user_id,
  'inbound',
  NULL,
  t.last_message_id,
  t.created_at
FROM gmail_thread_slack_threads t
JOIN workspaces w ON w.id = t.workspace_id
WHERE NOT EXISTS (SELECT 1 FROM email_usage_events);
