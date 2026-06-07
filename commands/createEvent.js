// commands/createEvent.js
import { SlashCommandBuilder } from 'discord.js';
import { createEvent as createEventInDB } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { isValidEventType, getEventConfig } from '../config/eventConfig.js';
import { getBotVariables } from '../utils/botVariables.js';

/**
 * COMANDO: /create_event
 * Crear evento (Hell, Hardcore, Raid)
 *
 * Solo Admin y liderdegrupo pueden ejecutar
 *
 * Uso: /create_event tipo:hell titulo:"Hell Team A" fecha:15/08/2026 hora:20:00
 */

export const createEvent = {
  data: new SlashCommandBuilder()
    .setName('create_event')
    .setDescription('Crear un nuevo evento (Hell, Hardcore, Raid)')
    .addStringOption(option =>
      option
        .setName('tipo')
        .setDescription('Tipo de evento')
        .setRequired(true)
        .addChoices(
          { name: 'Hell', value: 'hell' },
          { name: 'Hardcore', value: 'hardcore' },
          { name: 'Raid', value: 'raid' }
        )
    )
    .addStringOption(option =>
      option
        .setName('titulo')
        .setDescription('Título del evento (ej: Hell Team A, Ferumbras Raid)')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('fecha')
        .setDescription('Fecha del evento (DD/MM)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('hora')
        .setDescription('Hora del evento (HH:MM)')
        .setRequired(true)
    ),
  
  execute: async function(interaction) {
  try {
    // 🔹 Validar permisos
    const botVars = getBotVariables();
    const adminRoleId = botVars.ROLE_ADMIN;
    const liderGrupoRoleId = botVars.ROLE_LIDER_GRUPO;

    const hasAdminPermission = interaction.member.roles.cache.has(adminRoleId);
    const hasLiderPermission = liderGrupoRoleId && interaction.member.roles.cache.has(liderGrupoRoleId);

    if (!hasAdminPermission && !hasLiderPermission) {
      return await interaction.reply({
        content: '❌ Solo Admin y Líder de Grupo pueden crear eventos.',
        ephemeral: true
      });
    }

    // 🔹 Defer (puede tardar)
    await interaction.deferReply({ ephemeral: true });

    // 🔹 Obtener parámetros
    const tipo = interaction.options.getString('tipo');
    const titulo = interaction.options.getString('titulo');
    const fechaStr = interaction.options.getString('fecha');
    const horaStr = interaction.options.getString('hora');

    // 🔹 Validar tipo
    if (!isValidEventType(tipo)) {
      return await interaction.editReply({
        content: `❌ Tipo de evento no válido: ${tipo}`
      });
    }

    // 🔹 Parsear fecha y hora
    const { datetime, error: parseError } = parseDateTimeSpain(fechaStr, horaStr);

    if (parseError) {
      return await interaction.editReply({
        content: `❌ ${parseError}`
      });
    }

    // 🔹 Validar que no sea en el pasado
    if (datetime <= new Date()) {
      return await interaction.editReply({
        content: '❌ No puedes crear eventos en el pasado.'
      });
    }

    // 🔹 Obtener canal según tipo de evento
    const eventConfig = getEventConfig(tipo);
    const channelVarName = eventConfig.channel_var;
    const channelId = botVars[channelVarName];

    if (!channelId) {
      return await interaction.editReply({
        content: `❌ Canal para eventos **${eventConfig.label}** no configurado.\n` +
                 `Añade la variable \`${channelVarName}\` con el ID del canal usando \`/add_variable\`.`
      });
    }

    // 🔹 Crear evento
    const event = await createEventInDB({
      type: tipo,
      title: titulo,
      datetime: datetime.toISOString(),
      channelId: channelId,
      createdBy: interaction.user.id,
      client: interaction.client
    });

    // 🔹 Generar y enviar embed
    await createOrUpdateEventEmbed(interaction.client, event.id);

    // 🔹 Responder
    return await interaction.editReply({
      content: `✅ Evento creado: **${titulo}** (${tipo.toUpperCase()})\n` +
               `📅 ${datetime.toLocaleString('es-ES')}`
    });

  } catch (err) {
    console.error('❌ Error en comando createEvent:', err);

    return await interaction.editReply({
      content: `❌ Error: ${err.message}`
    });
  }
}
};

// ==================== HELPERS ====================

/**
 * Determina si una fecha cae en horario de verano (CEST) en Europe/Madrid
 * CEST: último domingo de marzo 01:00 UTC → último domingo de octubre 01:00 UTC
 */
function isMadridDST(date) {
  const year = date.getUTCFullYear();

  const marchLast = new Date(Date.UTC(year, 2, 31));
  const marchLastSunday = 31 - marchLast.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, marchLastSunday, 1, 0, 0));

  const octLast = new Date(Date.UTC(year, 9, 31));
  const octLastSunday = 31 - octLast.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 9, octLastSunday, 1, 0, 0));

  return date >= dstStart && date < dstEnd;
}

/**
 * Parsear fecha (DD/MM) y hora (HH:MM) a datetime Madrid (convertido a UTC)
 * Si la fecha ya pasó este año, se usa el año siguiente
 */
function parseDateTimeSpain(fechaStr, horaStr) {
  // Validar formato fecha (DD/MM)
  const fechaRegex = /^(\d{1,2})\/(\d{1,2})$/;
  const fechaMatch = fechaStr.match(fechaRegex);

  if (!fechaMatch) {
    return {
      datetime: null,
      error: '❌ Formato de fecha incorrecto. Usa: DD/MM'
    };
  }

  const [_, dia, mes] = fechaMatch.map(Number);

  // Validar formato hora
  const horaRegex = /^(\d{1,2}):(\d{2})$/;
  const horaMatch = horaStr.match(horaRegex);

  if (!horaMatch) {
    return {
      datetime: null,
      error: '❌ Formato de hora incorrecto. Usa: HH:MM'
    };
  }

  const [__, hora, minuto] = horaMatch.map(Number);

  // Validar rangos
  if (mes < 1 || mes > 12) {
    return { datetime: null, error: '❌ Mes inválido (1-12)' };
  }

  if (dia < 1 || dia > 31) {
    return { datetime: null, error: '❌ Día inválido (1-31)' };
  }

  if (hora < 0 || hora > 23) {
    return { datetime: null, error: '❌ Hora inválida (0-23)' };
  }

  if (minuto < 0 || minuto > 59) {
    return { datetime: null, error: '❌ Minuto inválido (0-59)' };
  }

  const now = new Date();
  let year = now.getFullYear();

  // Calcular el offset de Madrid en la fecha objetivo
  const tentativeUTC = new Date(Date.UTC(year, mes - 1, dia, hora, minuto, 0));
  const offsetHours = isMadridDST(tentativeUTC) ? 2 : 1;

  // El usuario introduce hora Madrid. Para guardar UTC, restamos el offset
  // (Madrid está X horas por delante de UTC)
  let datetime = new Date(Date.UTC(year, mes - 1, dia, hora - offsetHours, minuto, 0));

  // Si la fecha ya pasó, usar el año siguiente
  if (datetime <= now) {
    const tentativeNext = new Date(Date.UTC(year + 1, mes - 1, dia, hora, minuto, 0));
    const offsetNext = isMadridDST(tentativeNext) ? 2 : 1;
    datetime = new Date(Date.UTC(year + 1, mes - 1, dia, hora - offsetNext, minuto, 0));
  }

  // Verificar que la fecha es válida
  if (isNaN(datetime.getTime())) {
    return { datetime: null, error: '❌ Fecha inválida' };
  }

  return { datetime, error: null };
}
