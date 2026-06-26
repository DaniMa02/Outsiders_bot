-- Índices para reducir el consumo de CU-hrs en Supabase
-- Sin cambiar la lógica: solo aceleran las queries existentes.

-- events.message_id: usado por getEventFromMessageId() en CADA click
-- de botón (join, absence, role, manual, edit, cancel, move, etc.)
CREATE INDEX IF NOT EXISTS idx_events_message_id
  ON events(message_id)
  WHERE message_id IS NOT NULL;

-- event_participants: la query más caliente del bot.
-- Filtra siempre por event_id y state, y ordena por joined_at.
CREATE INDEX IF NOT EXISTS idx_event_participants_event_state_joined
  ON event_participants(event_id, state, joined_at);

-- Conteo/filtro por rol (countActiveParticipantsByRole, getFirstReserveForRole)
CREATE INDEX IF NOT EXISTS idx_event_participants_event_role_state
  ON event_participants(event_id, assigned_role, state);

-- Búsqueda rápida de un participante concreto en un evento
CREATE INDEX IF NOT EXISTS idx_event_participants_event_discord
  ON event_participants(event_id, discord_id);

-- user_role_capabilities: getUserCapabilities() se llama en CADA click
-- de botón de rol y en promoteReserveToActive.
CREATE INDEX IF NOT EXISTS idx_user_role_capabilities_discord
  ON user_role_capabilities(discord_id);

-- event_reminders: getEventsToFinish() y loadScheduledReminders() ya usan
-- un índice, pero el ORDER BY send_at sin índice puede ser lento cuando
-- la tabla crece. Este índice compuesto cubre el patrón más habitual.
CREATE INDEX IF NOT EXISTS idx_event_reminders_pending_send
  ON event_reminders(send_at)
  WHERE sent = FALSE;
