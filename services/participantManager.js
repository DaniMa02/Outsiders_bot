// services/participantManager.js
import { query } from '../db/database.js';
import { getEvent } from './eventManager.js';
import { EVENT_CONFIG, PARTICIPANT_STATES, getMaxRolesForEvent } from '../config/eventConfig.js';
import { promoteReserveToActive, normalizeRaidGroupStates } from './eventService.js';
import { canUserFulfillRole } from '../config/eventRoleMapping.js';
import { isGuestSignupRestricted } from '../utils/guestSignupPolicy.js';
import {
  addParticipant,
  updateParticipantRole,
  updateParticipantState,
  reactivateParticipant,
  deleteParticipant,
  countActiveParticipantsByRole,
  countActiveParticipants,
  getUserCapabilities
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
  const maxRoles = getMaxRolesForEvent(event);
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
    if (!maxRoles[role]) {
      throw new Error(`❌ Rol no válido: ${role}.`);
    }
  } else {
    role = null;
  }

  // Crear/recuperar user con fake ID
  // class = NULL porque los manuales no tienen clase inferida de roles de Discord
  await query(`
    INSERT INTO users (discord_id, nickname, class)
    VALUES ($1, $2, $3)
    ON CONFLICT (discord_id) DO UPDATE SET nickname = EXCLUDED.nickname
  `, [fakeId, trimmedName, null]);

  // Determinar estado según cupos
  let state = PARTICIPANT_STATES.ACTIVE;

  if (config.roles_required) {
    const countForRole = await countActiveParticipantsByRole(eventId, role);
    if (countForRole >= maxRoles[role]) {
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
 * Si el rol destino está lleno, hace SWAP: el activo más antiguo del rol
 * destino pasa a RESERVE y el participante pasa a ACTIVE en ese rol.
 *
 * Tras el cambio, si el participante estaba ACTIVE en su rol antiguo,
 * se promueve al primer RESERVE de ese rol para llenar el hueco libre.
 *
 * @param {object} params
 * @param {number} params.eventId
 * @param {number} params.participantId
 * @param {string} params.newRole
 * @param {object} [params.client] - Cliente Discord (necesario para actualizar embed)
 * @param {function} [params.onUpdateEmbed] - Callback para refrescar embed
 * @returns {object} resultado del cambio
 */
export async function changeParticipantRole({
  eventId,
  participantId,
  newRole,
  client = null,
  onUpdateEmbed = null,
  enforceGuestCutoff = false
}) {
  const event = await getEvent(eventId);

  if (event.status !== 'OPEN') {
    throw new Error('❌ Este evento ya ha finalizado.');
  }

  const config = EVENT_CONFIG[event.type];
  const maxRoles = getMaxRolesForEvent(event);

  if (!config.roles_required) {
    throw new Error('❌ Este evento no tiene roles que cambiar.');
  }

  if (!maxRoles[newRole]) {
    throw new Error(`❌ Rol no válido: ${newRole}.`);
  }

  // Verificar que el participante existe en este evento
  const existing = await query(`
    SELECT id, assigned_role, state, is_guest
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

  // Guardar info del rol antiguo ANTES de modificar nada
  const oldRole = part.assigned_role;
  const wasActive = part.state === PARTICIPANT_STATES.ACTIVE;

  if (enforceGuestCutoff && part.is_guest && isGuestSignupRestricted(event)) {
    await reactivateParticipant({
      participantId,
      state: PARTICIPANT_STATES.RESERVE,
      assignedRole: newRole
    });
    if (wasActive && oldRole) {
      await promoteReserveToActive(eventId, oldRole, client, onUpdateEmbed);
    }
    if (onUpdateEmbed && client) {
      onUpdateEmbed(client, eventId);
    }
    return { swapped: false, participantId, newRole, state: PARTICIPANT_STATES.RESERVE };
  }

  // Comprobar si el rol destino está lleno
  const countForRole = await countActiveParticipantsByRole(eventId, newRole);
  const isFull = countForRole >= maxRoles[newRole];

  if (!isFull) {
    // El rol tiene espacio: mover y asegurar estado ACTIVE
    await reactivateParticipant({ participantId, state: PARTICIPANT_STATES.ACTIVE, assignedRole: newRole });
    console.log(`🔄 Participante ${participantId} → ACTIVE en ${newRole} (espacio libre)`);

    // Si estaba ACTIVE en el rol antiguo, ese rol queda con un hueco libre:
    // promover al primer RESERVE de ese rol (si lo hay)
    if (wasActive && oldRole) {
      await promoteReserveToActive(eventId, oldRole, client, onUpdateEmbed);
    }

    return { swapped: false, participantId, newRole };
  }

  // El rol está lleno: hacer SWAP
  // Buscar el activo más antiguo en el rol destino (el que se quedará sin sitio)
  const activeInRole = await query(`
    SELECT id
    FROM event_participants
    WHERE event_id = $1 AND assigned_role = $2 AND state = 'ACTIVE'
    ORDER BY joined_at ASC
    LIMIT 1
  `, [eventId, newRole]);

  if (activeInRole.rowCount === 0) {
    throw new Error(`❌ El rol ${newRole.toUpperCase()} está lleno pero no hay activos para intercambiar.`);
  }

  const displacedId = activeInRole.rows[0].id;

  if (displacedId === participantId) {
    throw new Error(`❌ El participante ya está activo en ${newRole.toUpperCase()}.`);
  }

  // 1. Mover al participante al nuevo rol y asegurar estado ACTIVE
  await reactivateParticipant({ participantId, state: PARTICIPANT_STATES.ACTIVE, assignedRole: newRole });

  // 2. El desplazado pasa a RESERVE (en el mismo rol)
  await updateParticipantState(displacedId, PARTICIPANT_STATES.RESERVE);

  console.log(`🔄 Swap: participante ${displacedId} → RESERVE en ${newRole}, participante ${participantId} → ACTIVE en ${newRole}`);

  // El participante salió del oldRole (era ACTIVE allí): queda un hueco libre.
  // Promover al primer RESERVE de oldRole (si lo hay).
  if (wasActive && oldRole) {
    await promoteReserveToActive(eventId, oldRole, client, onUpdateEmbed);
  }

  return { swapped: true, participantId, newRole, displacedId };
}

/**
 * Eliminar un participante de un evento.
 *
 * Si estaba ACTIVE, se promueve al primer RESERVE de su mismo rol (si existe
 * y cumple la capability). Para eventos sin roles (Raid) o participantes
 * RESERVE/ABSENCE, no se promueve a nadie y solo se refresca el embed.
 *
 * @param {object} params
 * @param {number} params.eventId
 * @param {number} params.participantId
 * @param {object} [params.client] - Cliente Discord (necesario para actualizar embed)
 * @param {function} [params.onUpdateEmbed] - Callback (client, eventId) para refrescar embed
 * @returns {object} { removed, promoted }
 */
export async function removeParticipantFromEvent({ eventId, participantId, client = null, onUpdateEmbed = null }) {
  const event = await getEvent(eventId);

  if (event.status !== 'OPEN') {
    throw new Error('❌ Este evento ya ha finalizado.');
  }

  // Verificar que el participante existe en este evento
  const existing = await query(`
    SELECT id, discord_id, state, assigned_role
    FROM event_participants
    WHERE id = $1 AND event_id = $2
  `, [participantId, eventId]);

  if (existing.rowCount === 0) {
    throw new Error('❌ Participante no encontrado.');
  }

  const part = existing.rows[0];

  // Borrar participante
  await deleteParticipant(participantId);
  console.log(`🗑️ Participante ${participantId} (${part.discord_id}) eliminado del evento ${eventId}`);

  if (event.type === 'raid') {
    await normalizeRaidGroupStates(eventId);
    if (onUpdateEmbed && client) {
      onUpdateEmbed(client, eventId);
    }
    return { removed: part, promoted: null };
  }

  // Si era ACTIVE y tenía rol asignado, promover al primer RESERVE del mismo rol.
  // promoteReserveToActive ya encola la actualización del embed vía onUpdateEmbed.
  let promoted = null;
  if (part.state === PARTICIPANT_STATES.ACTIVE && part.assigned_role) {
    promoted = await promoteReserveToActive(eventId, part.assigned_role, client, onUpdateEmbed);
  } else if (onUpdateEmbed && client) {
    // RESERVE / ABSENCE: no hay hueco que llenar, pero el embed debe
    // refrescarse para que el participante eliminado desaparezca de la lista.
    onUpdateEmbed(client, eventId);
  }

  return { removed: part, promoted };
}

/**
 * Mover un participante activo a RESERVE sin promover a otra persona.
 */
export async function moveParticipantToReserve({ eventId, participantId, client = null, onUpdateEmbed = null }) {
  const event = await getEvent(eventId);

  if (event.status !== 'OPEN') {
    throw new Error('❌ Este evento ya ha finalizado.');
  }
  if (event.type === 'raid') {
    throw new Error('❌ No se puede mover individualmente a reserva en un evento Raid.');
  }

  const result = await query(`
    SELECT id, discord_id, assigned_role, state
    FROM event_participants
    WHERE id = $1 AND event_id = $2
  `, [participantId, eventId]);

  if (result.rowCount === 0) {
    throw new Error('❌ Participante no encontrado.');
  }

  const participant = result.rows[0];
  if (participant.state !== PARTICIPANT_STATES.ACTIVE) {
    throw new Error('❌ Solo se puede mover a reserva a un participante activo.');
  }

  await updateParticipantState(participantId, PARTICIPANT_STATES.RESERVE);
  if (onUpdateEmbed && client) {
    onUpdateEmbed(client, eventId);
  }

  console.log(`📋 Participante ${participantId} movido manualmente a RESERVE en evento ${eventId}`);
  return participant;
}

export async function promoteSelectedReserveToActive({
  eventId,
  participantId,
  client = null,
  onUpdateEmbed = null
}) {
  const event = await getEvent(eventId);

  if (event.status !== 'OPEN') {
    throw new Error('❌ Este evento ya ha finalizado.');
  }
  if (!EVENT_CONFIG[event.type]?.roles_required) {
    throw new Error('❌ Solo se pueden promover reservas en eventos con roles.');
  }

  const result = await query(`
    SELECT id, discord_id, assigned_role, state, is_guest
    FROM event_participants
    WHERE id = $1 AND event_id = $2
  `, [participantId, eventId]);

  if (result.rowCount === 0) {
    throw new Error('❌ Participante no encontrado.');
  }

  const participant = result.rows[0];
  if (participant.state !== PARTICIPANT_STATES.RESERVE) {
    throw new Error('❌ El participante seleccionado ya no está en reserva.');
  }
  if (!participant.assigned_role) {
    throw new Error('❌ La reserva no tiene un rol asignado.');
  }
  if (participant.is_guest && isGuestSignupRestricted(event)) {
    throw new Error('❌ Los invitados siguen en reserva hasta que se alcance el plazo de acceso.');
  }

  const maxRoles = getMaxRolesForEvent(event);
  const roleLimit = maxRoles[participant.assigned_role];
  if (!roleLimit) {
    throw new Error('❌ El rol de esta reserva no está disponible en la composición actual.');
  }
  if (await countActiveParticipantsByRole(eventId, participant.assigned_role) >= roleLimit) {
    throw new Error(`❌ El puesto de ${participant.assigned_role.toUpperCase()} ya está ocupado.`);
  }

  if (!participant.discord_id.startsWith('manual_')) {
    const capabilities = await getUserCapabilities(participant.discord_id);
    if (!canUserFulfillRole(capabilities, participant.assigned_role)) {
      throw new Error(`❌ El participante ya no cumple los requisitos para ${participant.assigned_role.toUpperCase()}.`);
    }
  }

  await updateParticipantState(participantId, PARTICIPANT_STATES.ACTIVE);

  if (client && !participant.discord_id.startsWith('manual_')) {
    const { notifyPromotionToActive } = await import('./notificationService.js');
    await notifyPromotionToActive(client, participant.discord_id, event);
  }
  if (onUpdateEmbed && client) {
    onUpdateEmbed(client, eventId);
  }

  console.log(`⬆️ Reserva ${participantId} promovida manualmente a ACTIVE en evento ${eventId}.`);
  return participant;
}
