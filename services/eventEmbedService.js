// services/eventEmbedService.js
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { query } from '../db/database.js';
import { getEvent, formatEventInfo } from './eventManager.js';
import { getEventParticipantsSummary, getAllEventParticipantsWithPosition } from './eventService.js';
import { EVENT_CONFIG, PARTICIPANT_STATES, getMaxRolesForEvent, getCompositionLabel, getToggleCompositionLabel } from '../config/eventConfig.js';
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
    const allParticipants = await getAllEventParticipantsWithPosition(eventId);
    const config = EVENT_CONFIG[event.type];

    // 1.5️⃣ Rellenar nicknames NULL: defensa para usuarios apuntados antes
    // de que se arreglara la causa raíz. Si nickname es null, fetch desde
    // Discord y, si existe, persistir en BD para no tener que volver a
    // fetchear. Discord.js cachea users, así que el coste es despreciable.
    await fillMissingNicknames(client, summary);

    // Mapa id -> posición (1-based, según joined_at ASC)
    const positionById = new Map();
    for (const p of allParticipants) {
      positionById.set(p.id, p.position);
    }

    // 2️⃣ Construir embed según tipo
    let embed;
    if (config.roles_required) {
      embed = buildEmbedWithRoles(event, summary, config, positionById);
    } else {
      embed = buildEmbedNoRoles(event, summary, config, positionById);
    }

    // 3️⃣ Construir botones
    const buttonRows = buildEventButtons(event, config);

    // 4️⃣ Si el evento tiene composición alternativa, añadirla al footer
    const compLabel = getCompositionLabel(event);
    if (compLabel) {
      const existingFooter = embed.data.footer?.text || '';
      const statusPart = existingFooter.startsWith('Estado:')
        ? existingFooter
        : `Estado: ${event.status}`;
      embed.setFooter({ text: `Composición ${compLabel} · ${statusPart}` });
    }

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
 * Icono de posición: 🥇🥈🥉 para top 3, (X) para el resto
 */
function getPositionIcon(position) {
  if (position === 1) return '🥇';
  if (position === 2) return '🥈';
  if (position === 3) return '🥉';
  return `(${position})`;
}

/**
 * Sufijo 🐐 si el participante es THE GOAT (configurado en GOAT_USER_ID)
 */
function getGoatSuffix(discordId) {
  const botVars = getBotVariables();
  const goatId = botVars.GOAT_USER_ID;
  if (goatId && discordId === goatId) return ' 🐐';
  return '';
}

/**
 * Rellenar nicknames NULL con el displayName actual de Discord.
 *
 * Causa: `addParticipant` solo hace INSERT en `event_participants`, no
 * crea/actualiza la fila en `users`. Para usuarios apuntados antes de
 * que joinEvent recibiera `displayName`, su `users.nickname` es NULL y
 * el render cae al fallback `<@discord_id>` (mención clickeable).
 *
 * Aquí, para cada participante con nickname null, hacemos fetch del user
 * de Discord (cacheado), rellenamos en memoria para el render de esta
 * pasada y, si obtuvimos un nombre, lo persistimos para no repetir.
 */
async function fillMissingNicknames(client, summary) {
  const groups = [summary.active.participants, summary.reserve.participants, summary.absence.participants];
  const toPersist = [];

  for (const list of groups) {
    for (const p of list) {
      if (p.nickname) continue;
      try {
        const user = await client.users.fetch(p.discord_id);
        if (!user) continue;
        const name = user.displayName || user.username;
        if (!name) continue;
        p.nickname = name;
        toPersist.push({ discordId: p.discord_id, nickname: name });
      } catch {
        // Si no se puede fetchear (bot no compartido, user borrado, etc.)
        // dejamos el nickname como null y el render usará la mención.
      }
    }
  }

  if (toPersist.length > 0) {
    try {
      for (const { discordId, nickname } of toPersist) {
        await query(`
          INSERT INTO users (discord_id, nickname)
          VALUES ($1, $2)
          ON CONFLICT (discord_id) DO UPDATE SET nickname = EXCLUDED.nickname
        `, [discordId, nickname]);
      }
      console.log(`🧹 Rellenados ${toPersist.length} nickname(s) NULL desde Discord`);
    } catch (err) {
      console.warn('⚠️ No se pudieron persistir los nicknames rellenados:', err.message);
    }
  }
}

/**
 * Limpia un nickname guardado en BD: quita las '@' iniciales.
 * Discord interpreta un '@' al principio como prefijo de mención y lo
 * renderiza como enlace clickable aunque no apunte a un ID válido.
 * Como algunos displayName de usuarios empiezan por '@' y el bot los
 * guarda tal cual, saneamos aquí para que el embed se vea limpio.
 */
function cleanNickname(nickname) {
  if (!nickname) return null;
  return nickname.replace(/^@+/, '').trim() || null;
}

/**
 * Formatea una línea de participante: nombre + posición + 🐐 (si aplica)
 */
function formatParticipantLine(p, position) {
  const name = cleanNickname(p.nickname) || `<@${p.discord_id}>`;
  const posIcon = getPositionIcon(position);
  const goat = getGoatSuffix(p.discord_id);
  return `${name} ${posIcon}${goat}`;
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
function buildEmbedWithRoles(event, summary, config, positionById) {
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
  const activeText = buildActiveLinesWithRoles(summary.active, positionById);
  const maxPlayers = config.max_players;
  const activeCount = summary.active.count;

  embed.addFields({
    name: `👥 ACTIVOS (${activeCount}/${maxPlayers})`,
    value: activeText || '_Sin participantes_',
    inline: false
  });

  // Sección RESERVAS (con rol)
  if (summary.reserve.count > 0) {
    const reserveText = buildReserveLinesWithRoles(summary.reserve, positionById);

    embed.addFields({
      name: `📋 RESERVAS (${summary.reserve.count})`,
      value: reserveText,
      inline: false
    });
  }

  // Sección AUSENCIAS
  if (summary.absence.count > 0) {
    const absenceText = summary.absence.participants
      .map(p => `• ${cleanNickname(p.nickname) || `<@${p.discord_id}>`}`)
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
 * Construir líneas de activos con roles: una línea por participante
 */
function buildActiveLinesWithRoles(activeSummary, positionById) {
  if (activeSummary.count === 0) return '_Sin participantes_';

  const lines = [];

  for (const [role, participants] of Object.entries(activeSummary.byRole)) {
    if (role === 'null' || role === null) continue;

    const emoji = ROLE_EMOJIS[role] || '❓';
    const roleName = ROLE_NAMES[role] || role;

    for (const p of participants) {
      const position = positionById.get(p.id) || '?';
      const participantLine = formatParticipantLine(p, position);
      lines.push(`${emoji} ${roleName}: ${participantLine}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '_Sin participantes_';
}

/**
 * Construir líneas de reservas con roles: una línea por participante,
 * mostrando el rol con el que se apuntó.
 */
function buildReserveLinesWithRoles(reserveSummary, positionById) {
  if (reserveSummary.count === 0) return null;

  const lines = [];

  for (const p of reserveSummary.participants) {
    const position = positionById.get(p.id) || '?';
    const participantLine = formatParticipantLine(p, position);

    if (p.assigned_role) {
      const emoji = ROLE_EMOJIS[p.assigned_role] || '❓';
      const roleName = ROLE_NAMES[p.assigned_role] || p.assigned_role;
      lines.push(`${emoji} ${roleName}: ${participantLine}`);
    } else {
      lines.push(participantLine);
    }
  }

  return lines.join('\n');
}

// ==================== CONSTRUIR EMBED (SIN ROLES) ====================

/**
 * Construir embed para evento sin roles (Raid)
 */
function buildEmbedNoRoles(event, summary, config, positionById) {
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

  const maxPlayers = config.max_players;
  const activeCount = summary.active.count;

  // Sección PARTICIPANTES
  if (activeCount > 0) {
    const lines = summary.active.participants.map(p => {
      const position = positionById.get(p.id) || '?';
      return formatParticipantLine(p, position);
    });

    embed.addFields({
      name: `👥 PARTICIPANTES (${activeCount}${maxPlayers ? `/${maxPlayers}` : ''})`,
      value: lines.join('\n'),
      inline: false
    });
  } else {
    embed.addFields({
      name: `👥 PARTICIPANTES (0${maxPlayers ? `/${maxPlayers}` : ''})`,
      value: '_Sin participantes_',
      inline: false
    });
  }

  // Sección RESERVAS
  if (summary.reserve.count > 0) {
    const lines = summary.reserve.participants.map(p => {
      const position = positionById.get(p.id) || '?';
      return formatParticipantLine(p, position);
    });

    embed.addFields({
      name: `📋 RESERVAS (${summary.reserve.count})`,
      value: lines.join('\n'),
      inline: false
    });
  }

  // Sección AUSENCIAS
  if (summary.absence.count > 0) {
    const absenceText = summary.absence.participants
      .map(p => `• ${cleanNickname(p.nickname) || `<@${p.discord_id}>`}`)
      .join('\n');

    embed.addFields({
      name: `🚫 AUSENCIAS (${summary.absence.count})`,
      value: absenceText,
      inline: false
    });
  }

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
    const roleButtons = buildRoleButtons(event, config);
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
    const manualRow = new ActionRowBuilder();
    manualRow.addComponents(
      new ButtonBuilder()
        .setCustomId('event_manual_add')
        .setLabel('➕ Añadir manual')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('event_manual_move')
        .setLabel('✏️ Mover rol')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('event_manual_remove')
        .setLabel('🗑️ Eliminar')
        .setStyle(ButtonStyle.Secondary)
    );

    // Hardcore: botón extra para cambiar entre composición A y B
    const toggleLabel = getToggleCompositionLabel(event);
    if (toggleLabel) {
      manualRow.addComponents(
        new ButtonBuilder()
          .setCustomId('event_toggle_composition')
          .setLabel(toggleLabel)
          .setStyle(ButtonStyle.Secondary)
      );
    }

    rows.push(manualRow);
  } else {
    const manualRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('event_manual_add')
        .setLabel('➕ Añadir manual')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('event_manual_remove')
        .setLabel('🗑️ Eliminar')
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(manualRow);
  }

  // Editar y cancelar (admin/lidergrupo/creador, validado en el handler)
  const editCancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('event_edit')
      .setLabel('✏️ Editar')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('event_cancel')
      .setLabel('❌ Cancelar')
      .setStyle(ButtonStyle.Danger)
  );
  rows.push(editCancelRow);

  return rows;
}

/**
 * Construir botones de selección de rol.
 * Respeta la composición elegida para el evento (ej: Hardcore A vs B).
 */
function buildRoleButtons(event, config) {
  const row = new ActionRowBuilder();
  const maxRoles = getMaxRolesForEvent(event);

  for (const roleKey of Object.keys(maxRoles)) {
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

  return cleanNickname(res.rows[0]?.nickname) || `User ${discordId.slice(-4)}`;
}
