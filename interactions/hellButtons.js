// listeners/hellButtons.js
import { setUserClass, toggleParticipantAbsence } from '../db/hellRepository.js';
import { classRoleIds, classButtonMap, ROLE_SIN_CLASE } from '../config/classRoles.js';
import { recalcHellAssignments } from '../services/hellService.js';
import { query } from '../db/database.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';
import { getOrCreateOpenHell } from '../services/hellManager.js';
import { getBotVariables } from '../utils/botVariables.js';

export const handleHellButton = async (interaction) => {
  const { customId, user, guild, message } = interaction;
  const member = interaction.member; // 👈 ESTA LÍNEA

  try {
    // ==================================================
    // 🔒 BLOQUEO POR ESTADO DEL HELL (solo join, absence)
    // ==================================================
    const hellButtonIds = ['hell_join', 'hell_absence'];

    let hellData = null;

    if (hellButtonIds.includes(customId) && customId !== 'hell_absence') {
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

      // // if (hellData.status !== 'OPEN') {
      // //   return interaction.reply({
      // //     content: '⛔ Este Hell ya está cerrado.',
      // //     ephemeral: true
      // //   });
      // // }
    } else if (hellButtonIds.includes(customId) && customId === 'hell_absence') {
      // Para absence, igual traemos los datos pero no bloqueamos
      const hellRes = await query(
        'SELECT id, status, channel_id FROM hells WHERE message_id = $1',
        [message.id]
      );

      if (hellRes.rowCount === 0) {
        return interaction.reply({
          content: '❌ Este Hell ya no existe.',
          ephemeral: true
        });
      }

      hellData = hellRes.rows[0];
    }

    // ================================
    // 🔹 Botones de clase (SIN bloqueo)
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
        if (rolesToRemove.size > 0) await guildMember.roles.remove(rolesToRemove);

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
        content: `⚔️ ${member.displayName}, tu clase ahora es **${finalClass.replace('_', ' ')}**`,
        ephemeral: true
      });
    }

    // ====================
// 🔹 Botón Join Hell
// ====================
if (customId === 'hell_join') {
  let { id: hellId, date, time_slot: timeSlot, channel_id: channelId } = hellData;

  // Comprobar si el usuario ya tiene un registro
  const participantRes = await query(`
    SELECT id, state
    FROM hell_participants
    WHERE discord_id = $1 AND hell_id = $2
  `, [user.id, hellId]);

  if (participantRes.rowCount > 0) {
    const participant = participantRes.rows[0];

    if (participant.state === 'ACTIVE') {
      return interaction.reply({
        content: '❌ Ya estás apuntado a este Hell en este horario.',
        ephemeral: true
      });
    }

    // 🔹 Si estaba en ABSENCE → cambiar a ACTIVE SOLO AQUÍ
    await query(`UPDATE hell_participants SET state = 'ACTIVE' WHERE id = $1`, [participant.id]);
    await recalcHellAssignments(hellId);
    await createOrUpdateHellEmbed(interaction.client, hellId);

    return interaction.reply({
      content: `⚔️ ${member.displayName}, te has reapuntado al Hell.`,
      ephemeral: true
    });
  }

  // Comprobar aforo
  const countRes = await query(`
    SELECT COUNT(*)::int AS count
    FROM hell_participants
    WHERE hell_id = $1 AND state = 'ACTIVE'
  `, [hellId]);

  const MAX_PARTICIPANTS = 8;

  if (countRes.rows[0].count >= MAX_PARTICIPANTS) {
    hellId = await getOrCreateOpenHell({ date, timeSlot, channelId });
  }

  // Insertar participante nuevo
  await query(`
    INSERT INTO hell_participants (hell_id, discord_id, state)
    VALUES ($1, $2, 'ACTIVE')
  `, [hellId, user.id]);

  await recalcHellAssignments(hellId);
  await createOrUpdateHellEmbed(interaction.client, hellId);

  return interaction.reply({
    content: `⚔️ ${member.displayName}, te has apuntado al Hell.`,
    ephemeral: true
  });
}


// =====================
// 🔹 Botón Absence
// =====================
if (customId === 'hell_absence') {
  const { id: hellId, status, channel_id: channelId } = hellData;

  // Obtener participante
  const res = await query(`
    SELECT id, state
    FROM hell_participants
    WHERE hell_id = $1 AND discord_id = $2
  `, [hellId, user.id]);

  if (res.rowCount === 0) {
    return interaction.reply({
      content: '❌ No estás apuntado a este Hell.',
      ephemeral: true
    });
  }

  // 🔒 Si ya está en ABSENCE → no reapuntar
  if (res.rows[0].state === 'ABSENCE') {
    return interaction.reply({
      content: 'ℹ️ Ya estás marcado como absence.',
      ephemeral: true
    });
  }

  // 🔹 ACTIVE → ABSENCE (solo en este sentido)
  await query(`
    UPDATE hell_participants
    SET state = 'ABSENCE'
    WHERE id = $1
  `, [res.rows[0].id]);

  await recalcHellAssignments(hellId);
  await createOrUpdateHellEmbed(interaction.client, hellId);

  // 🔔 Aviso de última hora si está CLOSED
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

  return interaction.reply({
    content: `❌ ${member.displayName}, te has marcado como **absence**.`,
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
