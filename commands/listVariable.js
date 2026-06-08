import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';

export const listVariable = {
  data: new SlashCommandBuilder()
    .setName('list_variables')
    .setDescription('Muestra todas las variables almacenadas del bot.'),

  async execute(interaction) {
    try {
      const res = await query('SELECT * FROM bot_variables ORDER BY key ASC');
      const variables = res.rows;

      if (!variables || variables.length === 0) {
        return interaction.reply({ content: 'No hay variables almacenadas actualmente.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Variables del bot')
        .setColor('#FFD700')
        .setDescription('Listado de variables actualmente registradas.')
        .setTimestamp();

      for (const variable of variables) {
        embed.addFields({
          name: variable.key,
          value: `**Valor:** ${variable.value}`,
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error('Error list_variables:', err);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply('Error al obtener las variables del bot.');
        } else {
          await interaction.reply({ content: 'Error al obtener las variables del bot.', ephemeral: true });
        }
      } catch (_) { /* */ }
    }
  },
};
