// interactions/eventButtons.js
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ActionRowBuilder
} from 'discord.js';
import { query } from '../db/database.js';
import { getUserCapabilities } from '../db/eventRepository.js';
import { canUserFulfillRole } from '../config/eventRoleMapping.js';
import { joinEvent, markEventAbsence } from '../services/eventService.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { getEvent } from '../services/eventManager.js';
import { getBotVariables } from '../utils/botVariables.js';
import { addManualParticipant, changeParticipantRole } from '../services/participantManager.js';
import { EVENT_CONFIG } from '../config/eventConfig.js';
import { ROLE_EMOJIS, ROLE_NAMES } from '../config/eventRoleMapping.js';

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

  // 1️⃣ BOTONES QUE ABREN MODAL: NO se hace deferReply
  // porque showModal debe ser la primera respuesta de la interacción
  if (customId === 'event_manual_add' || customId === 'event_manual_move') {
    try {
      // Verificar permisos antes de buscar el evento
      if (!userCanManageManually(member)) {
        return await interaction.reply({
          content: '❌ Solo Admin y Líder de Grupo pueden usar este botón.',
          ephemeral: true
        });
      }

      let eventData;
      try {
        eventData = await getEventFromMessageId(message.id);
      } catch {
        return await interaction.reply({
          content: '❌ Este evento ya no existe.',
          ephemeral: true
        });
      }

      if (eventData.status === 'FINISHED') {
        return await interaction.reply({
          content: '❌ Este evento ya ha finalizado.',
          ephemeral: true
        });
      }

      if (customId === 'event_manual_add') {
        await handleManualAddButton(interaction, eventData);
      } else {
        await handleManualMoveButton(interaction, eventData);
      }
    } catch (err) {
      console.error('❌ Error en botón manual:', err);
      try {
        if (!interaction.replied) {
          await interaction.reply({ content: '❌ Error interno', ephemeral: true });
        }
      } catch {}
    }
    return;
  }

  // 2️⃣ RESTO DE BOTONES: defer + setImmediate (patrón original)
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

// ==================== HANDLERS DE GESTIÓN MANUAL ====================

/**
 * Comprobar si el miembro puede gestionar participantes manualmente
 */
function userCanManageManually(member) {
  const botVars = getBotVariables();
  const adminRoleId = botVars.ROLE_ADMIN;
  const liderGrupoRoleId = botVars.ROLE_LIDER_GRUPO;

  if (!adminRoleId) return false;

  const hasAdmin = member.roles.cache.has(adminRoleId);
  const hasLider = liderGrupoRoleId && member.roles.cache.has(liderGrupoRoleId);

  return hasAdmin || hasLider;
}

/**
 * Truncar texto para el título de un modal (max 45 chars)
 */
function truncateForModal(text, max = 40) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * Manejar botón "Añadir manual"
 */
async function handleManualAddButton(interaction, eventData) {
  try {
    const config = EVENT_CONFIG[eventData.type];

    const modal = new ModalBuilder()
      .setCustomId(`event_modal_add:${eventData.id}`)
      .setTitle(`Añadir a ${truncateForModal(eventData.title)}`);

    const nameInput = new TextInputBuilder()
      .setCustomId('nombre')
      .setLabel('Nombre del participante')
      .setPlaceholder('Nombre en el juego')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(50);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

    // Si el evento tiene roles, añadir select de rol
    if (config.roles_required) {
      const roleSelect = new StringSelectMenuBuilder()
        .setCustomId('rol')
        .setPlaceholder('Selecciona el rol')
        .setRequired(true)
        .addOptions(
          Object.keys(config.max_roles).map(roleKey => ({
            label: `${ROLE_EMOJIS[roleKey] || '•'} ${ROLE_NAMES[roleKey] || roleKey}`,
            value: roleKey
          }))
        );

      modal.addComponents(new ActionRowBuilder().addComponents(roleSelect));
    }

    await interaction.showModal(modal);

  } catch (err) {
    console.error('❌ Error en handleManualAddButton:', err);
    try {
      if (!interaction.replied) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
    } catch {}
  }
}

/**
 * Manejar botón "Mover rol"
 */
async function handleManualMoveButton(interaction, eventData) {
  try {
    const config = EVENT_CONFIG[eventData.type];

    if (!config.roles_required) {
      return await interaction.reply({ content: '❌ Este evento no tiene roles.', ephemeral: true });
    }

    // Obtener participantes movibles (ACTIVE + RESERVE)
    const res = await query(`
      SELECT ep.id, ep.assigned_role, ep.state, u.nickname
      FROM event_participants ep
      LEFT JOIN users u ON u.discord_id = ep.discord_id
      WHERE ep.event_id = $1 AND ep.state IN ('ACTIVE', 'RESERVE')
      ORDER BY ep.joined_at ASC
    `, [eventData.id]);

    if (res.rowCount === 0) {
      return await interaction.reply({ content: '❌ No hay participantes para mover.', ephemeral: true });
    }

    const participants = res.rows;

    // Discord select: max 25 opciones
    if (participants.length > 25) {
      return await interaction.reply({ content: '❌ Demasiados participantes (>25), no se puede mostrar el selector.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`event_modal_move:${eventData.id}`)
      .setTitle(`Mover rol: ${truncateForModal(eventData.title, 28)}`);

    const participantSelect = new StringSelectMenuBuilder()
      .setCustomId('participante')
      .setPlaceholder('Selecciona participante')
      .setRequired(true)
      .addOptions(
        participants.map(p => ({
          label: truncateForModal(`${p.nickname || 'Sin nombre'} (${(p.assigned_role || 'sin rol').toUpperCase()})`, 100),
          value: String(p.id),
          description: `Estado: ${p.state === 'ACTIVE' ? 'Activo' : 'Reserva'}`
        }))
      );

    modal.addComponents(new ActionRowBuilder().addComponents(participantSelect));

    const roleSelect = new StringSelectMenuBuilder()
      .setCustomId('nuevo_rol')
      .setPlaceholder('Nuevo rol')
      .setRequired(true)
      .addOptions(
        Object.keys(config.max_roles).map(roleKey => ({
          label: `${ROLE_EMOJIS[roleKey] || '•'} ${ROLE_NAMES[roleKey] || roleKey}`,
          value: roleKey
        }))
      );

    modal.addComponents(new ActionRowBuilder().addComponents(roleSelect));

    await interaction.showModal(modal);

  } catch (err) {
    console.error('❌ Error en handleManualMoveButton:', err);
    try {
      if (!interaction.replied) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
    } catch {}
  }
}

// ==================== HANDLER DE SUBMIT DE MODAL ====================

/**
 * Manejar envío de modales de gestión manual
 * customId: event_modal_add:<eventId> o event_modal_move:<eventId>
 */
export const handleEventModalSubmit = async (interaction) => {
  const { customId } = interaction;

  if (!customId.startsWith('event_modal_')) return;

  const parts = customId.split(':');
  if (parts.length !== 2) {
    return safeReplyModal(interaction, '❌ Modal mal formado.');
  }

  const [, action] = parts;
  const eventId = parseInt(parts[1], 10);

  if (isNaN(eventId)) {
    return safeReplyModal(interaction, '❌ ID de evento inválido.');
  }

  // Re-validar permisos (por si el modal fue abierto por alguien sin permisos)
  if (!userCanManageManually(interaction.member)) {
    return safeReplyModal(interaction, '❌ Solo Admin y Líder de Grupo pueden usar este botón.');
  }

  try {
    if (action === 'add') {
      await handleAddModalSubmit(interaction, eventId);
    } else if (action === 'move') {
      await handleMoveModalSubmit(interaction, eventId);
    } else {
      return safeReplyModal(interaction, '❌ Acción desconocida.');
    }
  } catch (err) {
    console.error('❌ Error en modal submit:', err);
    return safeReplyModal(interaction, `❌ ${err.message}`);
  }
};

async function handleAddModalSubmit(interaction, eventId) {
  // Defer para tener tiempo (DB + embed update)
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.fields.getTextInputValue('nombre').trim();
  let role = null;

  try {
    const roleValues = interaction.fields.getStringSelectValues('rol');
    role = roleValues[0];
  } catch {
    // No hay select de rol (Raid) → role queda null
  }

  const participant = await addManualParticipant({ eventId, name, role });

  await createOrUpdateEventEmbed(interaction.client, eventId);

  const stateText = participant.state === 'ACTIVE' ? '✅ ACTIVO' : '📋 RESERVA';
  const roleText = role ? ` como **${role.toUpperCase()}**` : '';

  return await interaction.editReply({
    content: `${stateText} **${name}** añadido al evento${roleText}.`
  });
}

async function handleMoveModalSubmit(interaction, eventId) {
  await interaction.deferReply({ ephemeral: true });

  const participantId = parseInt(interaction.fields.getStringSelectValues('participante')[0], 10);
  const newRole = interaction.fields.getStringSelectValues('nuevo_rol')[0];

  if (isNaN(participantId)) {
    return await interaction.editReply({ content: '❌ Participante inválido.' });
  }

  const updated = await changeParticipantRole({ eventId, participantId, newRole });

  await createOrUpdateEventEmbed(interaction.client, eventId);

  return await interaction.editReply({
    content: `✅ Participante movido a **${newRole.toUpperCase()}**.`
  });
}

async function safeReplyModal(interaction, content) {
  try {
    if (interaction.deferred) {
      return await interaction.editReply({ content });
    }
    if (!interaction.replied) {
      return await interaction.reply({ content, ephemeral: true });
    }
  } catch (err) {
    console.warn('⚠️ Fallo en safeReplyModal:', err.message);
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
