// services/eventAutoRecalcOnRoleChange.js
import { query } from '../db/database.js';
import { createOrUpdateEventEmbed } from './eventEmbedService.js';

/**
 * AUTO-RECALC DE ROLES CUANDO USUARIO CAMBIA ROLES EN DISCORD
 *
 * Cuando un usuario gana o pierde un rol en Discord:
 * - Se actualiza su capability en BD (en guildMemberUpdateRoles)
 * - Se actualizan los embeds de los eventos OPEN donde está ACTIVE
 */

export async function handleEventRecalcOnRoleChange(client, oldMember, newMember) {
  try {
    // 1️⃣ Obtener eventos OPEN donde el usuario esté ACTIVE
    const eventsRes = await query(`
      SELECT DISTINCT ep.event_id
      FROM event_participants ep
      JOIN events e ON e.id = ep.event_id
      WHERE ep.discord_id = $1
        AND ep.state = 'ACTIVE'
        AND e.status = 'OPEN'
    `, [newMember.id]);

    if (eventsRes.rowCount === 0) {
      return; // Usuario no está en eventos OPEN
    }

    console.log(`♻️ Recalculando roles para usuario ${newMember.user.tag} en ${eventsRes.rowCount} evento(s)`);

    // 2️⃣ Para cada evento, actualizar embed
    for (const row of eventsRes.rows) {
      try {
        const eventId = row.event_id;

        // Actualizar embed (puede haber cambios en roles disponibles)
        await createOrUpdateEventEmbed(client, eventId);

        console.log(`✅ Evento ${eventId} recalculado por cambio de rol`);

      } catch (err) {
        console.error(`❌ Error recalculando evento ${row.event_id}:`, err);
      }
    }

  } catch (err) {
    console.error('❌ Error en handleEventRecalcOnRoleChange:', err);
  }
}
