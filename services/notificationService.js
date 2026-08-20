// services/notificationService.js
import { formatFechaMadrid, formatHoraMadrid } from '../utils/dateTime.js';

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

    await user.send({
      content: `¡Buenas! Has subido desde RESERVA al grupo principal para el evento **${event.title}** (${fecha} ${hora}). ¡Suerte!`
    });

    console.log(`✉️ Notificación DM enviada a ${discordId} por promoción en evento ${event.id}`);
  } catch (err) {
    console.warn(`⚠️ No se pudo enviar DM a ${discordId}: ${err && err.message ? err.message : err}`);
  }
}
