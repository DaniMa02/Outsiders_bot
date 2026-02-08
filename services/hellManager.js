// services/hellManager.js
import { query } from '../db/database.js';
const MAX_PARTICIPANTS = 8;

/**
 * Devuelve un hell OPEN con hueco o crea uno nuevo
 */
export const getOrCreateOpenHell = async ({ date, timeSlot, channelId }) => {
  const hellsRes = await query(`
    SELECT h.id
    FROM hells h
    WHERE h.date = $1
      AND h.time_slot = $2
      AND h.status = 'OPEN'
    ORDER BY h.created_at ASC
  `, [date, timeSlot]);

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

  const insertRes = await query(`
    INSERT INTO hells (date, time_slot, channel_id, status)
    VALUES ($1, $2, $3, 'OPEN')
    RETURNING id
  `, [date, timeSlot, channelId]);

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

