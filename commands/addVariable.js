import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { loadBotVariables } from '../index.js';

export const addVariable = {
  data: new SlashCommandBuilder()
    .setName('add_variable')
    .setDescription('Añadir o actualizar una variable del bot')
    .addStringOption(option =>
      option.setName('key')
        .setDescription('Nombre de la variable')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('value')
        .setDescription('Valor de la variable')
        .setRequired(true)
    ),

  async execute(interaction) {
    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value');

    try {
      await query(`
        INSERT INTO bot_variables (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [key, value]);

      await loadBotVariables();
      await interaction.reply(`✅ Variable **${key}** guardada con valor **${value}**`);
    } catch (err) {
      console.error('❌ Error en add_variable:', err);
      await interaction.reply('❌ Error al guardar la variable');
    }
  },
};
