// commands/restoreEvent.js
import { SlashCommandBuilder } from 'discord.js';
import { getEvent } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { query } from '../db/database.js';
import { EVENT_CONFIG, EVENT_STATES } from '../config/eventConfig.js';
import { getBotVariables } from '../utils/botVariables.js';

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
      const focused = interaction.options.getFocused() || '';

      const res = await query(
        `SELECT id, type, title, datetime
         FROM events
         WHERE status = 'OPEN'
         ORDER BY datetime ASC
         LIMIT 25`
      );

      const choices = res.rows.map(e => {
        const dateStr = new Date(e.datetime).toLocaleString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Madrid'
        });
        const label = EVENT_CONFIG[e.type]?.label || e.type;
        return {
          name: `[${label}] ${e.title} — ${dateStr}`,
          value: String(e.id)
        };
      });

      const filtered = choices.filter(c =>
        c.name.toLowerCase().includes(focused.toLowerCase())
      );

      await interaction.respond(filtered.slice(0, 25));
    } catch (err) {
      console.error('❌ Error en autocomplete de restore_event:', err);
      await interaction.respond([]);
    }
  }
};
