// commands/createEvent.js
import { SlashCommandBuilder } from 'discord.js';
import { createEvent as createEventInDB } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { isValidEventType, getEventConfig } from '../config/eventConfig.js';
import { getBotVariables } from '../utils/botVariables.js';
import { parseDateTimeSpain } from '../utils/dateTime.js';

/**
 * COMANDO: /create_event
 * Crear evento (Hell, Hardcore, Raid)
 *
 * Solo Admin y líder de grupo pueden ejecutar.
 *
 * Uso: /create_event tipo:hell titulo:"Hell Team A" fecha:15/08 hora:20:00
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
        .setDescription('Fecha del evento (DD/MM, hora Madrid)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('hora')
        .setDescription('Hora del evento (HH:MM, 24h, hora Madrid)')
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
      const config = getEventConfig(tipo);
      const channelVarName = config.channel_var;
      const channelId = botVars[channelVarName];

      if (!channelId) {
        return await interaction.editReply({
          content: `❌ Canal para eventos **${config.label}** no configurado.\n` +
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
                 `📅 ${datetime.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`
      });

    } catch (err) {
      console.error('❌ Error en comando create_event:', err);

      const expired = err?.code === 50027 || err?.message?.includes('Invalid Webhook Token');
      const replied = interaction.replied || interaction.deferred;

      try {
        if (!replied) {
          return await interaction.reply({
            content: expired
              ? '❌ La interacción expiró antes de poder procesarla. Vuelve a intentarlo.'
              : `❌ Error: ${err.message}`,
            ephemeral: true
          });
        }
        return await interaction.editReply({
          content: expired
            ? '❌ La interacción expiró antes de poder procesarla. Vuelve a intentarlo.'
            : `❌ Error: ${err.message}`
        });
      } catch (innerErr) {
        console.error('❌ No se pudo responder al usuario:', innerErr);
        if (interaction.channel && typeof interaction.channel.send === 'function') {
          try {
            await interaction.channel.send({
              content: `<@${interaction.user.id}> ❌ La interacción expiró. Vuelve a intentarlo.`
            });
          } catch (_) { /* nada más que hacer */ }
        }
      }
    }
  }
};
