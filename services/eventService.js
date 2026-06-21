// services/eventService.js
import { query } from '../db/database.js';
import {
  getEventById,
  getParticipant,
  getParticipantsByState,
  addParticipant,
  updateParticipantState,
  reactivateParticipant,
  countActiveParticipantsByRole,
  countActiveParticipants,
  getFirstReserveForRole
} from '../db/eventRepository.js';
import { getUserCapabilities } from '../db/eventRepository.js';
import { getEvent, getEventMaxPlayers, eventHasRoles } from './eventManager.js';
import { canUserFulfillRole } from '../config/eventRoleMapping.js';
import { EVENT_CONFIG, PARTICIPANT_STATES } from '../config/eventConfig.js';

/**
 * SERVICIO DE EVENTOS
 * Responsable de:
 * - Usuarios se apunten a eventos (JOIN)
 * - Usuarios marquen ausencia (ABSENCE)
 * - Gestionar reservas (RESERVE)
 * - Promover RESERVE a ACTIVE si hay espacio
 */

// ==================== COLA DE UPDATES (Rate limit) ====================

const eventUpdateQueue = [];
let isProcessingQueue = false;

function queueEventUpdate(client, eventId, callback) {
  if (eventUpdateQueue.find(item => item.eventId === eventId)) {
    return; // Ya está en cola
  }

  eventUpdateQueue.push({ client, eventId, callback });
  processQueue();
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (eventUpdateQueue.length > 0) {
    const { client, eventId, callback } = eventUpdateQueue.shift();

    try {
      await callback(client, eventId);
    } catch (err) {
      console.error(`❌ Error al actualizar evento ${eventId}:`, err);
    }

    // Rate limit global para no saturar Discord
    await new Promise(res => setTimeout(res, 500));
  }

  isProcessingQueue = false;
}

// ==================== JOIN A EVENTO ====================

/**
 * Usuario se apunta (o re-apunta tras ABSENCE) a un evento
 * @param {object} params
 * @returns {object} participante creado/actualizado
 */
export async function joinEvent({ eventId, discordId, role = null, client, onUpdateEmbed }) {
  // 1️⃣ Obtener evento
  const event = await getEvent(eventId);

  // 2️⃣ Validar que evento está OPEN
  if (event.status !== 'OPEN') {
    throw new Error('❌ Este evento ya ha finalizado.');
  }

  // 3️⃣ Buscar participante existente
  const existing = await getParticipant(eventId, discordId);

  // Guardar info del rol antiguo ANTES de cualquier UPDATE,
  // para poder promover un RESERVE de ese rol si el usuario era ACTIVE
  // y está cambiando de rol.
  const oldRole = existing?.assigned_role || null;
  const wasActive = existing?.state === PARTICIPANT_STATES.ACTIVE;
  const isChangingRole = wasActive && oldRole && oldRole !== role;

  if (existing) {
    if (existing.state === PARTICIPANT_STATES.ACTIVE) {
      // Si ya está en el mismo rol, no hacer nada
      if (existing.assigned_role === role) {
        const rolText = role ? role.toUpperCase() : 'ACTIVE';
        throw new Error(`❌ Ya estás apuntado como ${rolText} en este evento.`);
      }
      // Si está en otro rol, permitir cambio (UPDATE al final)
    } else if (existing.state === PARTICIPANT_STATES.RESERVE) {
      throw new Error('❌ Ya estás apuntado como RESERVE en este evento.');
    }
    // Si está en ABSENCE, caer al flujo normal y hacer UPDATE al final
  }

  // 4️⃣ Si evento requiere roles, validar capability
  if (eventHasRoles(event)) {
    if (!role) {
      throw new Error('❌ Este evento requiere que especifiques un rol.');
    }

    // Validar que usuario tiene capability para el rol
    const capabilities = await getUserCapabilities(discordId);
    if (!canUserFulfillRole(capabilities, role)) {
      throw new Error(`❌ No cumples requisitos para el rol ${role.toUpperCase()}.`);
    }

    // Validar que ese rol no esté lleno
    const config = EVENT_CONFIG[event.type];
    const maxForRole = config.max_roles[role];
    const currentCountForRole = await countActiveParticipantsByRole(eventId, role);

    if (currentCountForRole >= maxForRole) {
      // Rol está lleno → como RESERVE
      const result = await upsertParticipant({
        eventId,
        discordId,
        state: PARTICIPANT_STATES.RESERVE,
        assignedRole: role,
        existingId: existing?.id,
        client,
        onUpdateEmbed
      });

      // Si veníamos de un cambio de rol real (ACTIVE en otro rol), ese rol
      // queda con un hueco libre: promover al primer RESERVE de oldRole.
      if (isChangingRole) {
        await promoteReserveToActive(eventId, oldRole, client, onUpdateEmbed);
      }

      return result;
    }
  } else {
    // RAID: sin roles
    role = null;
  }

  // 5️⃣ Validar que evento no esté lleno
  const maxPlayers = getEventMaxPlayers(event);
  const currentCount = await countActiveParticipants(eventId);

  if (maxPlayers !== null && currentCount >= maxPlayers) {
    // Evento lleno → como RESERVE
    const result = await upsertParticipant({
      eventId,
      discordId,
      state: PARTICIPANT_STATES.RESERVE,
      assignedRole: role,
      existingId: existing?.id,
      client,
      onUpdateEmbed
    });

    if (isChangingRole) {
      await promoteReserveToActive(eventId, oldRole, client, onUpdateEmbed);
    }

    return result;
  }

  // 6️⃣ Como ACTIVE
  const result = await upsertParticipant({
    eventId,
    discordId,
    state: PARTICIPANT_STATES.ACTIVE,
    assignedRole: role,
    existingId: existing?.id,
    client,
    onUpdateEmbed
  });

  if (isChangingRole) {
    await promoteReserveToActive(eventId, oldRole, client, onUpdateEmbed);
  }

  return result;
}

/**
 * Insertar nuevo participante o actualizar uno existente (caso ABSENCE → ACTIVE/RESERVE)
 */
async function upsertParticipant({ eventId, discordId, state, assignedRole, existingId, client, onUpdateEmbed }) {
  let participant;
  if (existingId) {
    participant = await reactivateParticipant({ participantId: existingId, state, assignedRole });
    console.log(`♻️ Usuario ${discordId} re-apuntado como ${state} a evento ${eventId} (rol: ${assignedRole || 'N/A'})`);
  } else {
    participant = await addParticipant({ eventId, discordId, state, assignedRole });
    console.log(`✅ Usuario ${discordId} apuntado como ${state} a evento ${eventId} (rol: ${assignedRole || 'N/A'})`);
  }

  if (onUpdateEmbed) {
    queueEventUpdate(client, eventId, onUpdateEmbed);
  }

  return participant;
}

// ==================== MARCAR ABSENCE ====================

/**
 * Usuario marca absence
 */
export async function markEventAbsence({ eventId, participantId, discordId, client, onUpdateEmbed }) {
  // 1️⃣ Obtener participante
  const participant = await query(
    'SELECT * FROM event_participants WHERE id = $1',
    [participantId]
  );

  if (participant.rowCount === 0) {
    throw new Error('❌ Participante no encontrado.');
  }

  const part = participant.rows[0];

  // 2️⃣ Validar que sea el usuario correcto
  if (part.discord_id !== discordId) {
    throw new Error('❌ No puedes marcar absence de otro usuario.');
  }

  // 3️⃣ Cambiar a ABSENCE
  await updateParticipantState(participantId, PARTICIPANT_STATES.ABSENCE);

  console.log(`❌ Usuario ${discordId} marcado como ABSENCE en evento ${eventId}`);

  // 4️⃣ Si era ACTIVE, buscar RESERVE que cumpla rol para subirlo
  if (part.state === PARTICIPANT_STATES.ACTIVE && part.assigned_role) {
    await promoteReserveToActive(eventId, part.assigned_role, client, onUpdateEmbed);
  } else {
    // Si era RESERVE, solo actualizar embed
    if (onUpdateEmbed) {
      queueEventUpdate(client, eventId, onUpdateEmbed);
    }
  }

  return;
}

// ==================== PROMOVER RESERVE A ACTIVE ====================

/**
 * Promover RESERVE a ACTIVE si hay espacio y cumple rol.
 *
 * IMPORTANTE: si un RESERVE no cumple la capability, probamos con el
 * siguiente, pero tenemos que recordar los IDs ya probados. Si no,
 * al re-lamar a getFirstReserveForRole nos devolvería el MISMO reserve
 * y entraríamos en recursión infinita (caso real: un `manual_xxx` sin
 * capability en BD). Usamos bucle con triedIds para garantizar la
 * terminación.
 *
 * Excepción: los participantes manuales (discord_id empieza por 'manual_')
 * no tienen roles de Discord, así que `user_role_capabilities` siempre
 * estaría vacío para ellos. Si un admin añadió manualmente a alguien
 * con un rol, debemos fiarnos y promoverlo (si no, jamás podrían
 * subir al equipo principal aunque el slot esté libre).
 */
export async function promoteReserveToActive(eventId, roleNeeded, client, onUpdateEmbed) {
  const triedIds = [];
  let promoted = false;

  while (true) {
    // 1️⃣ Obtener primer RESERVE que aún no hayamos probado
    const reserve = await getFirstReserveForRole(eventId, roleNeeded, triedIds);

    if (!reserve) {
      // No hay más RESERVEs elegibles
      break;
    }

    // 2️⃣ Para usuarios manuales nos fiamos del rol con el que el admin
    //    los añadió (no tienen roles de Discord, así que la comprobación
    //    de capability no aplicaría y jamás podrían subir).
    const isManual = reserve.discord_id.startsWith('manual_');

    if (!isManual) {
      // 3️⃣ Validar que aún tiene la capability (solo usuarios reales)
      const capabilities = await getUserCapabilities(reserve.discord_id);
      if (!canUserFulfillRole(capabilities, roleNeeded)) {
        console.log(`⚠️ RESERVE ${reserve.discord_id} ya no tiene capability para ${roleNeeded}, pasando al siguiente...`);
        triedIds.push(reserve.id);
        continue; // Probar siguiente
      }
    }

    // 4️⃣ Promover a ACTIVE
    await updateParticipantState(reserve.id, PARTICIPANT_STATES.ACTIVE);
    console.log(`⬆️ RESERVE ${reserve.discord_id} promovido a ACTIVE para evento ${eventId} (rol: ${roleNeeded})`);
    promoted = true;
    break;
  }

  if (!promoted) {
    console.log(`ℹ️ No hay RESERVE disponible para cumplir rol ${roleNeeded} en evento ${eventId}`);
  }

  // 5️⃣ Actualizar embed (una sola vez, al final)
  if (onUpdateEmbed) {
    queueEventUpdate(client, eventId, onUpdateEmbed);
  }
}

// ==================== ACTUALIZAR PARTICIPANTE ====================

/**
 * Cambiar rol de participante (si es necesario recalcular)
 */
export async function updateParticipantRole(participantId, newRole) {
  const res = await query(
    'UPDATE event_participants SET assigned_role = $1 WHERE id = $2 RETURNING *',
    [newRole, participantId]
  );

  if (res.rowCount === 0) {
    throw new Error('❌ Participante no encontrado.');
  }

  return res.rows[0];
}

// ==================== OBTENER INFORMACIÓN ====================

/**
 * Obtener estado de participantes (ACTIVE, RESERVE, ABSENCE)
 */
export async function getEventParticipantsSummary(eventId) {
  const event = await getEvent(eventId);

  const active = await getParticipantsByState(eventId, PARTICIPANT_STATES.ACTIVE);
  const reserve = await getParticipantsByState(eventId, PARTICIPANT_STATES.RESERVE);
  const absence = await getParticipantsByState(eventId, PARTICIPANT_STATES.ABSENCE);

  return {
    event,
    active: {
      count: active.length,
      participants: active,
      byRole: groupByRole(active)
    },
    reserve: {
      count: reserve.length,
      participants: reserve
    },
    absence: {
      count: absence.length,
      participants: absence
    }
  };
}

/**
 * Obtener todos los participantes de un evento con su posición global
 * (orden de inscripción, basado en joined_at ASC).
 *
 * La posición es estable: si un usuario se apunta, marca absence, y
 * vuelve a apuntarse, su posición NO cambia (joined_at no se actualiza).
 *
 * @param {number} eventId
 * @returns {Promise<Array>} Lista de participantes con campo `position`
 */
export async function getAllEventParticipantsWithPosition(eventId) {
  const res = await query(`
    SELECT
      ep.id, ep.state, ep.assigned_role, ep.joined_at,
      u.discord_id, u.nickname,
      ROW_NUMBER() OVER (ORDER BY ep.joined_at ASC) AS position
    FROM event_participants ep
    LEFT JOIN users u ON u.discord_id = ep.discord_id
    WHERE ep.event_id = $1
    ORDER BY ep.joined_at ASC
  `, [eventId]);

  return res.rows;
}

/**
 * Agrupar participantes por rol
 */
function groupByRole(participants) {
  const groups = {};

  for (const p of participants) {
    if (!groups[p.assigned_role]) {
      groups[p.assigned_role] = [];
    }
    groups[p.assigned_role].push(p);
  }

  return groups;
}

// ==================== VALIDACIONES ====================

/**
 * Validar si evento puede aceptar más participantes
 */
export async function canEventAcceptMore(eventId) {
  const event = await getEvent(eventId);
  const maxPlayers = getEventMaxPlayers(event);

  if (maxPlayers === null) {
    return true; // RAID sin límite
  }

  const current = await countActiveParticipants(eventId);
  return current < maxPlayers;
}

/**
 * Validar si rol específico está lleno
 */
export async function isRoleFull(eventId, role) {
  const event = await getEvent(eventId);
  const config = EVENT_CONFIG[event.type];

  if (!config.max_roles[role]) {
    return false; // Rol no existe para este tipo
  }

  const current = await countActiveParticipantsByRole(eventId, role);
  return current >= config.max_roles[role];
}
