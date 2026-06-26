// scripts/syncMembers.js
//
// SCRIPT DE SINCRONIZACIÓN INICIAL
// --------------------------------
// Úsalo UNA VEZ después de migrar la BD a Supabase, para rellenar
// `users` y `user_role_capabilities` con el estado real de Discord.
//
// Lo que hace por cada miembro del guild:
//   1. Inserta/actualiza su fila en `users` con class + nickname
//   2. Compara las capabilities de BD vs los roles de Discord y hace
//      INSERT/DELETE solo si difieren
//
// Lo que NO hace:
//   - NO recalcula embeds de eventos (porque no es un cambio real, es
//     un catch-up inicial; el siguiente GuildMemberUpdate real sí lo
//     hará)
//
// Uso:
//   1. Asegúrate de que el .env apunta a Supabase
//   2. node scripts/syncMembers.js
//
// El script es idempotente: puedes correrlo varias veces sin problema.

import { Client, GatewayIntentBits, Events } from 'discord.js';
import dotenv from 'dotenv';
import { query } from '../db/database.js';
import { setUserClass, getUserCapabilities, addUserCapability, removeUserCapability } from '../db/eventRepository.js';
import { inferClassFromDiscordRoles } from '../utils/classInference.js';

dotenv.config();

const EVENT_ROLE_CAPABILITIES = ['HTank', 'HDD', 'HHealer', 'HDebuffer', 'HLurer'];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

async function syncMember(member) {
  const userId = member.id;
  const tag = member.user.tag;

  // 1) Clase + nickname
  const inferredClass = inferClassFromDiscordRoles(member);
  if (inferredClass) {
    await setUserClass(userId, inferredClass);
  }

  const newNickname = member.displayName;
  const nickRes = await query(`
    UPDATE users SET nickname = $1
    WHERE discord_id = $2 AND nickname IS DISTINCT FROM $1
  `, [newNickname, userId]);

  // 2) Capabilities: BD vs Discord
  const dbCaps = await getUserCapabilities(userId);
  const dbCapsSet = new Set(dbCaps);
  const memberRoleNames = new Set(member.roles.cache.map(r => r.name));

  let changes = 0;
  for (const cap of EVENT_ROLE_CAPABILITIES) {
    const hasInMember = memberRoleNames.has(cap);
    const hasInDb = dbCapsSet.has(cap);

    if (hasInMember && !hasInDb) {
      await addUserCapability(userId, cap);
      changes++;
    } else if (!hasInMember && hasInDb) {
      await removeUserCapability(userId, cap);
      changes++;
    }
  }

  return { tag, classChanged: !!inferredClass, nickChanged: nickRes.rowCount > 0, capsChanged: changes };
}

client.once(Events.ClientReady, async () => {
  try {
    console.log(`✅ Bot listo como ${client.user.tag}`);

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
      console.error('❌ GUILD_ID no definido en .env');
      process.exit(1);
    }

    const guild = await client.guilds.fetch(guildId);
    console.log(`🔄 Sincronizando miembros de "${guild.name}" (${guild.id})...`);

    // Forzar fetch de TODOS los miembros
    await guild.members.fetch();

    let total = 0;
    let bots = 0;
    let withChanges = 0;

    for (const member of guild.members.cache.values()) {
      if (member.user.bot) {
        bots++;
        continue;
      }

      const result = await syncMember(member);
      total++;
      if (result.classChanged || result.nickChanged || result.capsChanged > 0) {
        withChanges++;
        console.log(`  ~ ${result.tag} | clase:${result.classChanged ? '✓' : ' '} nick:${result.nickChanged ? '✓' : ' '} caps:${result.capsChanged}`);
      }
    }

    console.log(`\n📊 Resumen:`);
    console.log(`   Miembros procesados: ${total} (bots excluidos: ${bots})`);
    console.log(`   Con cambios aplicados: ${withChanges}`);
    console.log(`\n✅ Sincronización completada.`);
  } catch (err) {
    console.error('❌ Error durante la sincronización:', err);
  } finally {
    await client.destroy();
    const { pool } = await import('../db/database.js');
    await pool.end();
    process.exit(0);
  }
});

client.login(process.env.TOKEN);
