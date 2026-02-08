// services/hellManager.js
import { query } from '../db/database.js';

const MAX_PARTICIPANTS = 8;

/**
 * Devuelve un hell OPEN con hueco o crea uno nuevo
 */
export const getOrCreateOpenHell = async ({
  date,
  timeSlot,
  channelId
}) => {
  // 1️⃣ Buscar hells abiertos para ese día y horario
  const hellsRes = await query(`
    SELECT h.id
    FROM hells h
    WHERE h.date = $1
      AND h.time_slot = $2
      AND h.status = 'OPEN'
    ORDER BY h.created_at ASC
  `, [date, timeSlot]);

  // 2️⃣ Revisar si alguno tiene hueco
  for (const hell of hellsRes.rows) {
    const countRes = await query(`
      SELECT COUNT(*)::int AS count
      FROM hell_participants
      WHERE hell_id = $1 AND state = 'ACTIVE'
    `, [hell.id]);

    if (countRes.rows[0].count < MAX_PARTICIPANTS) {
      return hell.id;
    }
  }

  // 3️⃣ Si todos están llenos o no hay ninguno → crear nuevo hell
  const insertRes = await query(`
    INSERT INTO hells (date, time_slot, channel_id, status)
    VALUES ($1, $2, $3, 'OPEN')
    RETURNING id
  `, [date, timeSlot, channelId]);

  return insertRes.rows[0].id;
};
