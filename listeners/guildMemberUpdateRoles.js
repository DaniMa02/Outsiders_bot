// listeners/guildMemberUpdateRoles.js
import { query } from '../db/database.js';

// Roles que consideramos capacidades para Hell
export const hellRoleCapabilities = ['HDD1', 'HDD2', 'HHOLY', 'HTANK1', 'HTANK2'];

/**
 * Actualiza las capacidades de un usuario en la base de datos según los roles que tiene en Discord
 */
export const handleGuildMemberUpdateRoles = async (oldMember, newMember) => {
  try {
    // Si los roles no han cambiado, salimos
    if (oldMember.roles.cache.equals(newMember.roles.cache)) return;

    const oldRolesSet = new Set(oldMember.roles.cache.map(r => r.name));
    const newRolesSet = new Set(newMember.roles.cache.map(r => r.name));

    // Verificar cada rol de capacidad
    for (const roleName of hellRoleCapabilities) {
      const hadRole = oldRolesSet.has(roleName);
      const hasRole = newRolesSet.has(roleName);

      // Si se añadió el rol
      if (!hadRole && hasRole) {
        await query(`
          INSERT INTO user_role_capabilities (discord_id, role)
          VALUES ($1, $2)
          ON CONFLICT (discord_id, role) DO NOTHING;
        `, [newMember.id, roleName]);

        console.log(`✅ Capacidad añadida para ${newMember.user.tag}: ${roleName}`);
      }

      // Si se quitó el rol
      if (hadRole && !hasRole) {
        await query(`
          DELETE FROM user_role_capabilities
          WHERE discord_id = $1 AND role = $2;
        `, [newMember.id, roleName]);

        console.log(`❌ Capacidad eliminada para ${newMember.user.tag}: ${roleName}`);
      }
    }

  } catch (err) {
    console.error('❌ Error actualizando capacidades de rol:', err);
  }
};
