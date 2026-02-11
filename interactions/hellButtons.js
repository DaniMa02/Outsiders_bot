// listeners/hellButtons.js
import { setUserClass } from '../db/hellRepository.js';
import { classRoleIds, classButtonMap, ROLE_SIN_CLASE } from '../config/classRoles.js';
import { recalcHellAssignments } from '../services/hellService.js';
import { query } from '../db/database.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';
import { getOrCreateOpenHell } from '../services/hellManager.js';
import { getBotVariables } from '../utils/botVariables.js';

export const handleHellButton = async (interaction) => {
  const { customId, user, guild, message } = interaction;
  const member = interaction.member;

  try {

    // 🔥 SOLUCIÓN CLAVE: reconocer interacción inmediatamente
    await interaction.deferReply({ ephemeral: true });

    const hellButtonIds = ['hell_join', 'hell_absence'];
    let hellData = null;

    // ==================================================
    // 🔹 Obtener datos del Hell si es join o absence
    // ==================================================
    if (hellButtonIds.includes(customId)) {

      const hellRes = await query(
        'SELECT id, status, date, time_slot, channel_id FROM hells WHERE message_id = $1',
        [message.id]
      );

      if (hellRes.rowCount === 0) {
        return interaction.editReply({
          content: '❌ Este Hell ya no existe.'
        });
      }

      hellData = hellRes.rows[0];
    }

    // ================================
    // 🔹 Botones de clase
    // ================================
    if (customId.startsWith('class_')) {

      const chosenClass = classButtonMap[customId];

      if (!chosenClass) {
        return interaction.editReply({
          content: '❌ Clase no válida'
        });
      }

      const guildMember = await guild.members.fetch(user.id);
      const finalClass = chosenClass;

      if (guildMember) {
        const rolesToRemove = guildMember.roles.cache.filter(role =>
          Object.values(classRoleIds).includes(role.id)
        );

        if (rolesToRemove.size > 0)
          await guildMember.roles.remove(rolesToRemove);

        const newRoleId = classRoleIds[finalClass];
        if (newRoleId && !guildMember.roles.cache.has(newRoleId)) {
          await guildMember.roles.add(newRoleId);
        }

        if (guildMember.roles.cache.has(ROLE_SIN_CLASE)) {
          await guildMember.roles.remove(ROLE_SIN_CLASE);
        }
      }

      await setUserClass(user.id, finalClass);

      return interaction.editReply({
        content: `⚔️ ${member.displayName}, tu clase ahora es **${finalClass.replace('_', ' ')}**`
      });
    }

    // ====================
    // 🔹 Botón Join Hell
    // ====================
    if (customId === 'hell_join') {

      let { id: hellId, date, time_slot: timeSlot, channel_id: channelId } = hellData;

      const participantRes = await query(`
        SELECT id, state
        FROM hell_participants
        WHERE discord_id = $1 AND hell_id = $2
      `, [user.id, hellId]);

      if (participantRes.rowCount > 0) {
        const participant = participantRes.rows[0];

        if (participant.state === 'ACTIVE') {
          return interaction.editReply({
            content: '❌ Ya estás apuntado a este Hell en este horario.'
          });
        }

        await query(
          `UPDATE hell_participants SET state = 'ACTIVE' WHERE id = $1`,
          [participant.id]
        );

        await recalcHellAssignments(hellId);
        await createOrUpdateHellEmbed(interaction.client, hellId);

        return interaction.editReply({
          content: `⚔️ ${member.displayName}, te has reapuntado al Hell.`
        });
      }

      const countRes = await query(`
        SELECT COUNT(*)::int AS count
        FROM hell_participants
        WHERE hell_id = $1 AND state = 'ACTIVE'
      `, [hellId]);

      const MAX_PARTICIPANTS = 8;

      if (countRes.rows[0].count >= MAX_PARTICIPANTS) {
        hellId = await getOrCreateOpenHell({ date, timeSlot, channelId });
      }

      await query(`
        INSERT INTO hell_participants (hell_id, discord_id, state)
        VALUES ($1, $2, 'ACTIVE')
      `, [hellId, user.id]);

      await recalcHellAssignments(hellId);
      await createOrUpdateHellEmbed(interaction.client, hellId);

      return interaction.editReply({
        content: `⚔️ ${member.displayName}, te has apuntado al Hell.`
      });
    }

    // =====================
    // 🔹 Botón Absence
    // =====================
    if (customId === 'hell_absence') {

      const { id: hellId, status, channel_id: channelId } = hellData;

      const res = await query(`
        SELECT id, state
        FROM hell_participants
        WHERE hell_id = $1 AND discord_id = $2
      `, [hellId, user.id]);

      if (res.rowCount === 0) {
        return interaction.editReply({
          content: '❌ No estás apuntado a este Hell.'
        });
      }

      if (res.rows[0].state === 'ABSENCE') {
        return interaction.editReply({
          content: 'ℹ️ Ya estás marcado como absence.'
        });
      }

      await query(`
        UPDATE hell_participants
        SET state = 'ABSENCE'
        WHERE id = $1
      `, [res.rows[0].id]);

      await recalcHellAssignments(hellId);
      await createOrUpdateHellEmbed(interaction.client, hellId);

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

      return interaction.editReply({
        content: `❌ ${member.displayName}, te has marcado como **absence**.`
      });
    }

    return interaction.editReply({
      content: '❓ Botón no reconocido'
    });

  } catch (err) {
    console.error('❌ Error manejando botón:', err);

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({
        content: '❌ Error interno'
      });
    } else {
      return interaction.reply({
        content: '❌ Error interno',
        ephemeral: true
      });
    }
  }
};