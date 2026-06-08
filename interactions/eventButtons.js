// interactions/eventButtons.js
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { query } from '../db/database.js';
import { getUserCapabilities } from '../db/eventRepository.js';
import { canUserFulfillRole } from '../config/eventRoleMapping.js';
import { joinEvent, markEventAbsence } from '../services/eventService.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { getEvent } from '../services/eventManager.js';
import { getBotVariables } from '../utils/botVariables.js';
import { addManualParticipant, changeParticipantRole } from '../services/participantManager.js';
import { EVENT_CONFIG, isValidEventType, getEventConfig } from '../config/eventConfig.js';
import { ROLE_EMOJIS, ROLE_NAMES } from '../config/eventRoleMapping.js';
import { setPendingAdd, getPendingAdd, clearPendingAdd, setMoveSelection, getMoveSelection, clearMoveSelection } from '../utils/pendingActions.js';
import { removeEventFromCache } from '../utils/eventCache.js';
import { cancelScheduledReminder, rescheduleReminder } from '../utils/eventReminders.js';
import { parseDateTimeSpain, formatFechaMadrid, formatHoraMadrid } from '../utils/dateTime.js';
import { updateEvent } from '../services/eventManager.js';

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
        const eventButtonIds = ['event_join', 'event_absence', 'event_cancel'];
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

        // 5️⃣ BOTÓN EDITAR (admin/lidergrupo/creador)
        if (customId === 'event_edit') {
          await handleEditButton(interaction, eventData);
          return;
        }

        // 6️⃣ BOTÓN CANCELAR (solo el creador del evento)
        if (customId === 'event_cancel') {
          await handleCancelButton(interaction, eventData, user);
          return;
        }

        // 7️⃣ Botón desconocido
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

/**
 * Manejar botón CANCELAR evento.
 * Solo el creador del evento (event.created_by === user.id) puede cancelarlo.
 * - Marca el evento como FINISHED en la DB (reusa estado, no añade nuevos)
 * - Borra el embed del canal
 * - Envía un mensaje al canal con la mención al rol del tipo de evento
 */
async function handleCancelButton(interaction, eventData, user) {
  try {
    // 1️⃣ Obtener el evento completo (necesitamos created_by y message_id)
    const res = await query(
      'SELECT * FROM events WHERE id = $1',
      [eventData.id]
    );

    if (res.rowCount === 0) {
      return safeReply(interaction, '❌ Evento no encontrado.');
    }

    const fullEvent = res.rows[0];

    // 2️⃣ Verificar que el usuario es el creador
    if (fullEvent.created_by !== user.id) {
      return safeReply(interaction, '❌ Solo el creador del evento puede cancelarlo.');
    }

    // 3️⃣ Marcar como FINISHED en DB y limpiar caché
    await query(
      'UPDATE events SET status = $1, updated_at = NOW() WHERE id = $2',
      ['FINISHED', eventData.id]
    );
    removeEventFromCache(eventData.id);

    // 3.5️⃣ Cancelar el recordatorio programado (si existe)
    cancelScheduledReminder(eventData.id);
    await query(
      'UPDATE event_reminders SET sent = TRUE, sent_at = NOW() WHERE event_id = $1 AND sent = FALSE',
      [eventData.id]
    );

    // 4️⃣ Borrar el embed del canal
    if (fullEvent.message_id && fullEvent.channel_id) {
      try {
        const channel = await interaction.client.channels.fetch(fullEvent.channel_id);
        if (channel) {
          const message = await channel.messages.fetch(fullEvent.message_id);
          await message.delete();
        }
      } catch (err) {
        console.warn(`⚠️ No se pudo eliminar embed del evento cancelado ${eventData.id}:`, err.message);
      }
    }

    // 5️⃣ Enviar mensaje de cancelación al canal con mención al rol del tipo
    const config = EVENT_CONFIG[fullEvent.type];
    const botVars = getBotVariables();
    const roleId = config?.notify_role_var ? botVars[config.notify_role_var] : null;

    const cancelContent = roleId
      ? `❌ **Evento cancelado: ${config?.icon || '•'} ${fullEvent.title}**\n<@&${roleId}>`
      : `❌ **Evento cancelado: ${config?.icon || '•'} ${fullEvent.title}**`;

    try {
      const channel = await interaction.client.channels.fetch(fullEvent.channel_id);
      if (channel) {
        await channel.send({ content: cancelContent });
      }
    } catch (err) {
      console.warn(`⚠️ No se pudo enviar mensaje de cancelación:`, err.message);
    }

    console.log(`❌ Evento ${eventData.id} cancelado por ${user.tag}`);

    return safeReply(interaction, `✅ Evento **${fullEvent.title}** cancelado. Se ha notificado al canal.`);

  } catch (err) {
    console.error('❌ Error en handleCancelButton:', err);
    return safeReply(interaction, `❌ ${err.message}`);
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
 * Comprobar si el miembro puede editar/cancelar un evento:
 * admin, lidergrupo, o el creador del evento
 */
function userCanManageEvent(member, event) {
  const botVars = getBotVariables();
  const adminRoleId = botVars.ROLE_ADMIN;
  const liderGrupoRoleId = botVars.ROLE_LIDER_GRUPO;

  if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;
  if (liderGrupoRoleId && member.roles.cache.has(liderGrupoRoleId)) return true;
  if (event.created_by && event.created_by === member.user.id) return true;
  return false;
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
 * Abre un modal con solo el nombre. El rol (si aplica) se selecciona
 * en un segundo paso mediante un select menu efímero, ya que Discord
 * no permite StringSelectMenu dentro de modales.
 */
async function handleManualAddButton(interaction, eventData) {
  try {
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
 * Muestra un mensaje efímero con 2 selects (participante + nuevo rol)
 * y un botón Confirmar. No se puede hacer en un modal porque los
 * StringSelectMenu no están permitidos dentro de modales en la API
 * actual de Discord.
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

    const participantSelect = new StringSelectMenuBuilder()
      .setCustomId(`event_move_select_participant:${eventData.id}`)
      .setPlaceholder('Selecciona participante')
      .setRequired(true)
      .addOptions(
        participants.map(p => ({
          label: truncateForModal(`${p.nickname || 'Sin nombre'} (${(p.assigned_role || 'sin rol').toUpperCase()})`, 100),
          value: String(p.id),
          description: `Estado: ${p.state === 'ACTIVE' ? 'Activo' : 'Reserva'}`
        }))
      );

    const roleSelect = new StringSelectMenuBuilder()
      .setCustomId(`event_move_select_role:${eventData.id}`)
      .setPlaceholder('Nuevo rol')
      .setRequired(true)
      .addOptions(
        Object.keys(config.max_roles).map(roleKey => ({
          label: `${ROLE_EMOJIS[roleKey] || '•'} ${ROLE_NAMES[roleKey] || roleKey}`,
          value: roleKey
        }))
      );

    const confirmButton = new ButtonBuilder()
      .setCustomId(`event_move_confirm:${eventData.id}`)
      .setLabel('✅ Confirmar')
      .setStyle(ButtonStyle.Success);

    const row1 = new ActionRowBuilder().addComponents(participantSelect);
    const row2 = new ActionRowBuilder().addComponents(roleSelect);
    const row3 = new ActionRowBuilder().addComponents(confirmButton);

    await interaction.reply({
      content: `✏️ **Mover rol** en **${eventData.title}**\nSelecciona el participante y el nuevo rol, luego pulsa Confirmar.`,
      components: [row1, row2, row3],
      ephemeral: true
    });

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
 * customId: event_modal_add:<eventId> | event_modal_move:<eventId>
 */
export const handleEventModalSubmit = async (interaction) => {
  const { customId } = interaction;

  const match = customId.match(/^event_modal_(add|move):(\d+)$/);
  if (!match) {
    return safeReplyModal(interaction, '❌ Modal mal formado.');
  }

  const [, action, eventIdStr] = match;
  const eventId = parseInt(eventIdStr, 10);

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
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.fields.getTextInputValue('nombre').trim();

  if (!name) {
    return await interaction.editReply({ content: '❌ El nombre no puede estar vacío.' });
  }

  // Comprobar tipo de evento
  const event = await getEvent(eventId);
  const config = EVENT_CONFIG[event.type];

  // Si NO requiere roles (Raid), crear directamente
  if (!config.roles_required) {
    const participant = await addManualParticipant({ eventId, name, role: null });
    await createOrUpdateEventEmbed(interaction.client, eventId);

    const stateText = participant.state === 'ACTIVE' ? '✅ ACTIVO' : '📋 RESERVA';
    return await interaction.editReply({
      content: `${stateText} **${name}** añadido al evento.`
    });
  }

  // Si requiere roles (Hell/Hardcore): guardar pendiente y pedir rol via select efímero
  setPendingAdd(interaction.user.id, eventId, name);

  const roleSelect = new StringSelectMenuBuilder()
    .setCustomId(`event_add_role:${eventId}`)
    .setPlaceholder('Selecciona el rol')
    .setRequired(true)
    .addOptions(
      Object.keys(config.max_roles).map(roleKey => ({
        label: `${ROLE_EMOJIS[roleKey] || '•'} ${ROLE_NAMES[roleKey] || roleKey}`,
        value: roleKey
      }))
    );

  return await interaction.editReply({
    content: `✏️ Añadir a **${event.title}** — nombre: **${name}**\nAhora selecciona el rol:`,
    components: [new ActionRowBuilder().addComponents(roleSelect)]
  });
}

async function handleMoveModalSubmit(interaction, eventId) {
  // Esta función ya no se usa (mover rol ahora usa mensaje efímero con selects),
  // pero la dejo como fallback por si se recibe un customId viejo.
  return await safeReplyModal(interaction, '❌ Esta acción ha cambiado. Usa el botón "✏️ Mover rol" del embed.');
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

// ==================== HANDLERS: EDITAR EVENTO ====================

/**
 * Botón "Editar evento" — abre modal con los datos actuales como placeholders.
 * Solo se muestra el modal; el procesamiento ocurre en handleEditModalSubmit.
 */
async function handleEditButton(interaction, eventData) {
  try {
    // Necesitamos el evento completo (con created_by) para validar permisos
    const fullEvent = await query(
      'SELECT * FROM events WHERE id = $1',
      [eventData.id]
    );

    if (fullEvent.rowCount === 0) {
      return safeReply(interaction, '❌ Evento no encontrado.');
    }

    const event = fullEvent.rows[0];

    if (!userCanManageEvent(interaction.member, event)) {
      return safeReply(interaction, '❌ Solo Admin, Líder de Grupo o el creador pueden editar este evento.');
    }

    const fechaActual = formatFechaMadrid(event.datetime);
    const horaActual = formatHoraMadrid(event.datetime);

    const modal = new ModalBuilder()
      .setCustomId(`event_modal_edit:${eventData.id}`)
      .setTitle(`Editar: ${truncateForModal(event.title, 30)}`);

    // El tipo NO se incluye porque Discord no permite selects en modales
    // y normalmente el tipo de evento no se cambia. Si fuera necesario,
    // habría que borrar el evento y crearlo de nuevo.
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Título (vacío = no cambiar)')
          .setPlaceholder(`Actual: ${event.title}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMinLength(3)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('fecha')
          .setLabel('Fecha DD/MM (vacío = no cambiar)')
          .setPlaceholder(`Actual: ${fechaActual}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('hora')
          .setLabel('Hora HH:MM (vacío = no cambiar)')
          .setPlaceholder(`Actual: ${horaActual}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(5)
      )
    );

    await interaction.showModal(modal);

  } catch (err) {
    console.error('❌ Error en handleEditButton:', err);
    try {
      if (!interaction.replied) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
    } catch {}
  }
}

/**
 * Submit del modal de edición.
 * customId: event_modal_edit:<eventId>
 */
export const handleEditModalSubmit = async (interaction) => {
  if (!interaction.customId.startsWith('event_modal_edit:')) return;

  const eventId = parseInt(interaction.customId.split(':')[1], 10);
  if (isNaN(eventId)) {
    return await safeReplyModal(interaction, '❌ ID de evento inválido.');
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Leer campos (vacío = no cambiar)
    const newTitle = interaction.fields.getTextInputValue('title').trim();
    const newFecha = interaction.fields.getTextInputValue('fecha').trim();
    const newHora = interaction.fields.getTextInputValue('hora').trim();

    const newTitleOrUndef = newTitle || undefined;

    // Validar fecha/hora si se proporcionó alguna
    let newDatetime;
    if (newFecha || newHora) {
      // Si solo una de las dos, completamos con la actual
      let fechaStr = newFecha;
      let horaStr = newHora;

      if (!fechaStr || !horaStr) {
        const current = await getEvent(eventId);
        if (!fechaStr) fechaStr = formatFechaMadrid(current.datetime);
        if (!horaStr) horaStr = formatHoraMadrid(current.datetime);
      }

      const { datetime, error } = parseDateTimeSpain(fechaStr, horaStr);
      if (error) {
        return await interaction.editReply({ content: `❌ ${error}` });
      }
      if (datetime <= new Date()) {
        return await interaction.editReply({ content: '❌ La nueva fecha/hora está en el pasado.' });
      }
      newDatetime = datetime;
    }

    // Re-validar permisos (por si el modal se quedó abierto y cambiaron roles)
    const event = await getEvent(eventId);
    if (!userCanManageEvent(interaction.member, event)) {
      return await interaction.editReply({ content: '❌ Sin permisos para editar este evento.' });
    }

    // Actualizar
    const updated = await updateEvent({
      eventId,
      title: newTitleOrUndef,
      datetime: newDatetime
    });

    // Si cambió fecha/hora, reprogramar recordatorio
    if (newDatetime) {
      await rescheduleReminder(interaction.client, eventId, newDatetime);
    }

    // Actualizar embed
    await createOrUpdateEventEmbed(interaction.client, eventId);

    return await interaction.editReply({
      content: `✅ Evento actualizado: **${updated.title}** (${updated.type.toUpperCase()})`
    });

  } catch (err) {
    console.error('❌ Error en handleEditModalSubmit:', err);
    return await interaction.editReply({ content: `❌ ${err.message}` });
  }
};

// ==================== HANDLERS DE SELECTS / CONFIRM (FLUJO NUEVO) ====================

/**
 * Manejar selección de rol en el flujo de "Añadir manual" (2º paso).
 * customId: event_add_role:<eventId>
 */
export const handleAddRoleSelect = async (interaction) => {
  if (!interaction.customId.startsWith('event_add_role:')) return;

  // Validar permisos por si acaso
  if (!userCanManageManually(interaction.member)) {
    return await safeReplySelect(interaction, '❌ Solo Admin y Líder de Grupo pueden usar este botón.');
  }

  const eventId = parseInt(interaction.customId.split(':')[1], 10);
  if (isNaN(eventId)) {
    return await safeReplySelect(interaction, '❌ Evento inválido.');
  }

  const role = interaction.values[0];
  const pending = getPendingAdd(interaction.user.id, eventId);

  if (!pending) {
    return await safeReplySelect(interaction, '❌ La acción ha caducado (5 min). Vuelve a pulsar el botón "Añadir manual".');
  }

  try {
    await interaction.deferUpdate();

    const participant = await addManualParticipant({
      eventId,
      name: pending.name,
      role
    });

    clearPendingAdd(interaction.user.id, eventId);

    await createOrUpdateEventEmbed(interaction.client, eventId);

    const stateText = participant.state === 'ACTIVE' ? '✅ ACTIVO' : '📋 RESERVA';
    await interaction.editReply({
      content: `${stateText} **${pending.name}** añadido como **${role.toUpperCase()}**.`,
      components: []
    });

  } catch (err) {
    console.error('❌ Error en handleAddRoleSelect:', err);
    try {
      await interaction.editReply({ content: `❌ ${err.message}`, components: [] });
    } catch {}
  }
};

/**
 * Manejar selección de participante o rol en el flujo de "Mover rol".
 * Solo almacena en memoria; el procesamiento ocurre al pulsar Confirmar.
 * customId: event_move_select_participant:<eventId> | event_move_select_role:<eventId>
 */
export const handleMoveSelect = async (interaction) => {
  const { customId, values } = interaction;

  if (!customId.startsWith('event_move_select_')) return;

  if (!userCanManageManually(interaction.member)) {
    return await interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
  }

  const parts = customId.split(':');
  if (parts.length !== 2) return;
  const field = parts[0].replace('event_move_select_', ''); // 'participant' o 'role'
  const eventId = parseInt(parts[1], 10);
  if (isNaN(eventId)) return;

  const value = values[0];

  if (field === 'participant') {
    setMoveSelection(interaction.user.id, eventId, { participantId: value });
  } else if (field === 'role') {
    setMoveSelection(interaction.user.id, eventId, { newRole: value });
  }

  // Acknowledge sin modificar el mensaje
  try {
    await interaction.deferUpdate();
  } catch {}
};

/**
 * Manejar botón "Confirmar" del flujo de "Mover rol".
 * Lee los valores almacenados en memoria (selects de Discord no actualizan
 * el mensaje, así que no podemos leerlos del message.components).
 * customId: event_move_confirm:<eventId>
 */
export const handleMoveConfirm = async (interaction) => {
  if (!interaction.customId.startsWith('event_move_confirm:')) return;

  if (!userCanManageManually(interaction.member)) {
    return await safeReplySelect(interaction, '❌ Solo Admin y Líder de Grupo pueden usar este botón.');
  }

  const eventId = parseInt(interaction.customId.split(':')[1], 10);
  if (isNaN(eventId)) {
    return await safeReplySelect(interaction, '❌ Evento inválido.');
  }

  const selection = getMoveSelection(interaction.user.id, eventId);

  if (!selection || !selection.participantId || !selection.newRole) {
    return await safeReplySelect(interaction, '❌ Debes seleccionar participante y nuevo rol antes de confirmar.');
  }

  const participantId = parseInt(selection.participantId, 10);
  if (isNaN(participantId)) {
    return await safeReplySelect(interaction, '❌ Participante inválido.');
  }

  const newRole = selection.newRole;

  try {
    await interaction.deferUpdate();

    await changeParticipantRole({ eventId, participantId, newRole });
    await createOrUpdateEventEmbed(interaction.client, eventId);

    clearMoveSelection(interaction.user.id, eventId);

    await interaction.editReply({
      content: `✅ Participante movido a **${newRole.toUpperCase()}**.`,
      components: []
    });

  } catch (err) {
    console.error('❌ Error en handleMoveConfirm:', err);
    try {
      await interaction.editReply({ content: `❌ ${err.message}`, components: [] });
    } catch {}
  }
};

async function safeReplySelect(interaction, content) {
  try {
    if (interaction.deferred) {
      return await interaction.editReply({ content, components: [] });
    }
    if (!interaction.replied) {
      return await interaction.reply({ content, ephemeral: true });
    }
  } catch (err) {
    console.warn('⚠️ Fallo en safeReplySelect:', err.message);
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
