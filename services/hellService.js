// services/hellService.js
import { query } from '../db/database.js';

// Límite de roles por Hell
const hellRoleLimits = {
  HHOLY: 1,
  HTANK1: 1,
  HTANK2: 1,
  HDD: 5 // máximo combinado DD1 + DD2
};

/**
 * Recalcula los roles asignados de todos los participantes de un Hell.
 * - Revisa capabilities de cada usuario
 * - Asigna primero roles obligatorios, rebalanceando si alguien puede ir a varios roles
 * - Luego asigna roles DD hasta máximo 5 plazas combinadas, respetando orden de llegada
 */
export const recalcHellAssignments = async (hellId) => {
  // 1️⃣ Traer participantes activos con sus capabilities
  const res = await query(`
    SELECT p.discord_id, array_agg(c.role) AS capabilities, p.joined_at
    FROM hell_participants p
    LEFT JOIN user_role_capabilities c ON p.discord_id = c.discord_id
    WHERE p.hell_id = $1 AND p.state = 'ACTIVE'
    GROUP BY p.discord_id, p.joined_at
    ORDER BY p.joined_at ASC
  `, [hellId]);

  const participants = res.rows.map(p => ({
    discord_id: p.discord_id,
    capabilities: p.capabilities || [],
    assigned_role: null
  }));

  // 2️⃣ Inicializar contadores
  const roleCounts = { HHOLY: 0, HTANK1: 0, HTANK2: 0, HDD: 0 };

  // 3️⃣ Asignar roles obligatorios
  const mandatoryRoles = ['HHOLY', 'HTANK1', 'HTANK2'];

  for (let role of mandatoryRoles) {
    let availableSlots = hellRoleLimits[role];

    while (availableSlots > 0) {
      // Buscar participantes sin rol que solo puedan ocupar este rol obligatorio
      let candidate = participants.find(p => !p.assigned_role && p.capabilities.includes(role) && p.capabilities.filter(r => mandatoryRoles.includes(r) || r.startsWith('HDD')).length === 1);

      // Si no hay candidatos "solo este rol", buscar cualquiera que pueda ocuparlo
      if (!candidate) {
        candidate = participants.find(p => !p.assigned_role && p.capabilities.includes(role));
      }

      if (!candidate) break; // No hay más candidatos para este rol
      candidate.assigned_role = role;
      roleCounts[role]++;
      availableSlots--;
    }
  }

  // 4️⃣ Asignar roles DD a los que quedan sin rol
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

  // 5️⃣ Actualizar base de datos
  for (const p of participants) {
    await query(`
      UPDATE hell_participants
      SET assigned_role = $1
      WHERE hell_id = $2 AND discord_id = $3
    `, [p.assigned_role, hellId, p.discord_id]);
  }
};
