// services/eventEmbedService.js
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { query } from '../db/database.js';
import { getEvent, formatEventInfo } from './eventManager.js';
import { getEventParticipantsSummary } from './eventService.js';
import { EVENT_CONFIG, PARTICIPANT_STATES } from '../config/eventConfig.js';
import { ROLE_EMOJIS, ROLE_NAMES } from '../config/eventRoleMapping.js';
import { getBotVariables } from '../utils/botVariables.js';

/**
 * SERVICIO DE EMBEDS DE EVENTOS
 * Responsable de:
 * - Crear embeds dinámicos según tipo de evento
 * - Renderizar participantes (ACTIVE, RESERVE, ABSENCE)
 * - Agregar botones interactivos (JOIN, ABSENCE, roles)
 */

// ==================== CREAR O ACTUALIZAR EMBED ====================

/**
 * Crear o actualizar embed de evento
 */
export async function createOrUpdateEventEmbed(client, eventId) {
  try {
    // 1️⃣ Obtener evento y sus participantes
    const event = await getEvent(eventId);
    const summary = await getEventParticipantsSummary(eventId);
    const config = EVENT_CONFIG[event.type];

    // 2️⃣ Construir embed según tipo
    let embed;
    if (config.roles_required) {
      embed = buildEmbedWithRoles(event, summary, config);
    } else {
      embed = buildEmbedNoRoles(event, summary, config);
    }

    // 3️⃣ Construir botones
    const buttonRows = buildEventButtons(event, config);

    // 4️⃣ Enviar o editar mensaje
    const channel = await client.channels.fetch(event.channel_id);
    if (!channel) {
      console.warn(`⚠️ Canal no encontrado: ${event.channel_id}`);
      return;
    }

    // El content con mención al rol solo se incluye en envíos NUEVOS,
    // no en edits (para no re-pingear al rol en cada update)
    const notifyContent = buildNotifyContent(config);

    if (event.message_id) {
      try {
        const message = await channel.messages.fetch(event.message_id);
        await message.edit({
          embeds: [embed],
          components: buttonRows
        });
        console.log(`✏️ Embed actualizado para evento ${eventId}`);
      } catch (err) {
        console.warn(`⚠️ No se pudo editar mensaje, enviando nuevo:`, err.message);
        await sendNewEmbedMessage(channel, embed, buttonRows, eventId, notifyContent);
      }
    } else {
      await sendNewEmbedMessage(channel, embed, buttonRows, eventId, notifyContent);
    }
  } catch (err) {
    console.error(`❌ Error al crear/actualizar embed para evento ${eventId}:`, err);
  }
}

/**
 * Construir content con mención al rol de notificación
 * Devuelve null si no hay rol configurado
 */
function buildNotifyContent(config) {
  if (!config || !config.notify_role_var) return null;

  const botVars = getBotVariables();
  const roleId = botVars[config.notify_role_var];
  if (!roleId) return null;

  return `<@&${roleId}>`;
}

/**
 * Enviar nuevo mensaje con embed
 */
async function sendNewEmbedMessage(channel, embed, buttonRows, eventId, content = null) {
  const payload = {
    embeds: [embed],
    components: buttonRows
  };
  if (content) payload.content = content;

  const msg = await channel.send(payload);

  // Guardar message_id en BD
  await query('UPDATE events SET message_id = $1 WHERE id = $2', [msg.id, eventId]);
  console.log(`📤 Nuevo embed enviado para evento ${eventId}, message_id: ${msg.id}`);
}

// ==================== CONSTRUIR EMBED (CON ROLES) ====================

/**
 * Construir embed para evento con roles (Hell, Hardcore)
 */
function buildEmbedWithRoles(event, summary, config) {
  const eventTime = new Date(event.datetime).toLocaleString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });

  const embed = new EmbedBuilder()
    .setTitle(`${config.icon} ${event.title}`)
    .setDescription(`📅 ${eventTime}`)
    .setColor(config.color);

  // Sección ACTIVOS
  const activeText = buildActiveParticipantsWithRoles(summary.active);
  const maxPlayers = config.max_players;
  const activeCount = summary.active.count;

  embed.addFields({
    name: `👥 ACTIVOS (${activeCount}/${maxPlayers})`,
    value: activeText || '_Sin participantes_',
    inline: false
  });

  // Sección RESERVAS
  if (summary.reserve.count > 0) {
    const reserveText = summary.reserve.participants
      .map(p => `• ${p.nickname || `<@${p.discord_id}>`}`)
      .join('\n');

    embed.addFields({
      name: `📋 RESERVAS (${summary.reserve.count})`,
      value: reserveText,
      inline: false
    });
  }

  // Sección AUSENCIAS
  if (summary.absence.count > 0) {
    const absenceText = summary.absence.participants
      .map(p => `• ${p.nickname || `<@${p.discord_id}>`}`)
      .join('\n');

    embed.addFields({
      name: `🚫 ABSENCIAS (${summary.absence.count})`,
      value: absenceText,
      inline: false
    });
  }

  // Footer con info
  embed.setFooter({
    text: `Estado: ${event.status}`
  });

  return embed;
}

/**
 * Construir texto de participantes activos organizados por rol
 */
function buildActiveParticipantsWithRoles(activeSummary) {
  if (activeSummary.count === 0) {
    return '_Sin participantes_';
  }

  const lines = [];

  for (const [role, participants] of Object.entries(activeSummary.byRole)) {
    if (role === 'null' || role === null) continue; // Ignorar nulos

    const emoji = ROLE_EMOJIS[role] || '❓';
    const roleName = ROLE_NAMES[role] || role;

    const names = participants
      .map(p => p.nickname || `<@${p.discord_id}>`)
      .join(', ');

    lines.push(`${emoji} ${roleName}: ${names}`);
  }

  return lines.length > 0 ? lines.join('\n') : '_Sin participantes_';
}

// ==================== CONSTRUIR EMBED (SIN ROLES) ====================

/**
 * Construir embed para evento sin roles (Raid)
 */
function buildEmbedNoRoles(event, summary, config) {
  const eventTime = new Date(event.datetime).toLocaleString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid'
  });

  const embed = new EmbedBuilder()
    .setTitle(`${config.icon} ${event.title}`)
    .setDescription(`📅 ${eventTime}`)
    .setColor(config.color);

  // Sección PARTICIPANTES
  const participantsText = summary.active.participants
    .map((p, idx) => `${idx + 1}. ${p.nickname || `<@${p.discord_id}>`}`)
    .join('\n') || '_Sin participantes_';

  const maxPlayers = config.max_players;
  const activeCount = summary.active.count;

  embed.addFields({
    name: `👥 PARTICIPANTES (${activeCount}${maxPlayers ? `/${maxPlayers}` : ''})`,
    value: participantsText,
    inline: false
  });

  // Sección RESERVAS
  if (summary.reserve.count > 0) {
    const reserveText = summary.reserve.participants
      .map((p, idx) => `${idx + 1}. ${p.nickname || `<@${p.discord_id}>`}`)
      .join('\n');

    embed.addFields({
      name: `📋 RESERVAS (${summary.reserve.count})`,
      value: reserveText,
      inline: false
    });
  }

  // Sección AUSENCIAS
  if (summary.absence.count > 0) {
    const absenceText = summary.absence.participants
      .map(p => `• ${p.nickname || `<@${p.discord_id}>`}`)
      .join('\n');

    embed.addFields({
      name: `🚫 AUSENCIAS (${summary.absence.count})`,
      value: absenceText,
      inline: false
    });
  }

  // Footer
  embed.setFooter({
    text: `Estado: ${event.status}`
  });

  return embed;
}

// ==================== CONSTRUIR BOTONES ====================

/**
 * Construir filas de botones según tipo de evento
 */
function buildEventButtons(event, config) {
  const rows = [];

  // Si evento está FINISHED, mostrar solo info sin botones
  if (event.status === 'FINISHED') {
    const infoRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('event_finished_info')
        .setLabel('Evento Finalizado')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
    rows.push(infoRow);
    return rows;
  }

  if (config.roles_required) {
    // Hell / Hardcore: solo botones de rol + ausencia
    // (el botón JOIN no tiene sentido: para unirse hay que elegir rol)
    const roleButtons = buildRoleButtons(config);
    rows.push(roleButtons);

    const absenceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('event_absence')
        .setLabel('❌ Ausencia')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(absenceRow);
  } else {
    // Raid (sin roles): botón Unirse + Ausencia
    const joinAbsenceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('event_join')
        .setLabel('⚔️ Unirse')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('event_absence')
        .setLabel('❌ Ausencia')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(joinAbsenceRow);
  }

  // Gestión manual (solo usable por Admin/Líder de Grupo, validado en el handler)
  if (config.roles_required) {
    const manualRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('event_manual_add')
        .setLabel('➕ Añadir manual')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('event_manual_move')
        .setLabel('✏️ Mover rol')
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(manualRow);
  } else {
    const manualRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('event_manual_add')
        .setLabel('➕ Añadir manual')
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(manualRow);
  }

  // Cancelar evento (solo usable por el creador, validado en el handler)
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('event_cancel')
      .setLabel('❌ Cancelar evento')
      .setStyle(ButtonStyle.Danger)
  );
  rows.push(cancelRow);

  return rows;
}

/**
 * Construir botones de selección de rol
 */
function buildRoleButtons(config) {
  const row = new ActionRowBuilder();

  for (const roleKey of Object.keys(config.max_roles)) {
    const emoji = ROLE_EMOJIS[roleKey] || '❓';
    const roleName = ROLE_NAMES[roleKey] || roleKey;

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`event_role_${roleKey}`)
        .setLabel(`${emoji} ${roleName}`)
        .setStyle(ButtonStyle.Primary)
    );
  }

  return row;
}

// ==================== UTILIDADES ====================

/**
 * Obtener nickname de usuario desde BD
 */
async function getUserNickname(discordId) {
  const res = await query(
    'SELECT nickname FROM users WHERE discord_id = $1',
    [discordId]
  );

  return res.rows[0]?.nickname || `User ${discordId.slice(-4)}`;
}
