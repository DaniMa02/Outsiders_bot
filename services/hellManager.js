// services/hellManager.js
import { query } from '../db/database.js';
const MAX_PARTICIPANTS = 8;

/**
 * Devuelve un hell OPEN con hueco o crea uno nuevo
 */
export const getOrCreateOpenHell = async ({ date, timeSlot, channelId }) => {

  // 1️⃣ Buscar hells OPEN existentes para ese date + slot
  const hellsRes = await query(`
    SELECT h.id, h.group_number
    FROM hells h
    WHERE h.date = $1
      AND h.time_slot = $2
      AND h.status = 'OPEN'
    ORDER BY h.group_number ASC
  `, [date, timeSlot]);

  // 2️⃣ Si existe alguno con hueco → usarlo
  for (const hell of hellsRes.rows) {

    const countRes = await query(`
      SELECT COUNT(*)::int AS count
      FROM hell_participants
      WHERE hell_id = $1
    `, [hell.id]);

    if (countRes.rows[0].count < MAX_PARTICIPANTS) {
      return hell.id;
    }
  }

  // 3️⃣ Si todos están llenos o no existe ninguno → crear nuevo grupo

  const maxGroupRes = await query(`
    SELECT COALESCE(MAX(group_number), 0) AS max_group
    FROM hells
    WHERE date = $1
      AND time_slot = $2
  `, [date, timeSlot]);

  const newGroupNumber = maxGroupRes.rows[0].max_group + 1;

  const insertRes = await query(`
    INSERT INTO hells (date, time_slot, group_number, channel_id, status)
    VALUES ($1, $2, $3, $4, 'OPEN')
    RETURNING id
  `, [date, timeSlot, newGroupNumber, channelId]);

  return insertRes.rows[0].id;
};

/**
 * Devuelve todos los Hells con status 'OPEN'
 */
export const getAllOpenHells = async ({ date }) => {
  const res = await query(`
    SELECT id
    FROM hells
    WHERE date = $1
      AND status = 'OPEN'
    ORDER BY created_at ASC
  `, [date]);

  // Solo devolver los IDs como enteros
  return res.rows.map(r => r.id);
};

