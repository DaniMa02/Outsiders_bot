-- Tabla de recordatorios de eventos
-- Cada evento manual tiene un recordatorio programado para 10 min antes
CREATE TABLE IF NOT EXISTS event_reminders (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  send_at TIMESTAMP NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_reminders_pending
  ON event_reminders(sent, send_at)
  WHERE sent = FALSE;
