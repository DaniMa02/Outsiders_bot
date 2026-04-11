import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { loadBotVariables, getBotVariables } from '../utils/botVariables.js'; // ✅ Import desde utils
import { eventBus } from '../utils/eventBus.js';

export const deleteVariable = {
  data: new SlashCommandBuilder()
    .setName('delete_variable')
    .setDescription('🗑️ Elimina una variable almacenada del bot.')
    .addStringOption(o =>
      o.setName('key')
        .setDescription('Nombre (clave) de la variable a eliminar.')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // mensaje efímero

    const key = interaction.options.getString('key');

    try {
      const result = await query(
        'DELETE FROM bot_variables WHERE key = $1 RETURNING *;',
        [key]
      );

      if (result.rowCount === 0) {
        return await interaction.editReply(`❌ No existe ninguna variable con la clave **${key}**.`);
      }

      // 🔄 Recargar caché de variables después de eliminar
      await loadBotVariables();

      eventBus.emit('botVariableChanged', { key, value: null });
      const botVars = getBotVariables(); // Opcional: usar si necesitas comprobar algo

      await interaction.editReply(`✅ Variable **${key}** eliminada correctamente.`);
    } catch (err) {
      console.error('❌ Error eliminando variable:', err);
      await interaction.editReply('❌ Ocurrió un error al eliminar la variable.');
    }
  },
};
