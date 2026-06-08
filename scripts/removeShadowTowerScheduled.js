// scripts/removeShadowTowerScheduled.js
import { query, pool } from '../db/database.js';

(async () => {
  try {
    const res = await query(
      `SELECT id, channel_id, send_time, days_of_week, content
       FROM scheduled_messages
       WHERE content ILIKE '%SHADOW TOWER%' OR content ILIKE '%shadow tower%'`
    );
    if (res.rowCount === 0) {
      console.log('ℹ️ No hay scheduled_messages con "SHADOW TOWER".');
      return;
    }
    console.log('🔎 Filas encontradas:');
    console.table(res.rows);
    const ids = res.rows.map(r => r.id);
    const del = await query(
      'DELETE FROM scheduled_messages WHERE id = ANY($1::int[]) RETURNING id',
      [ids]
    );
    console.log(`🗑️ Eliminadas: ${del.rowCount} fila(s) [${ids.join(', ')}]`);
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await pool.end();
  }
})();
