// listeners/guildMemberUpdate.js
import { inferClassFromDiscordRoles } from '../utils/classInference.js';
import { setUserClass } from '../db/hellRepository.js';
import { classRoleIds, ROLE_SIN_CLASE } from '../config/classRoles.js';

export const handleGuildMemberUpdate = async (oldMember, newMember) => {
  try {
    // Si los roles no han cambiado, salimos
    if (oldMember.roles.cache.equals(newMember.roles.cache)) return;

    // Inferir clase desde roles actuales
    const inferredClass = inferClassFromDiscordRoles(newMember);

    // Si no tiene ninguna clase, no tocamos BD ni roles
    if (!inferredClass) return;

    // Guardar clase en BD
    await setUserClass(newMember.id, inferredClass);

    // ---------------- Quitar rol de "Sin Clase" si tiene alguno de los roles de clase ----------------
    const hasClassRole = Object.values(classRoleIds).some(roleId => newMember.roles.cache.has(roleId));
    if (hasClassRole && newMember.roles.cache.has(ROLE_SIN_CLASE)) {
      await newMember.roles.remove(ROLE_SIN_CLASE).catch(err =>
        console.error(`❌ Error quitando ROLE_SIN_CLASE a ${newMember.user.tag}:`, err)
      );
    }

    console.log(`🔄 Clase sincronizada y roles actualizados: ${newMember.user.tag} → ${inferredClass}`);

  } catch (err) {
    console.error('❌ Error en guildMemberUpdate:', err);
  }
};
