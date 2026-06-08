import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';

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

const safeChannelSend = async (channel, payload, userId, label) => {
  try {
    await Promise.race([
      channel.send(payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout 5s`)), 5000))
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
};

export const listVariable = {
  data: new SlashCommandBuilder()
    .setName('list_variables')
    .setDescription('📋 Muestra todas las variables almacenadas del bot.'),

  async execute(interaction) {
    const t0 = Date.now();
    console.log(`🔎 [list_variables] inicio por ${interaction.user.tag}`);

    try {
      await interaction.deferReply({ flags: 64 });
    } catch (err) {
      console.error('❌ [list_variables] deferReply falló:', err);
      return;
    }

    let res;
    try {
      console.log('🔎 [list_variables] ejecutando query...');
      res = await query('SELECT * FROM bot_variables ORDER BY key ASC', [], 5000);
      console.log(`✅ [list_variables] query OK en ${Date.now() - t0}ms, ${res.rowCount} filas`);
    } catch (err) {
      console.error(`❌ [list_variables] query falló tras ${Date.now() - t0}ms:`, err);
      const e1 = await safeEditReply(interaction, { content: `❌ Error de base de datos: ${err.message || err}`, flags: 64 }, 'editReply(err)');
      if (!e1.ok) {
        await safeChannelSend(interaction.channel, { content: `<@${interaction.user.id}> ❌ Error de base de datos: ${err.message || err}`, flags: 64 }, interaction.user.id, 'channel.send(err)');
      }
      return;
    }

    try {
      const variables = res.rows;

      if (!variables || variables.length === 0) {
        const e1 = await safeEditReply(interaction, { content: '❌ No hay variables almacenadas actualmente.', flags: 64 }, 'editReply(vacío)');
        if (!e1.ok) {
          await safeChannelSend(interaction.channel, { content: '❌ No hay variables almacenadas actualmente.', flags: 64 }, interaction.user.id, 'channel.send(vacío)');
        }
        console.log(`✅ [list_variables] reply vacío en ${Date.now() - t0}ms`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Variables del bot')
        .setColor('#FFD700')
        .setDescription('Listado de variables actualmente registradas.')
        .setTimestamp();

      for (const variable of variables) {
        embed.addFields({
          name: `🆔 ${variable.key}`,
          value: `**Valor:** ${variable.value}`,
        });
      }

      console.log(`🔎 [list_variables] intentando editReply...`);
      const e1 = await safeEditReply(interaction, { embeds: [embed] }, 'editReply');
      if (e1.ok) {
        console.log(`✅ [list_variables] editReply OK en ${Date.now() - t0}ms`);
        return;
      }

      console.error(`❌ [list_variables] editReply falló: ${e1.err.message}, fallback channel.send ephemeral`);
      const s1 = await safeChannelSend(interaction.channel, { embeds: [embed], flags: 64 }, interaction.user.id, 'channel.send');
      if (s1.ok) {
        console.log(`✅ [list_variables] fallback channel.send OK en ${Date.now() - t0}ms`);
        await interaction.deleteReply().catch(() => {});
      } else {
        console.error(`❌ [list_variables] channel.send también falló: ${s1.err.message}`);
      }
    } catch (err) {
      console.error(`❌ [list_variables] error post-query en ${Date.now() - t0}ms:`, err);
      const e1 = await safeEditReply(interaction, { content: '❌ Error formateando la respuesta.', flags: 64 }, 'editReply(err post)');
      if (!e1.ok) {
        await safeChannelSend(interaction.channel, { content: '❌ Error formateando la respuesta.', flags: 64 }, interaction.user.id, 'channel.send(err post)');
      }
    }
  },
};
