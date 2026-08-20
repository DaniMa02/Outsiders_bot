// services/notificationService.js
import { formatFechaMadrid, formatHoraMadrid } from '../utils/dateTime.js';
import { query } from '../db/database.js';

/**
 * Enviar DM al usuario notificando que ha subido desde RESERVE a ACTIVE.
 * - Ignora usuarios "manual_"
 * - Maneja errores internamente y los registra en consola
 *
 * @param {object} client - Discord client
 * @param {string} discordId - ID de Discord del usuario
 * @param {object} event - Objeto evento (de DB) con al menos { title, datetime }
 */
export async function notifyPromotionToActive(client, discordId, event) {
  if (!client || !discordId || !event) return;
  if (typeof discordId !== 'string') return;

  // No enviar a usuarios manuales
  if (discordId.startsWith('manual_')) return;

  try {
    const user = await client.users.fetch(discordId);
    if (!user) return;

    const fecha = formatFechaMadrid(event.datetime);
    const hora = formatHoraMadrid(event.datetime);

    // Formato inspirado en el reminder antiguo (15min) adaptado a promoción
    const config = event?.type ? (event.type === 'hell' ? { icon: '🔥', label: 'Hell' } : event.type === 'hardcore' ? { icon: '⚔️', label: 'Hardcore' } : { icon: '•', label: event.type }) : { icon: '•', label: '' };

    const dmLines = [];
    dmLines.push(`⏰ **Has subido al grupo principal**`);
    dmLines.push(`${config.icon} **${event.title}**`);
    dmLines.push(`Empieza en **${fecha} ${hora}**`);

    // Intentar añadir canal legible si existe
    if (event.channel_id) {
      dmLines.push(`📍 Canal: <#${event.channel_id}>`);
    }

    const dmContent = dmLines.join('\n');

    await user.send({ content: dmContent });

    console.log(`✉️ Notificación DM enviada a ${discordId} por promoción en evento ${event.id}`);

    // Además, publicar aviso persistente en el canal del evento para dejar constancia
    try {
      if (event.channel_id) {
        const channel = await client.channels.fetch(event.channel_id);
        if (channel) {
          const channelContent = `⬆️ <@${discordId}> ha subido desde **RESERVA** al grupo principal para **${event.title}** (${fecha} ${hora}).`;
        const sent = await channel.send({ content: channelContent });
        try {
          if (sent && sent.id) {
            await query('INSERT INTO event_notifications (event_id, message_id) VALUES ($1, $2)', [event.id, sent.id]);
          }
        } catch (dbErr) {
          console.warn(`⚠️ No se pudo registrar event_notifications para evento ${event.id}:`, dbErr.message);
        }
        }
      }
    } catch (err) {
      console.warn(`⚠️ No se pudo enviar aviso al canal del evento ${event.id}:`, err && err.message ? err.message : err);
    }
  } catch (err) {
    console.warn(`⚠️ No se pudo enviar DM a ${discordId}: ${err && err.message ? err.message : err}`);
  }
}
