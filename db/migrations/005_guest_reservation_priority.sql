ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS guest_signup_cutoff_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS guest_cutoff_processed_at TIMESTAMP;

ALTER TABLE event_participants
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE events
SET is_scheduled = TRUE,
    guest_signup_cutoff_at = datetime - INTERVAL '2 hours'
WHERE type = 'hardcore'
  AND created_by = 'SYSTEM_SCHEDULED_EVENT'
  AND guest_signup_cutoff_at IS NULL;

UPDATE events e
SET is_scheduled = TRUE,
    guest_signup_cutoff_at = e.datetime - INTERVAL '2 hours'
FROM scheduled_event_templates t
WHERE e.type = 'hardcore'
  AND e.status = 'OPEN'
  AND e.datetime > NOW()
  AND e.guest_signup_cutoff_at IS NULL
  AND e.type = t.type
  AND e.title = t.title
  AND e.channel_id = t.channel_id;

CREATE INDEX IF NOT EXISTS idx_events_guest_cutoff
  ON events(type, status, guest_signup_cutoff_at)
  WHERE guest_cutoff_processed_at IS NULL;
