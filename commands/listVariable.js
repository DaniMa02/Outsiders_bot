import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';

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
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply(`❌ Error de base de datos: ${err.message || err}`);
        }
      } catch (_) {
        try {
          await interaction.channel.send(`<@${interaction.user.id}> ❌ Error de base de datos: ${err.message || err}`);
        } catch (__) { /* */ }
      }
      return;
    }

    try {
      const variables = res.rows;

      if (!variables || variables.length === 0) {
        await interaction.editReply('❌ No hay variables almacenadas actualmente.');
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

      console.log(`🔎 [list_variables] intentando editReply con embed...`);
      try {
        await Promise.race([
          interaction.editReply({ embeds: [embed] }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout 5s')), 5000))
        ]);
        console.log(`✅ [list_variables] editReply OK en ${Date.now() - t0}ms`);
      } catch (editErr) {
        console.error(`❌ [list_variables] editReply falló: ${editErr.message}, usando channel.send fallback`);
        try {
          await interaction.channel.send({ embeds: [embed] });
          await interaction.deleteReply().catch(() => {});
          console.log(`✅ [list_variables] fallback channel.send OK en ${Date.now() - t0}ms`);
        } catch (sendErr) {
          console.error(`❌ [list_variables] channel.send también falló:`, sendErr);
        }
      }
    } catch (err) {
      console.error(`❌ [list_variables] error post-query en ${Date.now() - t0}ms:`, err);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply('❌ Error formateando la respuesta.');
        }
      } catch (_) { /* */ }
    }
  },
};
