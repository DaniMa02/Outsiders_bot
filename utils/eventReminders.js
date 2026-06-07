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
 */

const scheduledTimeouts = new Map(); // eventId → Timeout

const REMINDER_OFFSET_MS = 10 * 60 * 1000; // 10 minutos
const PAST_DUE_GRACE_MS = 60 * 60 * 1000;  // 1 hora de gracia para recordatorios atrasados

/**
 * Programar el setTimeout en memoria para un recordatorio.
 * Si ya hay uno para el mismo evento, lo cancela antes.
 */
export const scheduleEventReminder = (client, eventId, sendAt) => {
  // Cancelar timeout previo si existe
  cancelScheduledReminder(eventId);

  const delay = sendAt.getTime() - Date.now();

  if (delay <= 0) {
    // Ya pasó la hora (o es inmediata). Si está dentro del margen de gracia, enviar ya.
    if (delay > -PAST_DUE_GRACE_MS) {
      console.log(`⏰ Recordatorio del evento ${eventId} atrasado, enviando ahora...`);
      sendReminder(client, eventId).catch(err =>
        console.error(`❌ Error enviando recordatorio atrasado para evento ${eventId}:`, err)
      );
    } else {
      // Pasó hace mucho, marcar como enviado sin enviar
      console.log(`⏰ Recordatorio del evento ${eventId} caducó (>1h), marcando como enviado`);
      query('UPDATE event_reminders SET sent = TRUE, sent_at = NOW() WHERE event_id = $1 AND sent = FALSE', [eventId])
        .catch(err => console.error('❌ Error marcando recordatorio caducado:', err));
    }
    return;
  }

  const timeout = setTimeout(() => {
    scheduledTimeouts.delete(eventId);
    sendReminder(client, eventId).catch(err =>
      console.error(`❌ Error enviando recordatorio para evento ${eventId}:`, err)
    );
  }, delay);

  scheduledTimeouts.set(eventId, timeout);
  console.log(`⏰ Recordatorio programado para evento ${eventId} en ${Math.round(delay / 1000)}s`);
};

/**
 * Cancelar el setTimeout en memoria para un evento
 */
export const cancelScheduledReminder = (eventId) => {
  const existing = scheduledTimeouts.get(eventId);
  if (existing) {
    clearTimeout(existing);
    scheduledTimeouts.delete(eventId);
  }
};

/**
 * Al arrancar el bot: cargar todos los recordatorios pendientes y
 * reprogramar los timeouts
 */
export const loadScheduledReminders = async (client) => {
  try {
    const res = await query(`
      SELECT er.event_id, er.send_at
      FROM event_reminders er
      JOIN events e ON e.id = er.event_id
      WHERE er.sent = FALSE
        AND e.status = 'OPEN'
        AND er.send_at > NOW() - INTERVAL '1 hour'
      ORDER BY er.send_at ASC
    `);

    for (const row of res.rows) {
      scheduleEventReminder(client, row.event_id, new Date(row.send_at));
    }

    console.log(`✅ Recordatorios cargados al arrancar: ${res.rowCount}`);
  } catch (err) {
    console.error('❌ Error cargando recordatorios:', err);
  }
};

/**
 * Enviar el recordatorio de un evento
 */
async function sendReminder(client, eventId) {
  // 1️⃣ Obtener evento
  const eventRes = await query(
    'SELECT * FROM events WHERE id = $1',
    [eventId]
  );

  if (eventRes.rowCount === 0) {
    await query('UPDATE event_reminders SET sent = TRUE, sent_at = NOW() WHERE event_id = $1 AND sent = FALSE', [eventId]);
    return;
  }

  const event = eventRes.rows[0];

  // 2️⃣ Si el evento ya no está OPEN (fue cancelado/finalizado), no enviar
  if (event.status !== 'OPEN') {
    await query('UPDATE event_reminders SET sent = TRUE, sent_at = NOW() WHERE event_id = $1 AND sent = FALSE', [eventId]);
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
    await channel.send({ content });
  }

  // 5️⃣ Marcar como enviado
  await query('UPDATE event_reminders SET sent = TRUE, sent_at = NOW() WHERE event_id = $1 AND sent = FALSE', [eventId]);

  console.log(`⏰ Recordatorio enviado para evento ${eventId} (${event.title})`);
}

export { REMINDER_OFFSET_MS };
