import { query } from '../db/database.js';
import { recalculateRoles } from './hellService.js';
import { createOrUpdateHellEmbed } from './hellEmbedService.js';

/**
 * Recalcula los roles de cualquier hell activo donde el usuario esté participando
 * y actualiza los embeds correspondientes
 */
export async function handleHellRecalcOnRoleChange(client, oldMember, newMember) {

  // Buscar hells OPEN donde el usuario esté activo
  const hellsRes = await query(`
    SELECT DISTINCT hp.hell_id
    FROM hell_participants hp
    JOIN hells h ON h.id = hp.hell_id
    WHERE hp.discord_id = $1
      AND hp.state = 'ACTIVE'
      AND h.status = 'OPEN'
  `, [newMember.id]);

  if (!hellsRes.rows.length) return;

  for (const row of hellsRes.rows) {
    await recalculateRoles(row.hell_id);
    await createOrUpdateHellEmbed(client, row.hell_id); // ✅ Pasamos client

    console.log(`♻ Hell ${row.hell_id} recalculado por cambio de rol`);
  }
}
