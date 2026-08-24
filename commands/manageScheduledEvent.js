import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { isValidEventType, getEventConfig } from '../config/eventConfig.js';
import { getBotVariables, getBotVariable } from '../utils/botVariables.js';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DAYS_RE = /^\d+(?:\s*,\s*\d+)*$/;

function validateTime(value) {
  return TIME_RE.test(value || '');
}

function validateDays(value) {
  if (!value) return true;
  const cleaned = value.split(',').map(s => s.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every(num => /^\d$/.test(num) && Number(num) >= 0 && Number(num) <= 6);
}

export const manageScheduledEvent = {
  data: new SlashCommandBuilder()
    .setName('manage_scheduled_event')
    .setDescription('Crear, actualizar o eliminar un evento programado diario')
    .setDefaultMemberPermissions(null)
    .addIntegerOption(option =>
      option
        .setName('id')
        .setDescription('ID del evento programado a editar o eliminar')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('tipo')
        .setDescription('Tipo de evento')
        .setRequired(false)
        .addChoices(
          { name: 'Hell', value: 'hell' },
          { name: 'Hardcore', value: 'hardcore' },
          { name: 'Raid', value: 'raid' }
        )
    )
    .addStringOption(option =>
      option
        .setName('titulo')
        .setDescription('Título del evento programado')
        .setRequired(false)
        .setMinLength(3)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('send_time')
        .setDescription('Hora de disparo del cron (HH:MM). Por defecto 22:00.')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('event_time')
        .setDescription('Hora real del evento dentro del juego (HH:MM).')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('dias')
        .setDescription('Días de la semana: 0=Dom,1=Lun,...,6=Sáb. Ej: 1,2,3,4,5')
        .setRequired(false)
    )
    .addChannelOption(option =>
      option
        .setName('canal')
        .setDescription('Canal donde se enviará el evento programado')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('activo')
        .setDescription('Si está activo o no')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('eliminar')
        .setDescription('Activa esta opción para borrar el evento programado indicado por ID')
        .setRequired(false)
    ),

  execute: async function(interaction) {
    try {
      const adminRoleId = getBotVariable('ROLE_ADMIN');
      const liderGrupoRoleId = getBotVariable('ROLE_LIDER_GRUPO');
      const hasAdminPermission = adminRoleId && interaction.member.roles.cache.has(adminRoleId);
      const hasLiderPermission = liderGrupoRoleId && interaction.member.roles.cache.has(liderGrupoRoleId);

      if (!hasAdminPermission && !hasLiderPermission) {
        return await interaction.reply({ content: '❌ Solo Admin y Líder de Grupo pueden gestionar eventos programados.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const id = interaction.options.getInteger('id');
      const tipo = interaction.options.getString('tipo');
      const titulo = interaction.options.getString('titulo');
      const sendTime = interaction.options.getString('send_time');
      const eventTime = interaction.options.getString('event_time');
      const dias = interaction.options.getString('dias');
      const canal = interaction.options.getChannel('canal');
      const activo = interaction.options.getBoolean('activo');
      const eliminar = interaction.options.getBoolean('eliminar');

      if (eliminar) {
        if (!id) {
          return await interaction.editReply({ content: '❌ Debes indicar un `id` para eliminar un evento programado.' });
        }

        const result = await query('DELETE FROM scheduled_event_templates WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
          return await interaction.editReply({ content: `❌ No existe un evento programado con ID ${id}.` });
        }

        const { loadScheduledEventTemplates, scheduleScheduledEvents } = await import('../index.js');
        await loadScheduledEventTemplates();
        scheduleScheduledEvents();

        return await interaction.editReply({ content: `✅ Evento programado eliminado (ID ${id}).` });
      }

      if (id) {
        const existingRes = await query('SELECT * FROM scheduled_event_templates WHERE id = $1', [id]);
        if (existingRes.rowCount === 0) {
          return await interaction.editReply({ content: `❌ No existe un evento programado con ID ${id}.` });
        }

        const fields = [];
        const values = [];
        let idx = 1;

        if (tipo) {
          if (!isValidEventType(tipo)) {
            return await interaction.editReply({ content: `❌ Tipo de evento no válido: ${tipo}` });
          }
          fields.push(`type = $${idx++}`); values.push(tipo);
        }

        if (titulo) {
          fields.push(`title = $${idx++}`); values.push(titulo);
        }

        if (sendTime) {
          if (!validateTime(sendTime)) {
            return await interaction.editReply({ content: `❌ send_time no válido. Usa formato HH:MM (ej: 22:00).` });
          }
          fields.push(`send_time = $${idx++}`); values.push(sendTime);
        }

        if (eventTime) {
          if (!validateTime(eventTime)) {
            return await interaction.editReply({ content: `❌ event_time no válido. Usa formato HH:MM (ej: 20:00).` });
          }
          fields.push(`event_time = $${idx++}`); values.push(eventTime);
        }

        if (dias) {
          if (!validateDays(dias)) {
            return await interaction.editReply({ content: '❌ Formato de `dias` no válido. Usa valores del 0 al 6 separados por comas.' });
          }
          fields.push(`days_of_week = $${idx++}`); values.push(dias);
        }

        if (canal) {
          fields.push(`channel_id = $${idx++}`); values.push(canal.id);
        }

        if (activo !== null && activo !== undefined) {
          fields.push(`active = $${idx++}`); values.push(activo);
        }

        if (fields.length === 0) {
          return await interaction.editReply({ content: '⚠️ No has indicado ningún campo para actualizar.' });
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        await query(`UPDATE scheduled_event_templates SET ${fields.join(', ')} WHERE id = $${idx}`, values);

        const { loadScheduledEventTemplates, scheduleScheduledEvents } = await import('../index.js');
        await loadScheduledEventTemplates();
        scheduleScheduledEvents();

        return await interaction.editReply({ content: `✅ Evento programado ID ${id} actualizado.` });
      }

      if (!tipo || !titulo) {
        return await interaction.editReply({ content: '❌ Para crear un evento programado debes indicar `tipo` y `titulo`.' });
      }

      if (!isValidEventType(tipo)) {
        return await interaction.editReply({ content: `❌ Tipo de evento no válido: ${tipo}` });
      }

      const finalTrigger = sendTime || '22:00';
      const finalEventTime = eventTime || '22:00';
      if (!validateTime(finalTrigger)) {
        return await interaction.editReply({ content: `❌ send_time no válido. Usa formato HH:MM (ej: 22:00).` });
      }
      if (!validateTime(finalEventTime)) {
        return await interaction.editReply({ content: `❌ event_time no válido. Usa formato HH:MM (ej: 20:00).` });
      }

      if (dias && !validateDays(dias)) {
        return await interaction.editReply({ content: '❌ Formato de `dias` no válido. Usa valores del 0 al 6 separados por comas.' });
      }

      const botVars = getBotVariables();
      const cfg = getEventConfig(tipo);
      const channelId = canal ? canal.id : botVars[cfg.channel_var];
      if (!channelId) {
        return await interaction.editReply({ content: `❌ No hay canal configurado para eventos **${cfg.label}**. Usa el parámetro \`canal\` o configura la variable \`${cfg.channel_var}\`.` });
      }

      const finalDays = dias || '0,1,2,3,4,5,6';
      const eventTemplate = await query(
        `INSERT INTO scheduled_event_templates (type, title, channel_id, send_time, event_time, days_of_week, active, composition, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING *`,
        [tipo, titulo, channelId, finalTrigger, finalEventTime, finalDays, activo !== null && activo !== undefined ? activo : true, 0, interaction.user.id]
      );

      const { loadScheduledEventTemplates, scheduleScheduledEvents } = await import('../index.js');
      await loadScheduledEventTemplates();
      scheduleScheduledEvents();

      return await interaction.editReply({
        content: `✅ Evento programado creado: **${titulo}** (${tipo.toUpperCase()}) en <#${channelId}>. Trigger: ${finalTrigger}. Hora del evento: ${finalEventTime}. Días: ${finalDays}.`
      });
    } catch (err) {
      console.error('❌ Error al gestionar evento programado:', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          return await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
        }
        return await interaction.editReply({ content: `❌ Error: ${err.message}` });
      } catch { /* ignora */ }
    }
  }
};
