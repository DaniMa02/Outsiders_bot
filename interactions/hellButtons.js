// interactions/hellButtons.js
import { setUserClass } from '../db/hellRepository.js';
import { classRoleIds, classButtonMap, ROLE_SIN_CLASE } from '../config/classRoles.js';
import { markAbsence, joinHell } from '../services/hellService.js';
import { query } from '../db/database.js';
import { getBotVariables } from '../utils/botVariables.js';

export const handleHellButton = async (interaction) => {
  const { customId, user, guild, message } = interaction;
  const member = interaction.member;

  console.log('👉 CLICK:', {
    id: interaction.id,
    diff: Date.now() - interaction.createdTimestamp
  });

  try {
    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch {
        console.warn('⚠️ Interacción expirada antes de defer');
        return;
      }
    }

    setImmediate(async () => {
      try {
        const hellButtonIds = ['hell_join', 'hell_absence'];
        let hellData = null;

        if (hellButtonIds.includes(customId)) {
          const hellRes = await query(
            'SELECT id, status, date, time_slot, channel_id FROM hells WHERE message_id = $1',
            [message.id]
          );

          if (hellRes.rowCount === 0) {
            return safeReply(interaction, '❌ Este Hell ya no existe.');
          }

          hellData = hellRes.rows[0];

          if (hellData.status === 'FINISHED') {
            return safeReply(interaction, '❌ Este Hell ya ha finalizado.');
          }
        }

        // 🔹 CLASES
        if (customId.startsWith('class_')) {
          const chosenClass = classButtonMap[customId];
          if (!chosenClass) return safeReply(interaction, '❌ Clase no válida');

          const guildMember = await guild.members.fetch(user.id);

          const rolesToRemove = guildMember.roles.cache.filter(role =>
            Object.values(classRoleIds).includes(role.id)
          );

          if (rolesToRemove.size > 0) {
            await guildMember.roles.remove(rolesToRemove);
          }

          const newRoleId = classRoleIds[chosenClass];
          if (newRoleId && !guildMember.roles.cache.has(newRoleId)) {
            await guildMember.roles.add(newRoleId);
          }

          if (guildMember.roles.cache.has(ROLE_SIN_CLASE)) {
            await guildMember.roles.remove(ROLE_SIN_CLASE);
          }

          await setUserClass(user.id, chosenClass);

          return safeReply(
            interaction,
            `⚔️ ${member.displayName}, tu clase ahora es **${chosenClass.replace('_', ' ')}**`
          );
        }

        // 🔹 JOIN
        if (customId === 'hell_join') {
          const { date, time_slot: timeSlot, channel_id: channelId } = hellData;

          try {
            await joinHell({
              date,
              timeSlot,
              discordId: user.id,
              channelId,
              client: interaction.client
            });

            return safeReply(
              interaction,
              `⚔️ ${member.displayName}, te has apuntado al Hell.`
            );
          } catch (error) {
            return safeReply(interaction, `❌ ${error.message}`);
          }
        }

        // 🔹 ABSENCE
        if (customId === 'hell_absence') {
          const { id: hellId, date, time_slot: timeSlot, channel_id: channelId } = hellData;

          const res = await query(`
            SELECT id, state, is_replacement
            FROM hell_participants
            WHERE hell_id = $1 AND discord_id = $2
          `, [hellId, user.id]);

          if (res.rowCount === 0) {
            return safeReply(interaction, '❌ No estás apuntado a este Hell.');
          }

          const participant = res.rows[0];

          if (participant.state === 'ABSENCE') {
            return safeReply(interaction, 'ℹ️ Ya estás marcado como absence.');
          }

          await markAbsence(participant.id, interaction.client);

          const now = new Date(
            new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' })
          );

          const [_, hour, minute] = timeSlot.split('_');
          const hellStart = new Date(`${date}T${hour}:${minute}:00`);

          if (now >= hellStart) {
            const botVars = getBotVariables();
            const notifyRoleId = botVars.ROLE_ADMIN;

            const channel = await interaction.client.channels.fetch(channelId);
            if (channel) {
              await channel.send(
                `⚠️ <@&${notifyRoleId}> **${member.displayName}** se ha desapuntado tarde del Hell.`
              );
            }
          }

          return safeReply(
            interaction,
            `❌ ${member.displayName}, te has marcado como **absence**.`
          );
        }

        return safeReply(interaction, '❓ Botón no reconocido');

      } catch (err) {
        console.error('❌ Error interno en lógica async:', err);
        return safeReply(interaction, '❌ Error interno');
      }
    });

  } catch (err) {
    console.error('❌ Error manejando botón:', err);
    return safeReply(interaction, '❌ Error interno');
  }
};

async function safeReply(interaction, content) {
  try {
    if (interaction.deferred) {
      return await interaction.editReply({ content });
    }

    if (!interaction.replied) {
      return await interaction.reply({ content, ephemeral: true });
    }

  } catch (err) {
    console.warn('⚠️ Fallo en safeReply:', err.message);
  }
}