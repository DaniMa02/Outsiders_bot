// listeners/hellButtons.js
import { setUserClass, toggleParticipantAbsence } from '../db/hellRepository.js';
import { classRoleIds, classButtonMap, ROLE_SIN_CLASE } from '../config/classRoles.js';
import { recalcHellAssignments } from '../services/hellService.js';
import { query } from '../db/database.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';
import { getOrCreateOpenHell } from '../services/hellManager.js';

export const handleHellButton = async (interaction) => {
  const { customId, user, guild, message } = interaction;

  try {
    // ==================================================
    // 🔍 Obtener Hell si el botón pertenece a un hell
    // ==================================================
    const hellButtonIds = ['hell_join', 'hell_absence'];

    let hellData = null;

    if (hellButtonIds.includes(customId)) {
      const hellRes = await query(
        'SELECT id, status, date, time_slot, channel_id FROM hells WHERE message_id = $1',
        [message.id]
      );

      if (hellRes.rowCount === 0) {
        return interaction.reply({
          content: '❌ Este Hell ya no existe.',
          ephemeral: true
        });
      }

      hellData = hellRes.rows[0];

      // 🔒 BLOQUEO TOTAL si está FINISHED
      if (hellData.status === 'FINISHED') {
        return interaction.reply({
          content: '❌ Este Hell ya ha finalizado.',
          ephemeral: true
        });
      }
    }

    // ================================
    // 🔹 Botones de clase (sin bloqueo)
    // ================================
    if (customId.startsWith('class_')) {
      const chosenClass = classButtonMap[customId];

      if (!chosenClass) {
        return interaction.reply({
          content: '❌ Clase no válida',
          ephemeral: true
        });
      }

      const guildMember = await guild.members.fetch(user.id);
      const finalClass = chosenClass;

      if (guildMember) {
        const rolesToRemove = guildMember.roles.cache.filter(role =>
          Object.values(classRoleIds).includes(role.id)
        );

        if (rolesToRemove.size > 0) {
          await guildMember.roles.remove(rolesToRemove);
        }

        const newRoleId = classRoleIds[finalClass];
        if (newRoleId && !guildMember.roles.cache.has(newRoleId)) {
          await guildMember.roles.add(newRoleId);
        }

        if (guildMember.roles.cache.has(ROLE_SIN_CLASE)) {
          await guildMember.roles.remove(ROLE_SIN_CLASE);
        }
      }

      await setUserClass(user.id, finalClass);

      return interaction.reply({
        content: `⚔️ ${user.username}, tu clase ahora es **${finalClass.replace('_', ' ')}**`,
        ephemeral: true
      });
    }

    // ====================
    // 🔹 Botón Join Hell
    // ====================
    if (customId === 'hell_join') {
      // 🔒 BLOQUEO SOLO AQUÍ si no está OPEN
      if (hellData.status !== 'OPEN') {
        return interaction.reply({
          content: '⛔ Este Hell ya está cerrado, no puedes apuntarte.',
          ephemeral: true
        });
      }

      let { id: hellId, date, time_slot: timeSlot, channel_id: channelId } = hellData;

      const alreadyJoinedRes = await query(`
        SELECT hp.id
        FROM hell_participants hp
        JOIN hells h ON h.id = hp.hell_id
        WHERE hp.discord_id = $1
          AND h.date = $2
          AND h.time_slot = $3
          AND hp.state = 'ACTIVE'
      `, [user.id, date, timeSlot]);

      if (alreadyJoinedRes.rowCount > 0) {
        return interaction.reply({
          content: '❌ Ya estás apuntado a este Hell en este horario.',
          ephemeral: true
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

      return interaction.reply({
        content: `⚔️ ${user.username}, te has apuntado al Hell.`,
        ephemeral: true
      });
    }

    // =====================
    // 🔹 Botón Absence
    // =====================
    if (customId === 'hell_absence') {
      const hellId = hellData.id;

      await toggleParticipantAbsence(hellId, user.id);
      await recalcHellAssignments(hellId);
      await createOrUpdateHellEmbed(interaction.client, hellId);

      return interaction.reply({
        content: `❌ ${user.username}, tu estado de **absence** ha sido actualizado`,
        ephemeral: true
      });
    }

    // =====================
    // ❓ Botón desconocido
    // =====================
    return interaction.reply({
      content: '❓ Botón no reconocido',
      ephemeral: true
    });

  } catch (err) {
    console.error('❌ Error manejando botón:', err);
    if (!interaction.replied) {
      return interaction.reply({
        content: '❌ Error interno',
        ephemeral: true
      });
    }
  }
};
