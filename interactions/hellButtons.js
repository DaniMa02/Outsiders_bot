import { setUserClass } from '../db/hellRepository.js';
import { classRoleIds, classButtonMap, ROLE_SIN_CLASE } from '../config/classRoles.js';
import { recalculateRoles, markAbsence, joinHell } from '../services/hellService.js';
import { query } from '../db/database.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';
import { getBotVariables } from '../utils/botVariables.js';

export const handleHellButton = async (interaction) => {
  const { customId, user, guild, message } = interaction;
  const member = interaction.member;

  try {
    // ✅ Defer seguro (evita errores si ya respondió o interacción muerta)
    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (err) {
        console.warn('⚠️ No se pudo hacer defer (posible interacción expirada)');
        return;
      }
    }

    const hellButtonIds = ['hell_join', 'hell_absence'];
    let hellData = null;

    // 🔹 Obtener datos del Hell si es join o absence
    if (hellButtonIds.includes(customId)) {
      const hellRes = await query(
        'SELECT id, status, date, time_slot, channel_id FROM hells WHERE message_id = $1',
        [message.id]
      );

      if (hellRes.rowCount === 0) {
        return safeReply(interaction, '❌ Este Hell ya no existe.');
      }

      hellData = hellRes.rows[0];
    }

    // 🔹 Botones de clase
    if (customId.startsWith('class_')) {
      const chosenClass = classButtonMap[customId];
      if (!chosenClass) {
        return safeReply(interaction, '❌ Clase no válida');
      }

      const guildMember = await guild.members.fetch(user.id);

      if (guildMember) {
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
      }

      await setUserClass(user.id, chosenClass);

      return safeReply(
        interaction,
        `⚔️ ${member.displayName}, tu clase ahora es **${chosenClass.replace('_', ' ')}**`
      );
    }

    // 🔹 Botón Join Hell
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

    // 🔹 Botón Absence
    if (customId === 'hell_absence') {
      const { id: hellId, status, channel_id: channelId } = hellData;

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

      // 🔹 Si es replacement, primero lo devolvemos a su hell original
      if (participant.is_replacement) {
        await query(`
          UPDATE hell_participants
          SET hell_id = original_hell_id,
              slot_number = original_slot,
              is_replacement = false
          WHERE id = $1
        `, [participant.id]);
      }

      // 🔹 Marcar ausencia
      await markAbsence(participant.id, interaction.client);

      // 🔹 Notificación si Hell estaba cerrado
      if (status === 'CLOSED') {
        const botVars = getBotVariables();
        const notifyRoleId = botVars.ROLE_ADMIN;

        const channel = await interaction.client.channels.fetch(channelId);
        if (channel) {
          await channel.send(
            `⚠️ <@&${notifyRoleId}> **${member.displayName}** se ha desapuntado del Hell a última hora.`
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
    console.error('❌ Error manejando botón:', err);
    return safeReply(interaction, '❌ Error interno');
  }
};

/**
 * ✅ Función segura para responder interacciones
 */
async function safeReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply({ content });
    } else {
      return await interaction.reply({ content, ephemeral: true });
    }
  } catch (err) {
    console.warn('⚠️ No se pudo responder a la interacción (probablemente expirada)');
  }
}