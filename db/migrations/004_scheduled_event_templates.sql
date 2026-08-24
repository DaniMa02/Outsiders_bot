CREATE TABLE IF NOT EXISTS scheduled_event_templates (
  id            SERIAL PRIMARY KEY,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  send_time     TEXT NOT NULL DEFAULT '22:00',
  event_time    TEXT NOT NULL DEFAULT '22:00',
  days_of_week  TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  composition   SMALLINT DEFAULT 0,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_event_templates_active_time
  ON scheduled_event_templates(active, send_time, days_of_week);
