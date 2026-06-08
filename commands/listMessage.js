import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { getBotVariables } from '../utils/botVariables.js';

const DISCORD_ID_RE = /^\d{17,20}$/;

const resolveVars = (text, botVars) => {
  if (!text) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = botVars[key];
    if (!v) return `{{${key}}}`;
    if (DISCORD_ID_RE.test(v)) {
      const k = key.toLowerCase();
      if (k.includes('channel')) return `<#${v}>`;
      if (k.includes('role')) return `<@&${v}>`;
      return `<@${v}>`;
    }
    return v;
  });
};

export const listMessage = {
  data: new SlashCommandBuilder()
    .setName('list_messages')
    .setDescription('Muestra todos los mensajes programados.'),

  async execute(interaction) {
    try {
      const res = await query('SELECT * FROM scheduled_messages ORDER BY id ASC');
      const messages = res.rows;
      const botVars = getBotVariables();

      if (!messages || messages.length === 0) {
        return interaction.reply({ content: 'No hay mensajes programados actualmente.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Mensajes programados')
        .setColor('#00AEEF')
        .setDescription('Lista de mensajes actualmente almacenados en la base de datos.')
        .setTimestamp();

      for (const msg of messages) {
        const resolvedChannel = resolveVars(msg.channel_id, botVars);
        const resolvedContent = resolveVars(msg.content, botVars);
        embed.addFields({
          name: `ID: ${msg.id}`,
          value:
            `**Canal:** ${resolvedChannel}\n` +
            `**Hora:** ${msg.send_time}\n` +
            `**Dias:** ${msg.days_of_week || 'Todos'}\n` +
            `**Contenido:** ${resolvedContent.slice(0, 200)}${resolvedContent.length > 200 ? '...' : ''}`,
        });
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error('Error list_messages:', err);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply('Error al obtener los mensajes programados.');
        } else {
          await interaction.reply({ content: 'Error al obtener los mensajes programados.', ephemeral: true });
        }
      } catch (_) { /* */ }
    }
  },
};
