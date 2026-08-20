// commands/bulkCreateEvents.js
import { SlashCommandBuilder } from 'discord.js';
import { createEvent as createEventInDB } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { isValidEventType, getEventConfig } from '../config/eventConfig.js';
import { getBotVariables, getBotVariable } from '../utils/botVariables.js';
import { parseDateTimeSpain } from '../utils/dateTime.js';

/**
 * COMANDO: /bulk_create_events
 * Crea varios eventos a la vez para una fecha concreta a las 22:00 (hora fija definida en código).
 * - La lista de eventos a crear y sus plantillas/títulos está definida en el array BULK_EVENTS.
 * - Permisos: Admin o Líder de Grupo
 *
 * Nota: el tiempo está implícito en el código (22:00). Si se quieren otros eventos/plantillas,
 * editar el array BULK_EVENTS más abajo.
 */
export const bulkCreateEvents = {
  data: new SlashCommandBuilder()
    .setName('bulk_create_events')
    .setDescription('Crear varios eventos a las 22:00 para una fecha (editar lista en el código)')
    .setDefaultMemberPermissions(null)
    .addStringOption(option =>
      option
        .setName('fecha')
        .setDescription('Fecha de los eventos (DD/MM)')
        .setRequired(true)
    ),

  execute: async function(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Permisos
      const adminRoleId = getBotVariable('ROLE_ADMIN');
      const liderGrupoRoleId = getBotVariable('ROLE_LIDER_GRUPO');

      const hasAdminPermission = adminRoleId && interaction.member.roles.cache.has(adminRoleId);
      const hasLiderPermission = liderGrupoRoleId && interaction.member.roles.cache.has(liderGrupoRoleId);

      if (!hasAdminPermission && !hasLiderPermission) {
        return await interaction.editReply({ content: '❌ Solo Admin y Líder de Grupo pueden usar este comando.', ephemeral: true });
      }

      const fechaStr = interaction.options.getString('fecha');
      // Hora fija implícita: 22:00
      const horaFija = '22:00';

      const { datetime, error } = parseDateTimeSpain(fechaStr, horaFija);
      if (error) {
        return await interaction.editReply({ content: `❌ ${error}` });
      }

      // EDITAR AQUÍ: lista de eventos a crear y sus títulos/plantillas.
      // Cada entrada debe tener: { type, title, composition }
      // - composition: solo para hardcore (0=A, 1=B). Omitir/null para valores por defecto.
      const BULK_EVENTS = [
        { type: 'hell', title: 'Hell - Plantilla A', composition: null },
        { type: 'hardcore', title: 'Hardcore · A (4 DD)', composition: 0 },
        // Añadir/quitar entradas según convenga
      ];

      const botVars = getBotVariables();

      const created = [];
      for (const item of BULK_EVENTS) {
        if (!isValidEventType(item.type)) {
          console.warn(`Skipping invalid event type in BULK_EVENTS: ${item.type}`);
          continue;
        }

        const config = getEventConfig(item.type);
        // Resolver canal desde variables del bot (config.channel_var)
        const channelVar = config?.channel_var;
        const channelId = channelVar ? getBotVariable(channelVar) : null;

        if (!channelId) {
          console.warn(`No channel configured for event type ${item.type} (expected bot variable ${channelVar}). Skipping.`);
          continue;
        }

        const event = await createEventInDB({
          type: item.type,
          title: item.title,
          datetime: datetime.toISOString(),
          channelId,
          createdBy: interaction.user.id,
          composition: item.type === 'hardcore' ? (item.composition != null ? item.composition : 0) : null
        });

        // Enviar embed al canal correspondiente
        await createOrUpdateEventEmbed(interaction.client, event.id);

        created.push({ id: event.id, type: item.type, title: item.title, channelId });
        // Pequeño delay para no saturar a Discord
        await new Promise(res => setTimeout(res, 500));
      }

      if (created.length === 0) {
        return await interaction.editReply({ content: '⚠️ Ningún evento creado. Revisa la configuración de BULK_EVENTS y las variables de canal del bot.' });
      }

      const summary = created.map(c => `- ${c.type.toUpperCase()}: **${c.title}** en <#${c.channelId}> (id:${c.id})`).join('\n');
      return await interaction.editReply({ content: `✅ Se han creado ${created.length} eventos para el ${fechaStr} a las ${horaFija}:\n${summary}` });

    } catch (err) {
      console.error('❌ Error en comando bulk_create_events:', err);
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
