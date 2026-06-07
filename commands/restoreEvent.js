// commands/restoreEvent.js
import { SlashCommandBuilder } from 'discord.js';
import { getEvent } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { EVENT_CONFIG, EVENT_STATES } from '../config/eventConfig.js';
import { getBotVariables } from '../utils/botVariables.js';
import { getOpenEventsFromCache } from '../utils/eventCache.js';

/**
 * COMANDO: /restore_event
 * Reenvía el embed de un evento OPEN cuyo mensaje fue borrado de Discord.
 * Los datos (participantes, ausencias, reservas) ya están en BD, así que
 * el embed se reconstruye con todo el estado previo intacto.
 *
 * Permisos: Admin y Líder de Grupo.
 *
 * Uso: /restore_event evento:[Hell] Hell Team A — 15/06 20:30
 */

export const restoreEvent = {
  data: new SlashCommandBuilder()
    .setName('restore_event')
    .setDescription('Reenvía el embed de un evento abierto cuyo mensaje fue borrado')
    .addStringOption(opt =>
      opt
        .setName('evento')
        .setDescription('Evento a restaurar')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  execute: async (interaction) => {
    try {
      const botVars = getBotVariables();
      const adminRoleId = botVars.ROLE_ADMIN;
      const liderGrupoRoleId = botVars.ROLE_LIDER_GRUPO;

      const hasAdmin = interaction.member.roles.cache.has(adminRoleId);
      const hasLider = liderGrupoRoleId && interaction.member.roles.cache.has(liderGrupoRoleId);

      if (!hasAdmin && !hasLider) {
        return await interaction.reply({
          content: '❌ Solo Admin y Líder de Grupo pueden restaurar eventos.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const eventId = interaction.options.getString('evento');

      let event;
      try {
        event = await getEvent(eventId);
      } catch {
        return await interaction.editReply({
          content: '❌ Evento no encontrado.'
        });
      }

      if (event.status !== EVENT_STATES.OPEN) {
        return await interaction.editReply({
          content: '❌ Este evento ya ha finalizado, no se puede restaurar.'
        });
      }

      await createOrUpdateEventEmbed(interaction.client, eventId);

      return await interaction.editReply({
        content: `✅ Embed restaurado para **${event.title}** (${event.type.toUpperCase()}).`
      });

    } catch (err) {
      console.error('❌ Error en /restore_event:', err);
      return await interaction.editReply({
        content: `❌ Error: ${err.message}`
      });
    }
  },

  autocomplete: async (interaction) => {
    try {
      const focused = (interaction.options.getFocused() || '').toLowerCase();

      const choices = getOpenEventsFromCache()
        .filter(e => e && e.id != null && e.title && e.datetime && e.type)
        .map(e => {
          const dateStr = new Date(e.datetime).toLocaleString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Madrid'
          });
          const label = EVENT_CONFIG[e.type]?.label || e.type;
          return {
            name: `[${label}] ${e.title} — ${dateStr}`.slice(0, 100),
            value: String(e.id)
          };
        })
        .filter(c => c.name.toLowerCase().includes(focused))
        .slice(0, 25);

      try {
        await interaction.respond(choices);
      } catch (respondErr) {
        console.error('❌ Error al responder autocomplete:', respondErr);
      }
    } catch (err) {
      console.error('❌ Error en autocomplete de restore_event:', err.message, err.stack);
      try {
        await interaction.respond([]);
      } catch {}
    }
  }
};
