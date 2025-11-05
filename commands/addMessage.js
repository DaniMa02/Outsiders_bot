import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { loadScheduledMessages, scheduleAllMessages } from '../index.js';

export const addMessage = {
  data: new SlashCommandBuilder()
    .setName('add_message')
    .setDescription('Añade o actualiza un mensaje programado')
    .addIntegerOption(o =>
      o.setName('id')
        .setDescription('ID del mensaje a actualizar (vacío = nuevo)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('content')
        .setDescription('Contenido del mensaje')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('channel_id')
        .setDescription('ID del canal donde se enviará el mensaje')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('send_time')
        .setDescription('Hora HH:MM (24h)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('days_of_week')
        .setDescription('Días separados por coma (0=Domingo)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const id = interaction.options.getInteger('id');
    const content = interaction.options.getString('content');
    const channel_id = interaction.options.getString('channel_id');
    const send_time = interaction.options.getString('send_time');
    const days_of_week = interaction.options.getString('days_of_week');

    try {
      if (id) {
        const fields = [];
        const values = [];
        let i = 1;

        if (content) {
          fields.push(`content = $${i++}`);
          values.push(content);
        }
        if (channel_id) {
          fields.push(`channel_id = $${i++}`);
          values.push(channel_id);
        }
        if (send_time) {
          fields.push(`send_time = $${i++}`);
          values.push(send_time);
        }
        if (days_of_week) {
          fields.push(`days_of_week = $${i++}`);
          values.push(days_of_week);
        }

        if (fields.length === 0) {
          return await interaction.reply('⚠️ No has proporcionado ningún campo para actualizar.');
        }

        values.push(id);
        const queryText = `
          UPDATE scheduled_messages
          SET ${fields.join(', ')}
          WHERE id = $${i}
          RETURNING *;
        `;

        const result = await query(queryText, values);

        if (result.rowCount === 0) {
          return await interaction.reply(`❌ No existe ningún mensaje con ID ${id}.`);
        }

        await loadScheduledMessages();
        scheduleAllMessages();

        return await interaction.reply(`✅ Mensaje con ID ${id} actualizado correctamente.`);
      } else {
        await query(`
          INSERT INTO scheduled_messages (content, channel_id, send_time, days_of_week)
          VALUES ($1, $2, $3, $4);
        `, [content, channel_id, send_time, days_of_week]);

        await loadScheduledMessages();
        scheduleAllMessages();

        return await interaction.reply(`✅ Mensaje programado: "${content}"`);
      }
    } catch (err) {
      console.error('❌ Error en add_message:', err);
      await interaction.reply('❌ Error al programar o actualizar el mensaje');
    }
  },
};
