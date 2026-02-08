// // hellLogic.js
// import { query } from '../db/database.js';

// export const hellRoleLimits = { DD1: 1, DD2: 1, HOLY: 1, TANK1: 1, TANK2: 1 };

// // Roles visuales para embed
// export const visualRoleMap = { DD1: 'DD', DD2: 'DD', HOLY: 'HOLY', TANK1: 'MAINTANK', TANK2: 'SECONDLURER' };

// export const recalcHellAssignments = async (hellId) => {
//   const participantsRes = await query(`
//     SELECT p.discord_id, c.role AS capability, p.joined_at
//     FROM hell_participants p
//     LEFT JOIN user_role_capabilities c ON p.discord_id = c.discord_id
//     WHERE p.hell_id = $1
//     ORDER BY p.joined_at ASC
//   `, [hellId]);

//   const participants = participantsRes.rows;

//   // Inicializamos contadores de roles
//   const roleCounts = { DD1: 0, DD2: 0, HOLY: 0, TANK1: 0, TANK2: 0 };

//   for (const p of participants) {
//     let assigned = null;

//     for (const role of ['HOLY', 'TANK1', 'TANK2', 'DD1', 'DD2']) {
//       if (!p.capability) continue;
//       const caps = Array.isArray(p.capability) ? p.capability : [p.capability];
//       if (caps.includes(role) && roleCounts[role] < hellRoleLimits[role]) {
//         assigned = role;
//         roleCounts[role]++;
//         break;
//       }
//     }

//     await query(`
//       UPDATE hell_participants
//       SET assigned_role = $1
//       WHERE hell_id = $2 AND discord_id = $3
//     `, [assigned, hellId, p.discord_id]);
//   }
// };
