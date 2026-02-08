// scheduler/syncRoles.js
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { setUserClass } from '../db/hellRepository.js';

dotenv.config();

export const syncRolesWithDatabase = async (client) => {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.members.fetch(); // carga todos los miembros

    const roleMap = {
      ARCHER: botVariables.ROLE_ARCHER,
      SWORDSMAN: botVariables.ROLE_SWORDSMAN,
      MAGE: botVariables.ROLE_MAGE,
      MARTIAL_ARTIST: botVariables.ROLE_MARTIAL,
    };

    guild.members.cache.forEach(async (member) => {
      // ignorar bots
      if (member.user.bot) return;

      let userClass = null;

      // comprobar qué rol de clase tiene
      for (const [cls, roleId] of Object.entries(roleMap)) {
        if (member.roles.cache.has(roleId)) {
          userClass = cls;
          break;
        }
      }

      if (userClass) {
        await setUserClass(member.id, userClass);
      }
    });

    console.log('✅ Sincronización de roles con BD completada');
  } catch (err) {
    console.error('❌ Error sincronizando roles con BD:', err);
  }
};
