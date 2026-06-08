// services/eventManager.js
import { query } from '../db/database.js';
import {
  createEvent as createEventDB,
  getEventById,
  updateEventStatus as updateEventStatusDB,
  updateEventMessageId,
  deleteEvent as deleteEventDB
} from '../db/eventRepository.js';
import { EVENT_CONFIG, EVENT_STATES, EMBED_DELETE_DELAY_MS, isValidEventType } from '../config/eventConfig.js';
import { addEventToCache, removeEventFromCache } from '../utils/eventCache.js';
import { REMINDER_OFFSET_MS, scheduleEventReminder } from '../utils/eventReminders.js';

/**
 * GESTOR DE EVENTOS
 * Responsable de:
 * - Crear eventos
 * - Obtener información de eventos
 * - Validar límites
 * - Cambiar estados (OPEN → FINISHED)
 * - Programar eliminación de embeds
 */

// ==================== CREAR EVENTO ====================

/**
 * Crear evento
 * @param {object} params
 * @param {object} [params.client] - Cliente Discord (necesario para programar recordatorio)
 * @returns {object} evento creado
 */
export async function createEvent({ type, title, datetime, channelId, createdBy, client = null }) {
  // 1️⃣ Validar tipo de evento
  if (!isValidEventType(type)) {
    throw new Error(`❌ Tipo de evento no válido: ${type}. Disponibles: ${Object.keys(EVENT_CONFIG).join(', ')}`);
  }

  // 2️⃣ Validar parámetros
  if (!title || !datetime || !channelId || !createdBy) {
    throw new Error('❌ Faltan parámetros: title, datetime, channelId, createdBy');
  }

  // 3️⃣ Validar formato datetime (debe ser válido)
  const eventDate = new Date(datetime);
  if (isNaN(eventDate.getTime())) {
    throw new Error('❌ Formato de datetime inválido. Usar: YYYY-MM-DD HH:MM o ISO 8601');
  }

  // 4️⃣ Validar que no sea en el pasado
  if (eventDate <= new Date()) {
    throw new Error('❌ No puedes crear eventos en el pasado');
  }

  // 5️⃣ Crear evento en BD
  const event = await createEventDB({
    type,
    title,
    datetime: eventDate.toISOString(),
    channelId,
    createdBy
  });

  // 6️⃣ Añadir al caché de eventos OPEN (para autocomplete de /restore_event)
  addEventToCache({ ...event, status: 'OPEN' });

  // 7️⃣ Programar recordatorio (10 min antes)
  try {
    const reminderTime = new Date(eventDate.getTime() - REMINDER_OFFSET_MS);
    await query(
      'INSERT INTO event_reminders (event_id, send_at) VALUES ($1, $2)',
      [event.id, reminderTime.toISOString()]
    );

    if (client) {
      scheduleEventReminder(client, event.id, reminderTime);
    }
  } catch (err) {
    console.error('⚠️ No se pudo programar recordatorio (no crítico):', err.message);
  }

  console.log(`✅ Evento creado: ${event.id} - ${type} "${title}" - ${eventDate.toLocaleString()}`);

  return event;
}

// ==================== OBTENER EVENTO ====================

/**
 * Obtener evento por ID
 */
export async function getEvent(eventId) {
  const event = await getEventById(eventId);

  if (!event) {
    throw new Error(`❌ Evento no encontrado: ${eventId}`);
  }

  return event;
}

/**
 * Obtener evento desde message_id
 */
export async function getEventByMessageId(messageId) {
  const res = await query(
    'SELECT * FROM events WHERE message_id = $1',
    [messageId]
  );

  if (res.rowCount === 0) {
    throw new Error(`❌ Evento no encontrado para mensaje: ${messageId}`);
  }

  return res.rows[0];
}

// ==================== VALIDACIONES ====================

/**
 * Validar si usuario puede crear evento (permisos)
 * NOTA: La validación de permisos (Admin + liderdegrupo) se hace en el comando
 * Esta función es para futuras restricciones de límites si es necesario
 */
export async function validateEventLimits(type, createdBy) {
  // Por ahora no hay límites (usuario decide cuántos hace)
  // Si en futuro quieres agregar: máx X eventos/semana por tipo, hacerlo aquí

  return true;
}

/**
 * Validar si evento está OPEN (aún se puede apuntar)
 */
export function isEventOpen(event) {
  return event.status === EVENT_STATES.OPEN;
}

/**
 * Validar si evento está FINISHED (no se puede apuntar)
 */
export function isEventFinished(event) {
  return event.status === EVENT_STATES.FINISHED;
}

/**
 * Validar si evento es del tipo especificado
 */
export function isEventType(event, type) {
  return event.type === type;
}

// ==================== CAMBIAR ESTADOS ====================

/**
 * Actualizar estado de evento
 */
export async function updateEventStatus(eventId, status) {
  const event = await getEvent(eventId);

  const updated = await updateEventStatusDB(eventId, status);

  // Mantener caché sincronizado
  if (status === 'FINISHED' || status === 'CLOSED') {
    removeEventFromCache(eventId);
  } else if (status === 'OPEN') {
    addEventToCache(updated);
  }

  console.log(`🔄 Estado de evento ${eventId} cambiado: ${event.status} → ${status}`);

  return updated;
}

/**
 * Cambiar evento a FINISHED (pasó la hora)
 */
export async function finishEvent(eventId, client) {
  const event = await getEvent(eventId);

  if (event.status === EVENT_STATES.FINISHED) {
    return; // Ya finalizado
  }

  await updateEventStatus(eventId, EVENT_STATES.FINISHED);

  // Limpiar caché (el evento ya no es OPEN)
  removeEventFromCache(eventId);

  console.log(`⏰ Evento ${eventId} finalizado (status = FINISHED)`);

  // Programar eliminación de embed después de 1 hora
  if (event.message_id && event.channel_id) {
    scheduleEmbedDeletion(eventId, event.channel_id, event.message_id, client, EMBED_DELETE_DELAY_MS);
  }
}

// ==================== ELIMINAR EVENTO ====================

/**
 * Eliminar evento y su embed
 */
export async function deleteEvent(eventId, client) {
  const event = await getEvent(eventId);

  // Eliminar mensaje del canal si existe
  if (event.message_id && event.channel_id) {
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (channel) {
        const message = await channel.messages.fetch(event.message_id);
        await message.delete();
        console.log(`🗑️ Embed eliminado del canal para evento ${eventId}`);
      }
    } catch (err) {
      console.warn(`⚠️ No se pudo eliminar embed de evento ${eventId}:`, err.message);
    }
  }

  // Eliminar evento de BD (elimina participantes automáticamente por FK)
  await deleteEventDB(eventId);

  // Limpiar caché
  removeEventFromCache(eventId);

  console.log(`✅ Evento ${eventId} eliminado`);
}

/**
 * Actualizar campos editables de un evento
 * Solo actualiza los campos que se pasan (los undefined se ignoran)
 * @returns evento actualizado
 */
export async function updateEvent({ eventId, type, title, datetime }) {
  const fields = [];
  const values = [];
  let i = 1;

  if (type !== undefined) {
    fields.push(`type = $${i++}`);
    values.push(type);
  }
  if (title !== undefined) {
    fields.push(`title = $${i++}`);
    values.push(title);
  }
  if (datetime !== undefined) {
    fields.push(`datetime = $${i++}`);
    values.push(datetime instanceof Date ? datetime.toISOString() : datetime);
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(eventId);

  const res = await query(
    `UPDATE events SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );

  const updated = res.rows[0];

  // Mantener caché sincronizado
  if (type || title || datetime) {
    addEventToCache({ ...updated, status: 'OPEN' });
  }

  console.log(`✏️ Evento ${eventId} actualizado: ${fields.slice(0, -1).join(', ')}`);

  return updated;
}

// ==================== GUARDAR MESSAGE_ID ====================

/**
 * Guardar message_id del embed en la BD
 */
export async function saveEventMessageId(eventId, messageId) {
  await updateEventMessageId(eventId, messageId);
  console.log(`💾 Message ID guardado para evento ${eventId}: ${messageId}`);
}

// ==================== ELIMINAR EMBED CON DELAY ====================

/**
 * Programar eliminación de embed después de X tiempo
 * (Por defecto 1 hora después de FINISHED)
 */
export function scheduleEmbedDeletion(eventId, channelId, messageId, client, delayMs = EMBED_DELETE_DELAY_MS) {
  console.log(`⏱️ Programada eliminación de embed para evento ${eventId} en ${delayMs / 1000 / 60} minutos`);

  setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        console.log(`🗑️ Embed eliminado automáticamente para evento ${eventId}`);
      }
    } catch (err) {
      console.warn(`⚠️ No se pudo eliminar embed de evento ${eventId}:`, err.message);
    }
  }, delayMs);
}

// ==================== UTILIDADES ====================

/**
 * Obtener configuración de evento por tipo
 */
export function getEventTypeConfig(type) {
  return EVENT_CONFIG[type];
}

/**
 * Validar si evento tiene roles requeridos
 */
export function eventHasRoles(event) {
  const config = getEventTypeConfig(event.type);
  return config.roles_required;
}

/**
 * Obtener máximo de jugadores para evento
 */
export function getEventMaxPlayers(event) {
  const config = getEventTypeConfig(event.type);
  return config.max_players;
}

/**
 * Formattear información de evento para logging
 */
export function formatEventInfo(event) {
  return `${EVENT_CONFIG[event.type]?.icon || '?'} ${event.title} (${event.type.toUpperCase()}) - ${new Date(event.datetime).toLocaleString('es-ES')}`;
}
