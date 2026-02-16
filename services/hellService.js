import { query } from '../db/database.js';

const MAX_PER_HELL = 8;

// Límite de roles por Hell
const hellRoleLimits = {
  HHOLY: 1,
  HTANK1: 1,
  HTANK2: 1,
  HDD: 5
};

/* =========================================================
   FUNCIÓN PRINCIPAL → REBALANCEO COMPLETO POR HORARIO
========================================================= */

export const rebalanceTimeSlot = async (hellId) => {
  try {
    await query('BEGIN');

    // 1️⃣ Obtener date y time_slot del hell afectado
    const hellInfo = await query(`
      SELECT date, time_slot
      FROM hells
      WHERE id = $1
    `, [hellId]);

    if (!hellInfo.rows.length) {
      await query('ROLLBACK');
      return;
    }

    const { date, time_slot } = hellInfo.rows[0];

    // 2️⃣ Obtener todos los hells del mismo horario
    const hellsRes = await query(`
      SELECT id
      FROM hells
      WHERE date = $1 AND time_slot = $2
      ORDER BY created_at ASC
    `, [date, time_slot]);

    const hellIds = hellsRes.rows.map(h => h.id);

    if (!hellIds.length) {
      await query('ROLLBACK');
      return;
    }

    // 3️⃣ Obtener TODOS los participantes ACTIVE del horario
    const participantsRes = await query(`
      SELECT discord_id, joined_at
      FROM hell_participants
      WHERE hell_id = ANY($1)
        AND state = 'ACTIVE'
      ORDER BY joined_at ASC
    `, [hellIds]);

    console.log("HELLS:", hellIds);
    console.log("PARTICIPANTS ACTIVE:", participants);
    const participants = participantsRes.rows;

    // 4️⃣ Reasignar hell_id en bloques de 8
    for (let i = 0; i < participants.length; i++) {
      const targetHellIndex = Math.floor(i / MAX_PER_HELL);
      const targetHellId = hellIds[targetHellIndex];

      await query(`
        UPDATE hell_participants
        SET hell_id = $1
        WHERE discord_id = $2
          AND state = 'ACTIVE'
      `, [targetHellId, participants[i].discord_id]);
    }

    // 5️⃣ Eliminar hells vacíos
    for (const hId of hellIds) {
      const countRes = await query(`
        SELECT COUNT(*) 
        FROM hell_participants
        WHERE hell_id = $1 AND state = 'ACTIVE'
      `, [hId]);

      if (parseInt(countRes.rows[0].count) === 0) {
        await query(`DELETE FROM hells WHERE id = $1`, [hId]);
      }
    }

    // 6️⃣ Recalcular roles dentro de cada hell
    for (const hId of hellIds) {
      await recalcRolesInsideHell(hId);
    }

    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK');
    console.error('Error en rebalanceTimeSlot:', error);
  }
};

/* =========================================================
   REASIGNACIÓN DE ROLES DENTRO DE UN HELL
========================================================= */

const recalcRolesInsideHell = async (hellId) => {

  const res = await query(`
    SELECT p.discord_id, array_agg(c.role) AS capabilities, p.joined_at
    FROM hell_participants p
    LEFT JOIN user_role_capabilities c 
      ON p.discord_id = c.discord_id
    WHERE p.hell_id = $1 
      AND p.state = 'ACTIVE'
    GROUP BY p.discord_id, p.joined_at
    ORDER BY p.joined_at ASC
  `, [hellId]);

  const participants = res.rows.map(p => ({
    discord_id: p.discord_id,
    capabilities: p.capabilities || [],
    assigned_role: null
  }));

  const roleCounts = { HHOLY: 0, HTANK1: 0, HTANK2: 0, HDD: 0 };
  const mandatoryRoles = ['HHOLY', 'HTANK1', 'HTANK2'];

  // 1️⃣ Roles obligatorios
  for (let role of mandatoryRoles) {
    let availableSlots = hellRoleLimits[role];

    while (availableSlots > 0) {
      let candidate = participants.find(p =>
        !p.assigned_role &&
        p.capabilities.includes(role) &&
        p.capabilities.filter(r =>
          mandatoryRoles.includes(r) || r.startsWith('HDD')
        ).length === 1
      );

      if (!candidate) {
        candidate = participants.find(p =>
          !p.assigned_role &&
          p.capabilities.includes(role)
        );
      }

      if (!candidate) break;

      candidate.assigned_role = role;
      roleCounts[role]++;
      availableSlots--;
    }
  }

  // 2️⃣ DD
  const ddRoles = ['HDD1', 'HDD2'];

  for (const p of participants) {
    if (!p.assigned_role && roleCounts.HDD < hellRoleLimits.HDD) {
      for (let ddRole of ddRoles) {
        if (p.capabilities.includes(ddRole)) {
          p.assigned_role = ddRole;
          roleCounts.HDD++;
          break;
        }
      }
    }
  }

  // 3️⃣ Guardar en DB
  for (const p of participants) {
    await query(`
      UPDATE hell_participants
      SET assigned_role = $1
      WHERE hell_id = $2 AND discord_id = $3
    `, [p.assigned_role, hellId, p.discord_id]);
  }
};
