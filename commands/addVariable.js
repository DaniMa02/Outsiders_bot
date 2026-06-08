import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { loadBotVariables, getBotVariables } from '../utils/botVariables.js';
import { eventBus } from '../utils/eventBus.js';

const DISCORD_ID_RE = /^\d{17,20}$/;

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
        .setDescription('Valor de la variable (ID numérico si es CHANNEL/ROLE)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value').trim();

    try {
      const k = key.toUpperCase();
      if ((k.includes('CHANNEL') || k.includes('ROLE') || k.includes('USER')) && !DISCORD_ID_RE.test(value)) {
        return await interaction.reply({
          content: `❌ La variable **${key}** parece un CHANNEL/ROLE/USER pero el valor \`${value}\` no es un ID de Discord válido (debe ser un número de 17-20 dígitos, p.ej. copia el ID con clic derecho sobre el canal/rol).`,
          ephemeral: true
        });
      }

      await query(`
        INSERT INTO bot_variables (key, value) VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [key, value]);

      await loadBotVariables();
      eventBus.emit('botVariableChanged', { key, value });

      await interaction.reply({
        content: `✅ Variable **${key}** guardada con valor **${value}**`,
        ephemeral: true
      });
    } catch (err) {
      console.error('❌ Error en add_variable:', err);
      await interaction.reply({
        content: '❌ Error al guardar la variable',
        ephemeral: true
      });
    }
  },
};
