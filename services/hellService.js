import { query } from '../db/database.js';
import { createOrUpdateHellEmbed } from './hellEmbedService.js';

// -------------------- COLA DE UPDATES --------------------
const hellUpdateQueue = [];
let isProcessingQueue = false;

function queueHellUpdate(hellId, client) {
  if (hellUpdateQueue.includes(hellId)) return;
  hellUpdateQueue.push(hellId);
  processQueue(client);
}

async function processQueue(client) {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (hellUpdateQueue.length > 0) {
    const hellId = hellUpdateQueue.shift();

    try {
      await createOrUpdateHellEmbed(client, hellId);
    } catch (err) {
      console.error('❌ Error en update Hell:', err);
    }

    // 🔥 RATE LIMIT GLOBAL (CLAVE)
    await new Promise(res => setTimeout(res, 1200));
  }

  isProcessingQueue = false;
}

// ======================================================
// JOIN HELL
// ======================================================
export async function joinHell({ date, timeSlot, discordId, channelId, client }) {
  const existingRes = await query(`
    SELECT hp.id, hp.state, hp.hell_id
    FROM hell_participants hp
    JOIN hells h ON hp.hell_id = h.id
    WHERE hp.discord_id = $1
      AND h.date = $2
      AND h.time_slot = $3
  `, [discordId, date, timeSlot]);

  if (existingRes.rowCount > 0) {
    const participant = existingRes.rows[0];
    if (participant.state === 'ACTIVE') throw new Error("Ya estás apuntado en este horario.");

    if (participant.state === 'ABSENCE') {
      const originalRes = await query(`
        SELECT original_hell_id, original_slot
        FROM hell_participants
        WHERE id = $1
      `, [participant.id]);

      const { original_hell_id, original_slot } = originalRes.rows[0];

      const occupyingRes = await query(`
        SELECT *
        FROM hell_participants
        WHERE hell_id = $1
          AND slot_number = $2
          AND state = 'ACTIVE'
        LIMIT 1
      `, [original_hell_id, original_slot]);

      if (occupyingRes.rowCount > 0) {
        const occupyingPlayer = occupyingRes.rows[0];
        if (occupyingPlayer.is_replacement) {
          const fromHellId = occupyingPlayer.hell_id;
          const toHellId = occupyingPlayer.original_hell_id;

          await query(`
            UPDATE hell_participants
            SET hell_id = original_hell_id,
                slot_number = original_slot,
                is_replacement = false
            WHERE id = $1
          `, [occupyingPlayer.id]);

          await recalculateRoles(fromHellId);
          await recalculateRoles(toHellId);

          queueHellUpdate(fromHellId, client);
          queueHellUpdate(toHellId, client);
        } else {
          throw new Error("Slot ocupado por jugador no replacement. Estado inconsistente.");
        }
      }

      await query(`
        UPDATE hell_participants
        SET state = 'ACTIVE',
            is_replacement = false,
            hell_id = original_hell_id,
            slot_number = original_slot
        WHERE id = $1
      `, [participant.id]);

      await recalculateRoles(original_hell_id);
      queueHellUpdate(original_hell_id, client);

      return original_hell_id;
    }
  }

  // 🔹 Buscar hell abierto con hueco
  const hellRes = await query(`
    SELECT h.id
    FROM hells h
    LEFT JOIN hell_participants p 
      ON h.id = p.hell_id 
      AND p.state = 'ACTIVE'
    WHERE h.date = $1
      AND h.time_slot = $2
      AND h.status = 'OPEN'
    GROUP BY h.id
    HAVING COUNT(p.id) < 8
    ORDER BY h.group_number ASC
    LIMIT 1
  `, [date, timeSlot]);

  let hellId;
  if (hellRes.rowCount > 0) hellId = hellRes.rows[0].id;
  else {
    const maxGroupRes = await query(`
      SELECT COALESCE(MAX(group_number), 0) as max_group
      FROM hells
      WHERE date = $1 AND time_slot = $2
    `, [date, timeSlot]);

    const newGroupNumber = maxGroupRes.rows[0].max_group + 1;

    const insertHell = await query(`
      INSERT INTO hells (date, time_slot, group_number, channel_id, status)
      VALUES ($1, $2, $3, $4, 'OPEN')
      RETURNING id
    `, [date, timeSlot, newGroupNumber, channelId]);

    hellId = insertHell.rows[0].id;
  }

  const slotRes = await query(`
    SELECT COALESCE(MAX(original_slot), 0) + 1 AS next_slot
    FROM hell_participants
    WHERE hell_id = $1
  `, [hellId]);

  const slotNumber = slotRes.rows[0].next_slot;

  await query(`
    INSERT INTO hell_participants
    (
      hell_id,
      discord_id,
      slot_number,
      state,
      is_replacement,
      original_slot,
      original_hell_id
    )
    VALUES ($1, $2, $3, 'ACTIVE', false, $3, $1)
  `, [hellId, discordId, slotNumber]);

  await recalculateRoles(hellId);
  queueHellUpdate(hellId, client);

  return hellId;
}

// ======================================================
// RECALCULATE ROLES (SIN EMBEDS)
// ======================================================
export async function recalculateRoles(hellId) {
  const res = await query(`
    SELECT *
    FROM hell_participants
    WHERE hell_id = $1
      AND state = 'ACTIVE'
    ORDER BY joined_at ASC
  `, [hellId]);

  const players = res.rows;
  if (!players.length) return;

  await query(`UPDATE hell_participants SET assigned_role = NULL WHERE hell_id = $1`, [hellId]);

  const capabilitiesRes = await query(`
    SELECT discord_id, role
    FROM user_role_capabilities
    WHERE discord_id = ANY($1)
  `, [players.map(p => p.discord_id)]);

  const capabilityMap = {};
  for (const row of capabilitiesRes.rows) {
    if (!capabilityMap[row.discord_id]) capabilityMap[row.discord_id] = [];
    capabilityMap[row.discord_id].push(row.role);
  }

  const assigned = new Set();

  async function assignRole(role, player) {
    await query(`UPDATE hell_participants SET assigned_role = $1 WHERE id = $2`, [role, player.id]);
    assigned.add(player.id);
  }

  function findCandidate(checkFn) {
    const candidates = players.filter(p => !assigned.has(p.id) && checkFn(capabilityMap[p.discord_id] || []));
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  const existsHolyLurer = players.some(p => (capabilityMap[p.discord_id] || []).includes('HHOLYLURER'));

  if (existsHolyLurer) {
    const tank1 = findCandidate(r => r.includes('HTANK1')); if (tank1) await assignRole('HTANK1', tank1);
    const holyLurer = findCandidate(r => r.includes('HHOLYLURER')); if (holyLurer) await assignRole('HHOLYLURER', holyLurer);
  } else {
    const tank1 = findCandidate(r => r.includes('HTANK1')); if (tank1) await assignRole('HTANK1', tank1);
    const tank2 = findCandidate(r => r.includes('HTANK2') || r.includes('HTANK1')); if (tank2) await assignRole('HTANK2', tank2);
    const holy = findCandidate(r => r.includes('HHOLY') || r.includes('HHOLYLURER')); if (holy) await assignRole('HHOLY', holy);
  }

  const remaining = players.filter(p => !assigned.has(p.id));
  for (const p of remaining) {
    const caps = capabilityMap[p.discord_id] || [];
    const roleToAssign = caps.includes('HDD1') ? 'HDD1' : caps.includes('HDD2') ? 'HDD2' : 'HDD1';
    await assignRole(roleToAssign, p);
  }
}

// ======================================================
// MARK ABSENCE
// ======================================================
export async function markAbsence(participantId, client) {
  const participantRes = await query(`SELECT * FROM hell_participants WHERE id = $1`, [participantId]);
  if (!participantRes.rowCount) return;
  let participant = participantRes.rows[0];

  if (participant.is_replacement) {
    await query(`
      UPDATE hell_participants
      SET hell_id = original_hell_id,
          slot_number = original_slot,
          is_replacement = false
      WHERE id = $1
    `, [participantId]);

    participant = { ...participant, hell_id: participant.original_hell_id, slot_number: participant.original_slot, is_replacement: false };
  }

  await query(`
    UPDATE hell_participants
    SET state = 'ABSENCE',
        slot_number = NULL
    WHERE id = $1
  `, [participantId]);

  await collapseFromHell(participant.hell_id, participant.slot_number, client);
}

// ======================================================
// COLLAPSE FROM HELL
// ======================================================
async function collapseFromHell(startHellId, vacantSlot, client) {
  let currentHellId = startHellId;
  let currentVacantSlot = vacantSlot;

  while (true) {
    const nextHellRes = await query(`
      SELECT h2.*
      FROM hells h1
      JOIN hells h2 ON h1.date = h2.date AND h1.time_slot = h2.time_slot AND h2.group_number > h1.group_number
      WHERE h1.id = $1 AND h2.status = 'OPEN'
      ORDER BY h2.group_number ASC
      LIMIT 1
    `, [currentHellId]);

    if (!nextHellRes.rowCount) {
      await recalculateRoles(currentHellId);
      queueHellUpdate(currentHellId, client);
      break;
    }

    const nextHell = nextHellRes.rows[0];
    const candidateRes = await query(`
      SELECT *
      FROM hell_participants
      WHERE hell_id = $1 AND state = 'ACTIVE'
      ORDER BY slot_number ASC
      LIMIT 1
    `, [nextHell.id]);

    if (!candidateRes.rowCount) {
      await deleteHell(nextHell.id, client);
      break;
    }

    const player = candidateRes.rows[0];

    await query(`
      UPDATE hell_participants
      SET hell_id = $1, slot_number = $2, is_replacement = true
      WHERE id = $3
    `, [currentHellId, currentVacantSlot, player.id]);

    await recalculateRoles(currentHellId);
    queueHellUpdate(currentHellId, client);

    currentHellId = nextHell.id;
    currentVacantSlot = player.slot_number;

    const remainingRes = await query(`
      SELECT COUNT(*) FROM hell_participants WHERE hell_id = $1 AND state = 'ACTIVE'
    `, [currentHellId]);

    if (parseInt(remainingRes.rows[0].count) === 0) {
      await deleteHell(currentHellId, client);
      break;
    }
  }
}

// ======================================================
// DELETE HELL
// ======================================================
async function deleteHell(hellId, client) {
  const hellRes = await query(`SELECT channel_id, message_id FROM hells WHERE id = $1`, [hellId]);
  if (!hellRes.rowCount) return;
  const hell = hellRes.rows[0];

  if (hell.message_id) {
    try {
      const channel = await client.channels.fetch(hell.channel_id);
      if (channel) {
        const msg = await channel.messages.fetch(hell.message_id);
        await msg.delete();
      }
    } catch (err) {
      console.log("No se pudo borrar embed:", err.message);
    }
  }

  await query(`DELETE FROM hells WHERE id = $1`, [hellId]);
}