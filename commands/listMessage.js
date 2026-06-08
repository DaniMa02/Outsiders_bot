import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';

export const listMessage = {
  data: new SlashCommandBuilder()
    .setName('list_messages')
    .setDescription('📜 Muestra todos los mensajes programados.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      const res = await query('SELECT * FROM scheduled_messages ORDER BY id ASC', [], 8000);
      const messages = res.rows;

      if (!messages || messages.length === 0) {
        return interaction.editReply('📭 No hay mensajes programados actualmente.');
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Mensajes programados')
        .setColor('#00AEEF')
        .setDescription('Lista de mensajes actualmente almacenados en la base de datos.')
        .setTimestamp();

      for (const msg of messages) {
        embed.addFields({
          name: `🆔 ID: ${msg.id}`,
          value:
            `**Canal:** <#${msg.channel_id}>\n` +
            `**Hora:** ${msg.send_time}\n` +
            `**Días:** ${msg.days_of_week || 'Todos'}\n` +
            `**Contenido:** ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('❌ Error list_messages:', err);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply(`❌ Error al obtener los mensajes programados: ${err.message || err}`);
        }
      } catch (innerErr) {
        console.error('❌ No se pudo responder:', innerErr);
      }
    }
  },
};
