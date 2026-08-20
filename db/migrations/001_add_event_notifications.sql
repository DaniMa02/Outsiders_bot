-- Add table to track per-event notification messages that should be deleted when the event embed is cleaned
CREATE TABLE IF NOT EXISTS event_notifications (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
