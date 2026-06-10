// utils/eventReminders.js
import { query } from '../db/database.js';
import { getBotVariables } from './botVariables.js';
import { EVENT_CONFIG } from '../config/eventConfig.js';

/**
 * GESTIÓN DE RECORDATORIOS DE EVENTOS
 *
 * En vez de un cron cada minuto consultando la DB, cuando se crea un
 * evento se inserta una fila en event_reminders y se programa un
 * setTimeout en memoria. Al arrancar el bot, se recuperan los
 * recordatorios pendientes y se reprograman los timeouts.
 *
 * Si el bot está caído a la hora exacta del recordatorio, se enviará
 * al arrancar (con un margen de hasta 1h).
 *
 * Cada evento tiene DOS recordatorios:
 *  - 'channel' → 10 min antes: mensaje al canal del evento (tagea rol + usuarios)
 *  - 'dm'      → 15 min antes: DM individual a cada participante activo
 */

const scheduledTimeouts = new Map(); // key: `${eventId}:${type}` → Timeout

const REMINDER_OFFSET_MS = 10 * 60 * 1000;  // 10 minutos antes (recordatorio en canal)
const DM_REMINDER_OFFSET_MS = 15 * 60 * 1000; // 15 minutos antes (DM individual)
const PAST_DUE_GRACE_MS = 60 * 60 * 1000;   // 1 hora de gracia para recordatorios atrasados

// setTimeout en Node tiene un delay máximo de 2^31-1 ms (~24.8 días).
// Para delays mayores hay que encadenar varios setTimeout.
const MAX_SET_TIMEOUT_MS = 2_147_483_647; // ~24.8 días

/**
 * setTimeout que soporta delays arbitrariamente largos encadenando
 * varios timeouts, cada uno <= MAX_SET_TIMEOUT_MS.
 */
function safeSetTimeout(callback, delay) {
  if (delay <= MAX_SET_TIMEOUT_MS) {
    return setTimeout(callback, delay);
  }
  return setTimeout(
    () => safeSetTimeout(callback, delay - MAX_SET_TIMEOUT_MS),
    MAX_SET_TIMEOUT_MS
  );
}

function makeTimeoutKey(eventId, type) {
  return `${eventId}:${type}`;
}

function cancelTimeoutForType(eventId, type) {
  const key = makeTimeoutKey(eventId, type);
  const existing = scheduledTimeouts.get(key);
  if (existing) {
    clearTimeout(existing);
    scheduledTimeouts.delete(key);
  }
}

/**
 * Programar el setTimeout en memoria para un recordatorio de un tipo concreto.
 * Si ya hay uno del mismo tipo para el evento, lo cancela antes.
 * @param {'channel'|'dm'} type
 */
function scheduleReminderInternal(client, eventId, sendAt, type) {
  cancelTimeoutForType(eventId, type);

  const delay = sendAt.getTime() - Date.now();

  if (delay <= 0) {
    if (delay > -PAST_DUE_GRACE_MS) {
      console.log(`⏰ Recordatorio [${type}] del evento ${eventId} atrasado, enviando ahora...`);
      sendReminderForType(client, eventId, type).catch(err =>
        console.error(`❌ Error enviando recordatorio atrasado [${type}] para evento ${eventId}:`, err)
      );
    } else {
      console.log(`⏰ Recordatorio [${type}] del evento ${eventId} caducó (>1h), marcando como enviado`);
      markReminderSent(eventId, type).catch(err =>
        console.error(`❌ Error marcando recordatorio caducado [${type}]:`, err)
      );
    }
    return;
  }

  const timeout = safeSetTimeout(() => {
    scheduledTimeouts.delete(makeTimeoutKey(eventId, type));
    sendReminderForType(client, eventId, type).catch(err =>
      console.error(`❌ Error enviando recordatorio [${type}] para evento ${eventId}:`, err)
    );
  }, delay);

  scheduledTimeouts.set(makeTimeoutKey(eventId, type), timeout);
  console.log(`⏰ Recordatorio [${type}] programado para evento ${eventId} en ${Math.round(delay / 1000)}s (${Math.round(delay / 86400000)} días)`);
}

/**
 * Programar el recordatorio al canal (10 min antes).
 */
export const scheduleEventReminder = (client, eventId, sendAt) => {
  return scheduleReminderInternal(client, eventId, sendAt, 'channel');
};

/**
 * Programar el recordatorio por DM (15 min antes).
 */
export const scheduleDmReminder = (client, eventId, sendAt) => {
  return scheduleReminderInternal(client, eventId, sendAt, 'dm');
};

/**
 * Cancelar TODOS los timeouts pendientes de un evento (canal + DM).
 * Se usa al finalizar, cancelar o eliminar el evento.
 */
export const cancelScheduledReminder = (eventId) => {
  cancelTimeoutForType(eventId, 'channel');
  cancelTimeoutForType(eventId, 'dm');
};

/**
 * Reprogramar los recordatorios de un evento (usado al editar fecha/hora).
 * Cancela los timeouts actuales, actualiza la fila en DB y crea nuevos timeouts
 * (tanto el del canal como el de DM).
 */
export const rescheduleReminder = async (client, eventId, newDatetime) => {
  // Cancelar timeouts en memoria (canal + DM)
  cancelScheduledReminder(eventId);

  // Calcular nuevos send_at
  const newSendAt = new Date(newDatetime.getTime() - REMINDER_OFFSET_MS);
  const newDmSendAt = new Date(newDatetime.getTime() - DM_REMINDER_OFFSET_MS);

  // Verificar si existe fila en DB
  const existing = await query(
    'SELECT id FROM event_reminders WHERE event_id = $1',
    [eventId]
  );

  if (existing.rowCount > 0) {
    // Resetear sent/sent_at y limpiar message_id del recordatorio anterior
    await query(
      `UPDATE event_reminders
       SET send_at = $1, sent = FALSE, sent_at = NULL, reminder_message_id = NULL,
           dm_send_at = $2, dm_sent = FALSE, dm_sent_at = NULL
       WHERE event_id = $3`,
      [newSendAt.toISOString(), newDmSendAt.toISOString(), eventId]
    );
  } else {
    // Crear nueva fila
    await query(
      'INSERT INTO event_reminders (event_id, send_at, dm_send_at) VALUES ($1, $2, $3)',
      [newSendAt.toISOString(), newDmSendAt.toISOString(), eventId]
    );
  }

  // Programar los nuevos timeouts
  scheduleEventReminder(client, eventId, newSendAt);
  scheduleDmReminder(client, eventId, newDmSendAt);

  console.log(`⏰ Recordatorios reprogramados para evento ${eventId} → canal: ${newSendAt.toISOString()}, DM: ${newDmSendAt.toISOString()}`);
};

/**
 * Al arrancar el bot: cargar todos los recordatorios pendientes (canal y DM)
 * y reprogramar los timeouts.
 */
export const loadScheduledReminders = async (client) => {
  try {
    // Recordatorios al canal
    const channelRes = await query(`
      SELECT er.event_id, er.send_at
      FROM event_reminders er
      JOIN events e ON e.id = er.event_id
      WHERE er.sent = FALSE
        AND e.status = 'OPEN'
        AND er.send_at > NOW() - INTERVAL '1 hour'
      ORDER BY er.send_at ASC
    `);

    for (const row of channelRes.rows) {
      scheduleEventReminder(client, row.event_id, new Date(row.send_at));
    }

    // Recordatorios por DM
    const dmRes = await query(`
      SELECT er.event_id, er.dm_send_at
      FROM event_reminders er
      JOIN events e ON e.id = er.event_id
      WHERE er.dm_sent = FALSE
        AND e.status = 'OPEN'
        AND er.dm_send_at > NOW() - INTERVAL '1 hour'
      ORDER BY er.dm_send_at ASC
    `);

    for (const row of dmRes.rows) {
      scheduleDmReminder(client, row.event_id, new Date(row.dm_send_at));
    }

    console.log(`✅ Recordatorios cargados al arrancar: ${channelRes.rowCount} canal, ${dmRes.rowCount} DM`);
  } catch (err) {
    console.error('❌ Error cargando recordatorios:', err);
  }
};

/**
 * Despacha el envío del recordatorio según el tipo ('channel' o 'dm')
 */
async function sendReminderForType(client, eventId, type) {
  if (type === 'channel') return sendChannelReminder(client, eventId);
  if (type === 'dm') return sendDmReminders(client, eventId);
}

/**
 * Marcar un recordatorio como enviado en BD según el tipo
 */
async function markReminderSent(eventId, type) {
  if (type === 'channel') {
    await query(
      'UPDATE event_reminders SET sent = TRUE, sent_at = NOW() WHERE event_id = $1 AND sent = FALSE',
      [eventId]
    );
  } else if (type === 'dm') {
    await query(
      'UPDATE event_reminders SET dm_sent = TRUE, dm_sent_at = NOW() WHERE event_id = $1 AND dm_sent = FALSE',
      [eventId]
    );
  }
}

/**
 * Enviar el recordatorio de un evento al canal (10 min antes)
 * Tagea al rol del tipo de evento y a los participantes activos
 */
async function sendChannelReminder(client, eventId) {
  // 1️⃣ Obtener evento
  const eventRes = await query(
    'SELECT * FROM events WHERE id = $1',
    [eventId]
  );

  if (eventRes.rowCount === 0) {
    await markReminderSent(eventId, 'channel');
    return;
  }

  const event = eventRes.rows[0];

  // 2️⃣ Si el evento ya no está OPEN (fue cancelado/finalizado), no enviar
  if (event.status !== 'OPEN') {
    await markReminderSent(eventId, 'channel');
    return;
  }

  // 3️⃣ Obtener participantes activos
  const partRes = await query(`
    SELECT u.discord_id, u.nickname
    FROM event_participants ep
    JOIN users u ON u.discord_id = ep.discord_id
    WHERE ep.event_id = $1 AND ep.state = 'ACTIVE'
  `, [eventId]);

  const participants = partRes.rows;
  const userMentions = participants
    .map(p => p.discord_id.startsWith('manual_') ? (p.nickname || 'Manual') : `<@${p.discord_id}>`)
    .join(' ');

  const config = EVENT_CONFIG[event.type];
  const botVars = getBotVariables();
  const roleId = config?.notify_role_var ? botVars[config.notify_role_var] : null;

  let content = `⏰ **Recordatorio: ${config?.icon || '•'} ${event.title}** empieza en 10 minutos.`;
  if (roleId) content += `\n<@&${roleId}>`;
  if (userMentions) content += `\n${userMentions}`;

  // 4️⃣ Enviar al canal del evento
  const channel = await client.channels.fetch(event.channel_id);
  if (channel) {
    const sentMessage = await channel.send({ content });
    // Guardar message_id del recordatorio para poder borrarlo junto al embed
    await saveReminderMessageId(eventId, sentMessage.id);
  }

  // 5️⃣ Marcar como enviado
  await markReminderSent(eventId, 'channel');

  console.log(`⏰ Recordatorio (canal) enviado para evento ${eventId} (${event.title})`);
}

/**
 * Enviar el recordatorio por DM a cada participante activo (15 min antes).
 * Si un usuario tiene los DMs cerrados, se omite silenciosamente (con warn).
 */
async function sendDmReminders(client, eventId) {
  // 1️⃣ Obtener evento
  const eventRes = await query(
    'SELECT * FROM events WHERE id = $1',
    [eventId]
  );

  if (eventRes.rowCount === 0) {
    await markReminderSent(eventId, 'dm');
    return;
  }

  const event = eventRes.rows[0];

  // 2️⃣ Si el evento ya no está OPEN, no enviar
  if (event.status !== 'OPEN') {
    await markReminderSent(eventId, 'dm');
    return;
  }

  // 3️⃣ Obtener participantes activos (excluyendo entradas manuales sin discord_id real)
  const partRes = await query(`
    SELECT u.discord_id, u.nickname
    FROM event_participants ep
    JOIN users u ON u.discord_id = ep.discord_id
    WHERE ep.event_id = $1 AND ep.state = 'ACTIVE'
  `, [eventId]);

  const config = EVENT_CONFIG[event.type];
  const eventTime = new Date(event.datetime).toLocaleString('es-ES', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });

  let sent = 0;
  let failed = 0;

  // 4️⃣ Enviar DM a cada participante
  for (const p of partRes.rows) {
    // Saltar entradas manuales (discord_id tipo 'manual_xxx')
    if (p.discord_id.startsWith('manual_')) continue;

    try {
      const user = await client.users.fetch(p.discord_id);
      if (!user) continue;

      const dmContent =
        `⏰ **Recordatorio personal: ${config?.icon || '•'} ${event.title}**\n` +
        `Empieza en **15 minutos**.\n` +
        `📅 ${eventTime}\n` +
        `📍 Canal: <#${event.channel_id}>`;

      await user.send({ content: dmContent });
      sent++;
    } catch (err) {
      // Lo más habitual: el usuario tiene los DMs cerrados
      failed++;
      console.warn(`⚠️ No se pudo enviar DM a ${p.discord_id} para evento ${eventId}: ${err.message}`);
    }
  }

  // 5️⃣ Marcar como enviado
  await markReminderSent(eventId, 'dm');

  console.log(`⏰ DMs enviados para evento ${eventId}: ${sent} ok, ${failed} fallidos (de ${partRes.rows.length} participantes)`);
}

/**
 * Guardar el message_id del recordatorio enviado en la BD
 * para poder borrarlo después junto al embed del evento
 */
export async function saveReminderMessageId(eventId, messageId) {
  try {
    await query(
      'UPDATE event_reminders SET reminder_message_id = $1 WHERE event_id = $2',
      [messageId, eventId]
    );
  } catch (err) {
    console.error(`❌ Error guardando reminder_message_id para evento ${eventId}:`, err.message);
  }
}

/**
 * Eliminar el mensaje de recordatorio de un evento en Discord
 * y limpiar la referencia en BD. Se usa cuando se borra el embed
 * del evento (1h después de FINISHED) o cuando se cancela el evento.
 *
 * - Si no hay reminder_message_id guardado, no hace nada
 * - Si el evento ya no existe en BD, limpia la referencia y sale
 * - Si el mensaje ya fue borrado en Discord (error 10008), lo trata como éxito
 * - La referencia en BD se limpia SIEMPRE, incluso si el borrado falla,
 *   para no dejar referencias huérfanas
 */
export async function deleteReminderMessage(client, eventId) {
  try {
    const res = await query(
      'SELECT reminder_message_id FROM event_reminders WHERE event_id = $1',
      [eventId]
    );

    if (res.rowCount === 0 || !res.rows[0].reminder_message_id) {
      return { deleted: false, reason: 'no_reminder_message' };
    }

    const messageId = res.rows[0].reminder_message_id;

    const eventRes = await query(
      'SELECT channel_id FROM events WHERE id = $1',
      [eventId]
    );

    if (eventRes.rowCount === 0) {
      // Evento ya no existe, solo limpiar referencia
      await query(
        'UPDATE event_reminders SET reminder_message_id = NULL WHERE event_id = $1',
        [eventId]
      );
      return { deleted: false, reason: 'event_not_found' };
    }

    try {
      const channel = await client.channels.fetch(eventRes.rows[0].channel_id);
      if (channel) {
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        console.log(`🗑️ Mensaje de recordatorio eliminado: evento ${eventId}`);
      }
    } catch (err) {
      if (err.code === 10008) {
        // Unknown Message: ya fue borrado, no es un error
      } else {
        console.warn(`⚠️ Error eliminando recordatorio de evento ${eventId}:`, err.message);
      }
    }

    // Limpiar referencia siempre, para no dejar referencias huérfanas
    await query(
      'UPDATE event_reminders SET reminder_message_id = NULL WHERE event_id = $1',
      [eventId]
    );

    return { deleted: true };
  } catch (err) {
    console.error(`❌ Error en deleteReminderMessage para evento ${eventId}:`, err);
    return { deleted: false, reason: 'error', error: err.message };
  }
}

export { REMINDER_OFFSET_MS, DM_REMINDER_OFFSET_MS };
