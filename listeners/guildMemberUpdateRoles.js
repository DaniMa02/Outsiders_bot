import { query } from '../db/database.js';
import { handleHellRecalcOnRoleChange } from '../services/hellAutoRecalcOnRoleChange.js';

export const hellRoleCapabilities = [
  'HDD1','HDD2','HHOLY','HTANK1','HTANK2','HHOLYLURER'
];

export const handleGuildMemberUpdateRoles = (client) => async (oldMember, newMember) => {
  try {
    if (oldMember.roles.cache.equals(newMember.roles.cache)) return;

    const oldRolesSet = new Set(oldMember.roles.cache.map(r => r.name));
    const newRolesSet = new Set(newMember.roles.cache.map(r => r.name));
    let capabilityChanged = false;

    for (const roleName of hellRoleCapabilities) {
      const hadRole = oldRolesSet.has(roleName);
      const hasRole = newRolesSet.has(roleName);

      if (!hadRole && hasRole) {
        await query(`
          INSERT INTO user_role_capabilities (discord_id, role)
          VALUES ($1, $2)
          ON CONFLICT (discord_id, role) DO NOTHING;
        `, [newMember.id, roleName]);
        console.log(`✅ Capacidad añadida para ${newMember.user.tag}: ${roleName}`);
        capabilityChanged = true;
      }

      if (hadRole && !hasRole) {
        await query(`
          DELETE FROM user_role_capabilities
          WHERE discord_id = $1 AND role = $2;
        `, [newMember.id, roleName]);
        console.log(`❌ Capacidad eliminada para ${newMember.user.tag}: ${roleName}`);
        capabilityChanged = true;
      }
    }

    // 🔥 Recalcular hells solo si cambió alguna capability
    if (capabilityChanged) {
      await handleHellRecalcOnRoleChange(client, oldMember, newMember); // ✅ Pasamos client
    }

  } catch (err) {
    console.error('❌ Error actualizando capacidades de rol:', err);
  }
};
