import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';

export const listScheduledEvents = {
  data: new SlashCommandBuilder()
    .setName('list_scheduled_events')
    .setDescription('📋 Muestra los eventos programados en BD.')
    .setDefaultMemberPermissions(null),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const res = await query(`
        SELECT *
        FROM scheduled_event_templates
        ORDER BY id ASC
      `);

      const templates = res.rows;

      if (!templates || templates.length === 0) {
        return await interaction.editReply('📭 No hay eventos programados activos o inactivos en la base de datos.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🗓️ Eventos programados')
        .setColor('#00AEEF')
        .setDescription('Listado de plantillas de eventos automáticos guardadas en la BD.')
        .setTimestamp();

      for (const item of templates.slice(0, 10)) {
        embed.addFields({
          name: `🆔 ${item.id} · ${item.type.toUpperCase()}`,
          value:
            `**Título:** ${item.title}\n` +
            `**Canal:** <#${item.channel_id}>\n` +
            `**Trigger:** ${item.send_time || '22:00'}\n` +
            `**Evento:** ${item.event_time || '22:00'}\n` +
            `**Días:** ${item.days_of_week || '0,1,2,3,4,5,6'}\n` +
            `**Estado:** ${item.active ? 'Activo' : 'Inactivo'}`
        });
      }

      if (templates.length > 10) {
        embed.setFooter({ text: `Mostrando 10 de ${templates.length} registros.` });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('❌ Error mostrando eventos programados:', err);
      await interaction.editReply('❌ Error al obtener los eventos programados.');
    }
  }
};
