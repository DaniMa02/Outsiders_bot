// services/participantManager.js
import { query } from '../db/database.js';
import { getEvent } from './eventManager.js';
import { EVENT_CONFIG, PARTICIPANT_STATES } from '../config/eventConfig.js';
import {
  addParticipant,
  updateParticipantRole,
  countActiveParticipantsByRole,
  countActiveParticipants
} from '../db/eventRepository.js';

/**
 * SERVICIO DE GESTIÓN MANUAL DE PARTICIPANTES
 *
 * Pensado para casos donde se busca gente dentro del juego que no está
 * en Discord, o para recolocar manualmente a alguien (típico: mover a
 * familiar de tank a dd para liberar el slot de tank a un nuevo participante).
 *
 * Los participantes manuales se guardan con un discord_id fake
 * (prefijo `manual_`) y su nombre en users.nickname. El embed los
 * renderiza igual que a un usuario real.
 */

const FAKE_ID_PREFIX = 'manual_';

/**
 * Añadir participante manualmente a un evento
 *
 * @param {object} params
 * @param {number} params.eventId
 * @param {string} params.name - nombre del participante
 * @param {string|null} params.role - rol a asignar (obligatorio para hell/hardcore)
 * @returns {object} participante creado
 */
export async function addManualParticipant({ eventId, name, role }) {
  if (!name || !name.trim()) {
    throw new Error('❌ El nombre no puede estar vacío.');
  }

  const event = await getEvent(eventId);

  if (event.status !== 'OPEN') {
    throw new Error('❌ Este evento ya ha finalizado.');
  }

  const config = EVENT_CONFIG[event.type];
  const trimmedName = name.trim();
  const sanitizedName = trimmedName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  const fakeId = `${FAKE_ID_PREFIX}${eventId}_${sanitizedName}`;

  // Verificar si ya existe un participante con ese nombre en este evento
  const existing = await query(`
    SELECT ep.id FROM event_participants ep
    WHERE ep.event_id = $1 AND ep.discord_id = $2
  `, [eventId, fakeId]);

  if (existing.rowCount > 0) {
    throw new Error(`❌ Ya existe un participante llamado "${trimmedName}" en este evento.`);
  }

  // Validar rol si evento con roles
  if (config.roles_required) {
    if (!role) {
      throw new Error('❌ Este evento requiere que especifiques un rol.');
    }
    if (!config.max_roles[role]) {
      throw new Error(`❌ Rol no válido: ${role}.`);
    }
  } else {
    role = null;
  }

  // Crear/recuperar user con fake ID
  await query(`
    INSERT INTO users (discord_id, nickname)
    VALUES ($1, $2)
    ON CONFLICT (discord_id) DO UPDATE SET nickname = EXCLUDED.nickname
  `, [fakeId, trimmedName]);

  // Determinar estado según cupos
  let state = PARTICIPANT_STATES.ACTIVE;

  if (config.roles_required) {
    const countForRole = await countActiveParticipantsByRole(eventId, role);
    if (countForRole >= config.max_roles[role]) {
      state = PARTICIPANT_STATES.RESERVE;
    }
  } else if (config.max_players !== null) {
    const currentCount = await countActiveParticipants(eventId);
    if (currentCount >= config.max_players) {
      state = PARTICIPANT_STATES.RESERVE;
    }
  }

  const participant = await addParticipant({
    eventId,
    discordId: fakeId,
    state,
    assignedRole: role
  });

  console.log(`➕ Manual: "${trimmedName}" añadido como ${state} (rol: ${role || 'N/A'}) a evento ${eventId}`);

  return participant;
}

/**
 * Cambiar rol de un participante (solo entre roles del tipo de evento)
 *
 * @param {object} params
 * @param {number} params.eventId
 * @param {number} params.participantId
 * @param {string} params.newRole
 * @returns {object} participante actualizado
 */
export async function changeParticipantRole({ eventId, participantId, newRole }) {
  const event = await getEvent(eventId);

  if (event.status !== 'OPEN') {
    throw new Error('❌ Este evento ya ha finalizado.');
  }

  const config = EVENT_CONFIG[event.type];

  if (!config.roles_required) {
    throw new Error('❌ Este evento no tiene roles que cambiar.');
  }

  if (!config.max_roles[newRole]) {
    throw new Error(`❌ Rol no válido: ${newRole}.`);
  }

  // Verificar que el participante existe en este evento
  const existing = await query(`
    SELECT id, assigned_role, state
    FROM event_participants
    WHERE id = $1 AND event_id = $2
  `, [participantId, eventId]);

  if (existing.rowCount === 0) {
    throw new Error('❌ Participante no encontrado.');
  }

  const part = existing.rows[0];

  if (part.assigned_role === newRole) {
    throw new Error(`❌ El participante ya está en el rol ${newRole.toUpperCase()}.`);
  }

  // Bloquear si rol destino lleno
  const countForRole = await countActiveParticipantsByRole(eventId, newRole);
  if (countForRole >= config.max_roles[newRole]) {
    throw new Error(`❌ El rol ${newRole.toUpperCase()} está lleno.`);
  }

  const updated = await updateParticipantRole(participantId, newRole);

  console.log(`🔄 Participante ${participantId} cambiado a rol ${newRole} en evento ${eventId}`);

  return updated;
}
