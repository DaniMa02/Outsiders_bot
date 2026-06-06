// listeners/guildMemberUpdate.js
import { inferClassFromDiscordRoles } from '../utils/classInference.js';
import { setUserClass } from '../db/eventRepository.js';
import { classRoleIds, ROLE_SIN_CLASE } from '../config/classRoles.js';
import { query } from '../db/database.js';

export const handleGuildMemberUpdate = async (oldMember, newMember) => {
  try {
    // 1️⃣ Si los roles y nickname no han cambiado, salimos
    if (oldMember.roles.cache.equals(newMember.roles.cache) &&
        oldMember.nickname === newMember.nickname) return;

    // 2️⃣ Inferir clase desde roles actuales
    const inferredClass = inferClassFromDiscordRoles(newMember);

    if (inferredClass) {
      // Guardar clase en BD
      await setUserClass(newMember.id, inferredClass);
    }

    // 3️⃣ Quitar rol temporal de "Sin Clase" si ya tiene algún rol de clase
    const hasClassRole = Object.values(classRoleIds).some(roleId => newMember.roles.cache.has(roleId));
    if (hasClassRole && newMember.roles.cache.has(ROLE_SIN_CLASE)) {
      await newMember.roles.remove(ROLE_SIN_CLASE).catch(err =>
        console.error(`❌ Error quitando ROLE_SIN_CLASE a ${newMember.user.tag}:`, err)
      );
    }

    // 4️⃣ Actualizar nickname en BD si ha cambiado
    const newNickname = newMember.displayName; // nickname visible en el servidor
    await query(`
      UPDATE users
      SET nickname = $1
      WHERE discord_id = $2
    `, [newNickname, newMember.id]);

    console.log(`🔄 Clase y nickname sincronizados: ${newMember.user.tag} → Clase: ${inferredClass || 'N/A'}, Nickname: ${newNickname}`);

  } catch (err) {
    console.error('❌ Error en guildMemberUpdate:', err);
  }
};
