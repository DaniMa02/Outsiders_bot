// db/eventRepository.js
import { query } from './database.js';

/**
 * FUNCIONES DE REPOSITORIO PARA EVENTOS
 * Abstracción de acceso a BD para operaciones genéricas de eventos
 */

// ==================== EVENTOS ====================

/**
 * Obtener evento por ID
 */
export async function getEventById(eventId) {
  const res = await query('SELECT * FROM events WHERE id = $1', [eventId]);
  return res.rows[0] || null;
}

/**
 * Obtener eventos OPEN con paginación
 */
export async function getOpenEvents(limit = 50, offset = 0) {
  const res = await query(
    `SELECT * FROM events WHERE status = $1 ORDER BY datetime ASC LIMIT $2 OFFSET $3`,
    ['OPEN', limit, offset]
  );
  return res.rows;
}

/**
 * Obtener eventos por tipo (ej: todos los eventos 'hell' OPEN)
 */
export async function getEventsByType(type, status = 'OPEN') {
  const res = await query(
    `SELECT * FROM events WHERE type = $1 AND status = $2 ORDER BY datetime ASC`,
    [type, status]
  );
  return res.rows;
}

/**
 * Obtener eventos que necesitan cambiar de estado (OPEN → FINISHED)
 */
export async function getEventsToFinish() {
  const res = await query(
    `SELECT * FROM events WHERE status = $1 AND datetime <= NOW()`,
    ['OPEN']
  );
  return res.rows;
}

/**
 * Crear evento
 */
export async function createEvent({ type, title, datetime, channelId, createdBy }) {
  const res = await query(
    `INSERT INTO events (type, title, datetime, channel_id, created_by, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING id, type, title, datetime, channel_id, status`,
    [type, title, datetime, channelId, createdBy, 'OPEN']
  );
  return res.rows[0];
}

/**
 * Actualizar estado de evento
 */
export async function updateEventStatus(eventId, status) {
  const res = await query(
    `UPDATE events SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, eventId]
  );
  return res.rows[0];
}

/**
 * Actualizar message_id del evento
 */
export async function updateEventMessageId(eventId, messageId) {
  const res = await query(
    `UPDATE events SET message_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [messageId, eventId]
  );
  return res.rows[0];
}

/**
 * Actualizar flag de eliminación programada
 */
export async function markEmbedDeletionScheduled(eventId, scheduled = true) {
  await query(
    `UPDATE events SET embed_deletion_scheduled = $1 WHERE id = $2`,
    [scheduled, eventId]
  );
}

/**
 * Eliminar evento (y sus participantes automáticamente por FK)
 */
export async function deleteEvent(eventId) {
  await query(`DELETE FROM events WHERE id = $1`, [eventId]);
}

// ==================== PARTICIPANTES ====================

/**
 * Obtener participante específico
 */
export async function getParticipant(eventId, discordId) {
  const res = await query(
    `SELECT * FROM event_participants WHERE event_id = $1 AND discord_id = $2`,
    [eventId, discordId]
  );
  return res.rows[0] || null;
}

/**
 * Obtener todos los participantes de un evento
 */
export async function getEventParticipants(eventId) {
  const res = await query(
    `SELECT ep.*, u.nickname
     FROM event_participants ep
     LEFT JOIN users u ON u.discord_id = ep.discord_id
     WHERE ep.event_id = $1
     ORDER BY ep.joined_at ASC`,
    [eventId]
  );
  return res.rows;
}

/**
 * Obtener participantes por estado
 */
export async function getParticipantsByState(eventId, state) {
  const res = await query(
    `SELECT ep.*, u.nickname
     FROM event_participants ep
     LEFT JOIN users u ON u.discord_id = ep.discord_id
     WHERE ep.event_id = $1 AND ep.state = $2
     ORDER BY ep.joined_at ASC`,
    [eventId, state]
  );
  return res.rows;
}

/**
 * Contar participantes activos por rol
 * Usa LOWER() para evitar inconsistencias por mayúsculas/minúsculas
 */
export async function countActiveParticipantsByRole(eventId, role) {
  const res = await query(
    `SELECT COUNT(*)::int as count FROM event_participants
     WHERE event_id = $1 AND state = $2 AND LOWER(assigned_role) = LOWER($3)`,
    [eventId, 'ACTIVE', role]
  );
  return res.rows[0].count;
}

/**
 * Contar todos los participantes activos
 */
export async function countActiveParticipants(eventId) {
  const res = await query(
    `SELECT COUNT(*)::int as count FROM event_participants 
     WHERE event_id = $1 AND state = $2`,
    [eventId, 'ACTIVE']
  );
  return res.rows[0].count;
}

/**
 * Agregar participante a evento
 * Normaliza el rol a minúsculas para evitar inconsistencias
 */
export async function addParticipant({ eventId, discordId, state = 'ACTIVE', assignedRole = null }) {
  const normalizedRole = assignedRole ? assignedRole.toLowerCase() : null;
  const res = await query(
    `INSERT INTO event_participants (event_id, discord_id, state, assigned_role, joined_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [eventId, discordId, state, normalizedRole]
  );
  return res.rows[0];
}

/**
 * Actualizar estado de participante
 */
export async function updateParticipantState(participantId, newState) {
  const res = await query(
    `UPDATE event_participants SET state = $1 WHERE id = $2 RETURNING *`,
    [newState, participantId]
  );
  return res.rows[0];
}

/**
 * Reactivar participante (ABSENCE → ACTIVE/RESERVE) actualizando estado y rol
 * Normaliza el rol a minúsculas
 */
export async function reactivateParticipant({ participantId, state, assignedRole }) {
  const normalizedRole = assignedRole ? assignedRole.toLowerCase() : null;
  const res = await query(
    `UPDATE event_participants
     SET state = $1, assigned_role = $2
     WHERE id = $3
     RETURNING *`,
    [state, normalizedRole, participantId]
  );
  return res.rows[0];
}

/**
 * Actualizar rol asignado a participante
 * Normaliza el rol a minúsculas
 */
export async function updateParticipantRole(participantId, role) {
  const normalizedRole = role ? role.toLowerCase() : null;
  const res = await query(
    `UPDATE event_participants SET assigned_role = $1 WHERE id = $2 RETURNING *`,
    [normalizedRole, participantId]
  );
  return res.rows[0];
}

/**
 * Obtener primer RESERVE que cumple rol específico.
 *
 * @param {number} eventId
 * @param {string} roleNeeded
 * @param {number[]} [excludeIds] - IDs de participantes a excluir (p.ej.
 *   los que ya probamos y no tenían capability, para no entrar en bucle).
 */
export async function getFirstReserveForRole(eventId, roleNeeded, excludeIds = []) {
  if (excludeIds.length > 0) {
    const res = await query(
      `SELECT ep.*, u.nickname
       FROM event_participants ep
       LEFT JOIN users u ON u.discord_id = ep.discord_id
       WHERE ep.event_id = $1 AND ep.state = $2 AND ep.assigned_role = $3
         AND NOT (ep.id = ANY($4::int[]))
       ORDER BY ep.joined_at ASC
       LIMIT 1`,
      [eventId, 'RESERVE', roleNeeded, excludeIds]
    );
    return res.rows[0] || null;
  }

  const res = await query(
    `SELECT ep.*, u.nickname
     FROM event_participants ep
     LEFT JOIN users u ON u.discord_id = ep.discord_id
     WHERE ep.event_id = $1 AND ep.state = $2 AND ep.assigned_role = $3
     ORDER BY ep.joined_at ASC
     LIMIT 1`,
    [eventId, 'RESERVE', roleNeeded]
  );
  return res.rows[0] || null;
}

/**
 * Eliminar participante
 */
export async function deleteParticipant(participantId) {
  await query(`DELETE FROM event_participants WHERE id = $1`, [participantId]);
}

// ==================== CAPABILITIES ====================

/**
 * Obtener todas las capabilities de un usuario
 */
export async function getUserCapabilities(discordId) {
  const res = await query(
    `SELECT role FROM user_role_capabilities WHERE discord_id = $1`,
    [discordId]
  );
  return res.rows.map(r => r.role);
}

/**
 * Agregar capability a usuario
 */
export async function addUserCapability(discordId, role) {
  await query(
    `INSERT INTO user_role_capabilities (discord_id, role)
     VALUES ($1, $2)
     ON CONFLICT (discord_id, role) DO NOTHING`,
    [discordId, role]
  );
}

/**
 * Eliminar capability de usuario
 */
export async function removeUserCapability(discordId, role) {
  await query(
    `DELETE FROM user_role_capabilities WHERE discord_id = $1 AND role = $2`,
    [discordId, role]
  );
}

// ==================== USUARIOS ====================

/**
 * Obtener o crear usuario
 */
export async function getOrCreateUser(discordId, nickname) {
  const res = await query(
    `INSERT INTO users (discord_id, nickname) 
     VALUES ($1, $2)
     ON CONFLICT (discord_id) DO UPDATE SET nickname = $2
     RETURNING *`,
    [discordId, nickname]
  );
  return res.rows[0];
}

/**
 * Asignar clase a usuario (ARCHER, SWORDSMAN, MAGE, MARTIAL_ARTIST)
 */
export async function setUserClass(discordId, chosenClass) {
  try {
    await query(`
      INSERT INTO users (discord_id, class)
      VALUES ($1, $2)
      ON CONFLICT (discord_id) DO UPDATE SET class = $2;
    `, [discordId, chosenClass]);

    console.log(`✅ Clase de ${discordId} asignada: ${chosenClass}`);
  } catch (err) {
    console.error(`❌ Error asignando clase a ${discordId}:`, err);
  }
}
