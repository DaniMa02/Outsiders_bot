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
      if (key.toLowerCase().includes('channel')) return `<#${v}>`;
      if (key.toLowerCase().includes('role')) return `<@&${v}>`;
      return `<@${v}>`;
    }
    return v;
  });
};

const safeEditReply = async (interaction, payload, label) => {
  try {
    await Promise.race([
      interaction.editReply(payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout 5s`)), 5000))
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
};

const safeFollowUp = async (interaction, payload, label) => {
  try {
    await Promise.race([
      interaction.followUp(payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout 5s`)), 5000))
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
};

export const listMessage = {
  data: new SlashCommandBuilder()
    .setName('list_messages')
    .setDescription('📜 Muestra todos los mensajes programados.'),

  async execute(interaction) {
    const t0 = Date.now();
    console.log(`🔎 [list_messages] inicio por ${interaction.user.tag}`);

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error('❌ [list_messages] deferReply falló:', err);
      return;
    }

    let res;
    try {
      console.log('🔎 [list_messages] ejecutando query...');
      res = await query('SELECT * FROM scheduled_messages ORDER BY id ASC', [], 5000);
      console.log(`✅ [list_messages] query OK en ${Date.now() - t0}ms, ${res.rowCount} filas`);
    } catch (err) {
      console.error(`❌ [list_messages] query falló tras ${Date.now() - t0}ms:`, err);
      const e1 = await safeEditReply(interaction, { content: `❌ Error de base de datos: ${err.message || err}` }, 'editReply(err)');
      if (!e1.ok) {
        await safeFollowUp(interaction, { content: `❌ Error de base de datos: ${err.message || err}`, ephemeral: true }, 'followUp(err)');
      }
      return;
    }

    try {
      const messages = res.rows;
      const botVars = getBotVariables();

      if (!messages || messages.length === 0) {
        const e1 = await safeEditReply(interaction, { content: '📭 No hay mensajes programados actualmente.' }, 'editReply(vacío)');
        if (!e1.ok) {
          await safeFollowUp(interaction, { content: '📭 No hay mensajes programados actualmente.', ephemeral: true }, 'followUp(vacío)');
        }
        console.log(`✅ [list_messages] reply vacío en ${Date.now() - t0}ms`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Mensajes programados')
        .setColor('#00AEEF')
        .setDescription('Lista de mensajes actualmente almacenados en la base de datos.')
        .setTimestamp();

      for (const msg of messages) {
        const resolvedChannel = resolveVars(msg.channel_id, botVars);
        const resolvedContent = resolveVars(msg.content, botVars);
        embed.addFields({
          name: `🆔 ID: ${msg.id}`,
          value:
            `**Canal:** ${resolvedChannel}\n` +
            `**Hora:** ${msg.send_time}\n` +
            `**Días:** ${msg.days_of_week || 'Todos'}\n` +
            `**Contenido:** ${resolvedContent.slice(0, 200)}${resolvedContent.length > 200 ? '...' : ''}`,
        });
      }

      console.log(`🔎 [list_messages] intentando editReply...`);
      const e1 = await safeEditReply(interaction, { embeds: [embed] }, 'editReply');
      if (e1.ok) {
        console.log(`✅ [list_messages] editReply OK en ${Date.now() - t0}ms`);
        return;
      }

      console.error(`❌ [list_messages] editReply falló: ${e1.err.message}, fallback followUp ephemeral`);
      const f1 = await safeFollowUp(interaction, { embeds: [embed], ephemeral: true }, 'followUp');
      if (f1.ok) {
        console.log(`✅ [list_messages] fallback followUp OK en ${Date.now() - t0}ms`);
        await interaction.deleteReply().catch(() => {});
      } else {
        console.error(`❌ [list_messages] followUp también falló: ${f1.err.message}`);
      }
    } catch (err) {
      console.error(`❌ [list_messages] error post-query en ${Date.now() - t0}ms:`, err);
      const e1 = await safeEditReply(interaction, { content: '❌ Error formateando la respuesta.' }, 'editReply(err post)');
      if (!e1.ok) {
        await safeFollowUp(interaction, { content: '❌ Error formateando la respuesta.', ephemeral: true }, 'followUp(err post)');
      }
    }
  },
};
