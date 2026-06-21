// commands/restoreEvent.js
import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { getEvent } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';
import { EVENT_CONFIG, EVENT_STATES } from '../config/eventConfig.js';
import { getBotVariables } from '../utils/botVariables.js';
import { addEventToCache, getOpenEventsFromCache, getRecentFinishedEventsFromCache } from '../utils/eventCache.js';
import { restoreReminders } from '../utils/eventReminders.js';

/**
 * COMANDO: /restore_event
 *
 * Reenvía el embed de un evento OPEN cuyo mensaje fue borrado de Discord.
 * Los datos (participantes, ausencias, reservas) ya están en BD, así que
 * el embed se reconstruye con todo el estado previo intacto.
 *
 * Además, si el evento está FINISHED (p. ej. cancelado por error con el
 * botón ❌ Cancelar), lo reactiva: status → OPEN, recordatorios reprogramados,
 * caché actualizado y embed regenerado con los participantes que seguían
 * apuntados.
 *
 * Permisos: Admin y Líder de Grupo.
 *
 * Uso: /restore_event evento:[Hell] Hell Team A — 15/06 20:30
 */
export const restoreEvent = {
  data: new SlashCommandBuilder()
    .setName('restore_event')
    .setDescription('Reenvía/regenera el embed de un evento. Reactiva eventos cancelados por error.')
    .addStringOption(opt =>
      opt
        .setName('evento')
        .setDescription('Evento a restaurar (incluye cancelados recientemente)')
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

      const wasFinished = event.status === EVENT_STATES.FINISHED;
      const wasOpen = event.status === EVENT_STATES.OPEN;

      if (!wasOpen && !wasFinished) {
        return await interaction.editReply({
          content: `❌ Estado de evento no soportado para restaurar: ${event.status}.`
        });
      }

      // 1️⃣ Si el evento estaba FINISHED (cancelado por error), reactivarlo a OPEN
      if (wasFinished) {
        await query(
          'UPDATE events SET status = $1, updated_at = NOW() WHERE id = $2',
          [EVENT_STATES.OPEN, eventId]
        );
        event.status = EVENT_STATES.OPEN;
        console.log(`♻️ Evento ${eventId} reactivado: FINISHED → OPEN`);
      }

      // 2️⃣ Añadir/actualizar en caché de eventos OPEN (para autocomplete y botón cancelar)
      addEventToCache({ ...event, status: EVENT_STATES.OPEN });

      // 3️⃣ Si veníamos de FINISHED, restaurar recordatorios (canal + DM)
      if (wasFinished) {
        await restoreReminders(interaction.client, eventId);
      }

      // 4️⃣ Regenerar embed.
      // Si message_id apunta a un mensaje borrado en Discord, createOrUpdateEventEmbed
      // lo detecta y crea uno nuevo automáticamente.
      await createOrUpdateEventEmbed(interaction.client, eventId);

      return await interaction.editReply({
        content: wasFinished
          ? `♻️ Evento **${event.title}** (${event.type.toUpperCase()}) reactivado.\n` +
            `Estado: **OPEN** · Recordatorios reprogramados · Embed regenerado con los participantes que ya estaban apuntados.`
          : `✅ Embed restaurado para **${event.title}** (${event.type.toUpperCase()}).`
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

      // 1️⃣ Eventos OPEN (desde caché en memoria, rápido)
      const openChoices = getOpenEventsFromCache()
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
        });

      // 2️⃣ Eventos FINISHED recientes (cache en memoria, últimas 24h)
      // La misma solución que se aplicó en su día para los OPEN: el
      // autocomplete no debe hacer query a la DB en cada keystroke
      // (puede fallar por timeout de la Neon DB o de Discord).
      const finishedChoices = getRecentFinishedEventsFromCache()
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
            name: `⛔ [${label}] ${e.title} — ${dateStr} (cancelado)`.slice(0, 100),
            value: String(e.id)
          };
        });

      // Combinar, filtrar y limitar a 25 (límite de Discord)
      const allChoices = [...openChoices, ...finishedChoices]
        .filter(c => c.name.toLowerCase().includes(focused))
        .slice(0, 25);

      try {
        await interaction.respond(allChoices);
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
