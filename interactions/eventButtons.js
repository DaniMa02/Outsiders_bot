// interactions/eventButtons.js
import { query } from '../db/database.js';
import { getUserCapabilities } from '../db/eventRepository.js';
import { canUserFulfillRole } from '../config/eventRoleMapping.js';
import { joinEvent, markEventAbsence } from '../services/eventService.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { getEvent } from '../services/eventManager.js';
import { getBotVariables } from '../utils/botVariables.js';

/**
 * MANEJADOR DE BOTONES DE EVENTOS
 * Responsable de manejar interacciones con botones en embeds de eventos
 * - event_join
 * - event_absence
 * - event_role_* (tank, holy, debuffer, dd, second_lurer)
 */

export const handleEventButton = async (interaction) => {
  const { customId, user, guild, message } = interaction;
  const member = interaction.member;

  console.log('👉 EVENT BUTTON CLICK:', {
    customId,
    userId: user.id,
    timestamp: new Date().toISOString()
  });

  try {
    // 🔹 Defer reply (ephemeral)
    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch {
        console.warn('⚠️ Interacción expirada antes de defer');
        return;
      }
    }

    // Procesar en setImmediate para no bloquear
    setImmediate(async () => {
      try {
        // 1️⃣ Obtener evento desde message_id
        const eventButtonIds = ['event_join', 'event_absence'];
        const isEventButton = eventButtonIds.includes(customId) || customId.startsWith('event_role_');
        let eventData = null;

        if (isEventButton) {
          try {
            eventData = await getEventFromMessageId(message.id);
          } catch (err) {
            return safeReply(interaction, '❌ Este evento ya no existe.');
          }

          if (eventData.status === 'FINISHED') {
            return safeReply(interaction, '❌ Este evento ya ha finalizado.');
          }
        }

        // 2️⃣ BOTONES DE ROL (event_role_tank, event_role_dd, etc)
        if (customId.startsWith('event_role_')) {
          const roleRequired = customId.replace('event_role_', '');
          await handleRoleButton(interaction, eventData, roleRequired, user, member);
          return;
        }

        // 3️⃣ BOTÓN JOIN
        if (customId === 'event_join') {
          await handleJoinButton(interaction, eventData, user, member);
          return;
        }

        // 4️⃣ BOTÓN ABSENCE
        if (customId === 'event_absence') {
          await handleAbsenceButton(interaction, eventData, user, member);
          return;
        }

        // 5️⃣ Botón desconocido
        return safeReply(interaction, '❓ Botón no reconocido');

      } catch (err) {
        console.error('❌ Error interno en lógica async:', err);
        return safeReply(interaction, '❌ Error interno');
      }
    });

  } catch (err) {
    console.error('❌ Error manejando botón de evento:', err);
    return safeReply(interaction, '❌ Error interno');
  }
};

// ==================== HANDLERS POR BOTÓN ====================

/**
 * Manejar botón de selección de rol
 */
async function handleRoleButton(interaction, eventData, roleRequired, user, member) {
  try {
    // 1️⃣ Validar que usuario tiene capability para el rol
    const capabilities = await getUserCapabilities(user.id);
    const canFulfill = canUserFulfillRole(capabilities, roleRequired);

    if (!canFulfill) {
      return safeReply(
        interaction,
        `❌ No cumples requisitos para el rol **${roleRequired.toUpperCase()}**.\n` +
        `Contacta con staff si crees que es un error.`
      );
    }

    // 2️⃣ Apuntar a evento con rol
    const event = await getEvent(eventData.id);
    
    const result = await joinEvent({
      eventId: eventData.id,
      discordId: user.id,
      role: roleRequired,
      client: interaction.client,
      onUpdateEmbed: createOrUpdateEventEmbed
    });

    // 3️⃣ Determinar si es ACTIVE o RESERVE
    const stateText = result.state === 'ACTIVE' ? '✅ ACTIVO' : '📋 RESERVA';

    return safeReply(
      interaction,
      `${stateText} ${member.displayName}, te has apuntado como **${roleRequired.toUpperCase()}** al evento.`
    );

  } catch (error) {
    return safeReply(interaction, `❌ ${error.message}`);
  }
}

/**
 * Manejar botón JOIN
 */
async function handleJoinButton(interaction, eventData, user, member) {
  try {
    const event = await getEvent(eventData.id);

    // Si evento no requiere roles, apuntar directamente (RAID)
    if (event.type === 'raid') {
      const result = await joinEvent({
        eventId: eventData.id,
        discordId: user.id,
        role: null,
        client: interaction.client,
        onUpdateEmbed: createOrUpdateEventEmbed
      });

      const stateText = result.state === 'ACTIVE' ? '✅ ACTIVO' : '📋 RESERVA';

      return safeReply(
        interaction,
        `${stateText} ${member.displayName}, te has apuntado al evento.`
      );
    }

    // Para Hell/Hardcore: requiere seleccionar rol (usar botones)
    return safeReply(
      interaction,
      `⚔️ ${member.displayName}, selecciona un rol usando los botones arriba.`
    );

  } catch (error) {
    return safeReply(interaction, `❌ ${error.message}`);
  }
}

/**
 * Manejar botón ABSENCE
 */
async function handleAbsenceButton(interaction, eventData, user, member) {
  try {
    // 1️⃣ Buscar participante
    const res = await query(`
      SELECT id, state
      FROM event_participants
      WHERE event_id = $1 AND discord_id = $2
    `, [eventData.id, user.id]);

    if (res.rowCount === 0) {
      return safeReply(interaction, '❌ No estás apuntado a este evento.');
    }

    const participant = res.rows[0];

    if (participant.state === 'ABSENCE') {
      return safeReply(interaction, 'ℹ️ Ya estás marcado como absence.');
    }

    // 2️⃣ Marcar como absence
    await markEventAbsence({
      eventId: eventData.id,
      participantId: participant.id,
      discordId: user.id,
      client: interaction.client,
      onUpdateEmbed: createOrUpdateEventEmbed
    });

    // 3️⃣ Notificar si queda menos de 1h para el evento
    const now = new Date();
    const eventTime = new Date(eventData.datetime);
    const oneHourBefore = new Date(eventTime.getTime() - 60 * 60 * 1000);

    if (now >= oneHourBefore) {
      const botVars = getBotVariables();
      const notifyRoleId = botVars.ROLE_ADMIN;

      try {
        const channel = await interaction.client.channels.fetch(eventData.channel_id);
        if (channel) {
          await channel.send(
            `⚠️ <@&${notifyRoleId}> **${member.displayName}** se ha desapuntado con poco margen del evento (menos de 1h para el inicio).`
          );
        }
      } catch (err) {
        console.warn('⚠️ No se pudo notificar:', err.message);
      }
    }

    return safeReply(
      interaction,
      `❌ ${member.displayName}, te has marcado como **absence**.`
    );

  } catch (error) {
    return safeReply(interaction, `❌ ${error.message}`);
  }
}

// ==================== UTILIDADES ====================

/**
 * Obtener evento desde message_id
 */
async function getEventFromMessageId(messageId) {
  const res = await query(
    'SELECT id, type, title, datetime, channel_id, status FROM events WHERE message_id = $1',
    [messageId]
  );

  if (res.rowCount === 0) {
    throw new Error(`Evento no encontrado para mensaje ${messageId}`);
  }

  return res.rows[0];
}

/**
 * Responder de forma segura a la interacción
 */
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
