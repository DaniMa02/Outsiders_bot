import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { loadScheduledMessages, scheduleAllMessages } from '../index.js';

export const deleteMessage = {
  data: new SlashCommandBuilder()
    .setName('delete_message')
    .setDescription('🗑️ Elimina un mensaje programado por su ID.')
    .addIntegerOption(o =>
      o.setName('id')
        .setDescription('ID del mensaje programado a eliminar.')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // mensaje efímero

    const id = interaction.options.getInteger('id');

    try {
      const result = await query('DELETE FROM scheduled_messages WHERE id = $1 RETURNING *;', [id]);

      if (result.rowCount === 0) {
        return await interaction.editReply(`❌ No se encontró ningún mensaje con ID **${id}**.`);
      }

      await loadScheduledMessages();
      scheduleAllMessages();

      await interaction.editReply(`✅ Mensaje con ID **${id}** eliminado correctamente.`);
    } catch (err) {
      console.error('❌ Error eliminando mensaje:', err);
      await interaction.editReply('❌ Ocurrió un error al eliminar el mensaje programado.');
    }
  },
};
