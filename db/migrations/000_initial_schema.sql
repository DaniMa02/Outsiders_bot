-- ============================================================
-- SCHEMA COMPLETO DE LA BASE DE DATOS
-- Reconstruido a partir del código del bot.
-- Si vas a crear la BD desde cero, ejecuta SOLO este archivo.
-- Si ya existe, las CREATE TABLE/INDEX IF NOT EXISTS son idempotentes.
-- ============================================================

-- ============================================================
-- 1. USERS
-- Almacena los usuarios de Discord conocidos por el bot.
-- - discord_id: ID de Discord (TEXT para soportar también IDs
--   "manual_<id>" de participantes añadidos a mano).
-- - nickname: nickname actual en el servidor (se sincroniza en
--   cada GuildMemberUpdate, con IS DISTINCT FROM para no escribir
--   si no cambió).
-- - class: clase inferida desde los roles de Discord
--   (ARCHER, SWORDSMAN, MAGE, MARTIAL_ARTIST o NULL).
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  nickname   TEXT,
  class      TEXT
);

-- ============================================================
-- 2. USER_ROLE_CAPABILITIES
-- Capabilities que un usuario puede tener para apuntarse a
-- eventos con roles (Hell/Hardcore). Una fila por (discord_id, role).
-- Roles posibles: 'HTank', 'HDD', 'HHealer', 'HDebuffer', 'HLurer'
-- ============================================================
CREATE TABLE IF NOT EXISTS user_role_capabilities (
  id         SERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  UNIQUE (discord_id, role)
);

-- ============================================================
-- 3. EVENTS
-- Eventos (Hell / Hardcore / Raid).
-- - type: 'hell' | 'hardcore' | 'raid'
-- - status: 'OPEN' | 'FINISHED'
-- - composition: 0 (A) | 1 (B) — solo aplica a Hardcore
-- - message_id: ID del embed en Discord (se borra 1h tras FINISHED)
-- - embed_deletion_scheduled: flag interno (no se usa activamente
--   en el código actual, pero la columna existe y la query la
--   referencia, así que la conservamos)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id                       SERIAL PRIMARY KEY,
  type                     TEXT NOT NULL,
  title                    TEXT NOT NULL,
  datetime                 TIMESTAMP NOT NULL,
  channel_id               TEXT NOT NULL,
  message_id               TEXT,
  created_by               TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'OPEN',
  composition              SMALLINT DEFAULT 0,
  embed_deletion_scheduled BOOLEAN DEFAULT FALSE,
  created_at               TIMESTAMP DEFAULT NOW(),
  updated_at               TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 4. EVENT_PARTICIPANTS
-- - Usuarios (o entradas manuales) apuntados a un evento.
-- - discord_id: ID real o 'manual_<eventId>_<sanitizedName>'
-- - state: 'ACTIVE' | 'RESERVE' | 'ABSENCE'
-- - assigned_role: 'tank' | 'holy' | 'debuffer' | 'dd' | 'second_lurer' | NULL
-- - joined_at: se preserva entre re-apuntados (no se actualiza
--   en reactivateParticipant), sirve para mantener la posición
--   global en el embed.
-- ============================================================
CREATE TABLE IF NOT EXISTS event_participants (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  discord_id    TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'ACTIVE',
  assigned_role TEXT,
  joined_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. BOT_VARIABLES
-- Pares clave→valor para variables configurables (IDs de
-- canales, roles, etc.). El INSERT usa ON CONFLICT (key) DO UPDATE.
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_variables (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================================================
-- 6. SCHEDULED_MESSAGES
-- Mensajes programados (cron) por el bot.
-- - channel_id: se guarda como '{{KEY}}' y se resuelve en el envío.
-- - send_time: 'HH:MM'
-- - days_of_week: '0,1,2,3,4,5,6' (0=Domingo)
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id            SERIAL PRIMARY KEY,
  content       TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  send_time     TEXT NOT NULL,
  days_of_week  TEXT NOT NULL
);

-- ============================================================
-- 7. EVENT_REMINDERS
-- Recordatorios de eventos. Cada evento tiene DOS recordatorios:
--   - send_at  (canal, 10 min antes)
--   - dm_send_at (DM individual, 15 min antes)
-- reminder_message_id: ID del mensaje de recordatorio enviado al
-- canal, para borrarlo junto al embed cuando el evento finaliza.
-- ============================================================
CREATE TABLE IF NOT EXISTS event_reminders (
  id                   SERIAL PRIMARY KEY,
  event_id             INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  send_at              TIMESTAMP NOT NULL,
  sent                 BOOLEAN DEFAULT FALSE,
  sent_at              TIMESTAMP,
  dm_send_at           TIMESTAMP,
  dm_sent              BOOLEAN DEFAULT FALSE,
  dm_sent_at           TIMESTAMP,
  reminder_message_id  TEXT,
  created_at           TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- ÍNDICES (incluye los de la migración 003_indexes.sql)
-- Reducen el consumo de CU-hrs en Supabase al evitar seq scans.
-- ============================================================

-- events.message_id: usado por getEventFromMessageId() en CADA
-- click de botón (join, absence, role, manual, edit, cancel, move…)
CREATE INDEX IF NOT EXISTS idx_events_message_id
  ON events(message_id)
  WHERE message_id IS NOT NULL;

-- event_participants: la query más caliente del bot.
-- Filtra siempre por event_id y state, y ordena por joined_at.
CREATE INDEX IF NOT EXISTS idx_event_participants_event_state_joined
  ON event_participants(event_id, state, joined_at);

-- Conteo/filtro por rol (countActiveParticipantsByRole,
-- getFirstReserveForRole, toggleEventComposition).
CREATE INDEX IF NOT EXISTS idx_event_participants_event_role_state
  ON event_participants(event_id, assigned_role, state);

-- Búsqueda rápida de un participante concreto en un evento
-- (getParticipant, handleAbsenceButton, addManualParticipant).
CREATE INDEX IF NOT EXISTS idx_event_participants_event_discord
  ON event_participants(event_id, discord_id);

-- user_role_capabilities: getUserCapabilities() se llama en CADA
-- click de botón de rol y en promoteReserveToActive.
CREATE INDEX IF NOT EXISTS idx_user_role_capabilities_discord
  ON user_role_capabilities(discord_id);

-- event_reminders: getEventsToFinish() y loadScheduledReminders().
CREATE INDEX IF NOT EXISTS idx_event_reminders_pending
  ON event_reminders(sent, send_at)
  WHERE sent = FALSE;

-- Cubre ORDER BY send_at cuando se listan los pendientes.
CREATE INDEX IF NOT EXISTS idx_event_reminders_pending_send
  ON event_reminders(send_at)
  WHERE sent = FALSE;
