// services/hellService.js
import { query } from '../db/database.js';
// import { visualRoleMap } from '../config/hellRoles.js';
// Límite de roles por Hell
const hellRoleLimits = {
  HHOLY: 1,
  HTANK1: 1,
  HTANK2: 1,
  HDD: 5 // máximo combinado DD1 + DD2
};

// Prioridad de asignación: obligatorios primero, luego DD1/DD2
// const rolePriority = ['HOLY', 'TANK1', 'TANK2', 'DD1', 'DD2'];

// Mapeo para mostrar en embed

export const recalcHellAssignments = async (hellId) => {
  // Traer participantes y capacidades
  const res = await query(`
    SELECT p.discord_id, array_agg(c.role) AS capabilities, p.joined_at
    FROM hell_participants p
    LEFT JOIN user_role_capabilities c ON p.discord_id = c.discord_id
    WHERE p.hell_id = $1 AND p.state = 'ACTIVE'
    GROUP BY p.discord_id, p.joined_at
    ORDER BY p.joined_at ASC
  `, [hellId]);

  const participants = res.rows;

  // Contadores de roles asignados
  const roleCounts = { HHOLY: 0, HTANK1: 0, HTANK2: 0, HDD: 0 };

  for (const p of participants) {
    let assigned = null;
    const caps = p.capabilities || [];

    // 1️⃣ Roles obligatorios primero
    for (const role of ['HHOLY', 'HTANK1', 'HTANK2']) {
      if (caps.includes(role) && roleCounts[role] < hellRoleLimits[role]) {
        assigned = role;
        roleCounts[role]++;
        break;
      }
    }

    // 2️⃣ Si no se asignó obligatorio, asignar DD
    if (!assigned) {
      // Prioridad DD1 > DD2
      for (const ddRole of ['HDD1', 'HDD2']) {
        if (caps.includes(ddRole) && roleCounts.HDD < hellRoleLimits.HDD) {
          assigned = ddRole;
          roleCounts.HDD++;
          break;
        }
      }
    }

    // Actualizar en DB
    await query(`
      UPDATE hell_participants
      SET assigned_role = $1
      WHERE hell_id = $2 AND discord_id = $3
    `, [assigned, hellId, p.discord_id]);
  }
};
