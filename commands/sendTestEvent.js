// commands/sendTestEvent.js
import { SlashCommandBuilder } from 'discord.js';
import { createEvent as createEventInDB } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { isValidEventType, getEventConfig } from '../config/eventConfig.js';
import { getBotVariables, getBotVariable } from '../utils/botVariables.js';
import { parseDateTimeSpain } from '../utils/dateTime.js';

/**
 * COMANDO: /send_test_event
 * Enviar un evento de prueba a un canal especificado por el usuario.
 * - Permisos: Admin o Líder de Grupo
 * - Uso rápido para testing: permite elegir tipo, título, fecha/hora y canal
 */
export const sendTestEvent = {
  data: new SlashCommandBuilder()
    .setName('send_test_event')
    .setDescription('Enviar un evento de prueba a un canal específico')
    .setDefaultMemberPermissions(null)
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
        .setDescription('Título del evento')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('fecha')
        .setDescription('Fecha del evento (DD/MM)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('hora')
        .setDescription('Hora del evento (HH:MM)')
        .setRequired(false)
    )
    .addChannelOption(option =>
      option
        .setName('canal')
        .setDescription('Canal donde enviar el embed de prueba')
        .setRequired(true)
    ),

  execute: async function(interaction) {
    try {
      // Permisos: admin o lider de grupo
      const botVars = getBotVariables();
      const adminRoleId = getBotVariable('ROLE_ADMIN');
      const liderGrupoRoleId = getBotVariable('ROLE_LIDER_GRUPO');

      const hasAdminPermission = adminRoleId && interaction.member.roles.cache.has(adminRoleId);
      const hasLiderPermission = liderGrupoRoleId && interaction.member.roles.cache.has(liderGrupoRoleId);

      if (!hasAdminPermission && !hasLiderPermission) {
        return await interaction.reply({ content: '❌ Solo Admin y Líder de Grupo pueden usar este comando de prueba.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const tipo = interaction.options.getString('tipo');
      const titulo = interaction.options.getString('titulo');
      const fechaStr = interaction.options.getString('fecha');
      const horaStr = interaction.options.getString('hora');
      const channel = interaction.options.getChannel('canal');

      if (!isValidEventType(tipo)) {
        return await interaction.editReply({ content: `❌ Tipo de evento no válido: ${tipo}` });
      }

      // Si no se pasa fecha/hora, usamos ahora + 10 minutos para que el embed se muestre
      let datetime = new Date();
      if (fechaStr && horaStr) {
        const { datetime: parsed, error } = parseDateTimeSpain(fechaStr, horaStr);
        if (error) {
          return await interaction.editReply({ content: `❌ ${error}` });
        }
        datetime = parsed;
      } else {
        datetime = new Date(Date.now() + 10 * 60 * 1000);
      }

      // Crear evento en BD apuntando al canal elegido
      const event = await createEventInDB({
        type: tipo,
        title: titulo,
        datetime: datetime.toISOString(),
        channelId: channel.id,
        createdBy: interaction.user.id,
        composition: tipo === 'hardcore' ? 0 : null
      });

      // Enviar embed al canal especificado
      await createOrUpdateEventEmbed(interaction.client, event.id);

      return await interaction.editReply({ content: `✅ Evento de prueba creado en <#${channel.id}>: **${titulo}** (${tipo.toUpperCase()})` });

    } catch (err) {
      console.error('❌ Error en comando send_test_event:', err);
      try {
        if (!interaction.replied) {
          await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
        } else {
          await interaction.editReply({ content: `❌ Error: ${err.message}` });
        }
      } catch (_) { /* ignore */ }
    }
  }
};
