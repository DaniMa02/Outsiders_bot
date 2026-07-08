// utils/oneTimeSync.js
//
// Script de sincronización inicial pensado para invocarse desde index.js
// cuando la variable de entorno RUN_SYNC=1 está definida.
// Una vez ejecutado, se elimina la variable y se reinicia el bot.

import { query } from '../db/database.js';
import { setUserClass, getUserCapabilities, addUserCapability, removeUserCapability } from '../db/eventRepository.js';
import { inferClassFromDiscordRoles } from './classInference.js';

const EVENT_ROLE_CAPABILITIES = ['HTank', 'HDD', 'HHealer', 'HDebuffer', 'HLurer'];

export async function runOneTimeSync(client) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    console.error('❌ [SYNC] GUILD_ID no definido en .env');
    return;
  }

  const guild = await client.guilds.fetch(guildId);
  console.log(`🔄 [SYNC] Sincronizando miembros de "${guild.name}" (${guild.id})...`);

  await guild.members.fetch();

  let total = 0;
  let bots = 0;
  let withChanges = 0;

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) {
      bots++;
      continue;
    }

    const userId = member.id;
    const tag = member.user.tag;

    // 1) Clase + nickname
    const inferredClass = inferClassFromDiscordRoles(member);
    if (inferredClass) {
      await setUserClass(userId, inferredClass);
    }

    const nickRes = await query(`
      UPDATE users SET nickname = $1
      WHERE discord_id = $2 AND nickname IS DISTINCT FROM $1
    `, [member.displayName, userId]);

    // 2) Capabilities
    const dbCaps = await getUserCapabilities(userId);
    const dbCapsSet = new Set(dbCaps);
    const memberRoleNames = new Set(member.roles.cache.map(r => r.name));

    let capsChanged = 0;
    for (const cap of EVENT_ROLE_CAPABILITIES) {
      const hasInMember = memberRoleNames.has(cap);
      const hasInDb = dbCapsSet.has(cap);

      if (hasInMember && !hasInDb) {
        await addUserCapability(userId, cap);
        capsChanged++;
      } else if (!hasInMember && hasInDb) {
        await removeUserCapability(userId, cap);
        capsChanged++;
      }
    }

    total++;
    if (inferredClass || nickRes.rowCount > 0 || capsChanged > 0) {
      withChanges++;
      console.log(`  ~ ${tag} | clase:${inferredClass ? '✓' : ' '} nick:${nickRes.rowCount > 0 ? '✓' : ' '} caps:${capsChanged}`);
    }
  }

  console.log(`\n📊 [SYNC] Procesados: ${total} | Bots excluidos: ${bots} | Con cambios: ${withChanges}`);
  console.log(`✅ [SYNC] Sincronización completada.`);
  console.log(`👉 [SYNC] Cuando veas esto, edita el .env y BORRA la línea RUN_SYNC=1, luego reinicia el bot.`);
}
