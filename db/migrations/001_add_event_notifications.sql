-- 001_add_event_notifications.sql
-- Tabla para guardar mensajes de notificación relacionados con un evento
CREATE TABLE IF NOT EXISTS event_notifications (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
