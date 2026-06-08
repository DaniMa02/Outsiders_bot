import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';

export const listVariable = {
  data: new SlashCommandBuilder()
    .setName('list_variables')
    .setDescription('Muestra todas las variables almacenadas del bot.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const res = await query('SELECT * FROM bot_variables ORDER BY key ASC');
      const variables = res.rows;

      if (!variables || variables.length === 0) {
        return await interaction.editReply('No hay variables almacenadas actualmente.');
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

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error list_variables:', err);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply('Error al obtener las variables del bot.');
        }
      } catch (_) { /* */ }
    }
  },
};
