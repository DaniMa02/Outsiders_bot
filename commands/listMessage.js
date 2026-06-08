import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../db/database.js';

export const listMessage = {
  data: new SlashCommandBuilder()
    .setName('list_messages')
    .setDescription('📜 Muestra todos los mensajes programados.'),

  async execute(interaction) {
    const t0 = Date.now();
    console.log(`🔎 [list_messages] inicio por ${interaction.user.tag}`);

    try {
      await interaction.deferReply({ flags: 64 });
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
      const messages = res.rows;

      if (!messages || messages.length === 0) {
        await interaction.editReply('📭 No hay mensajes programados actualmente.');
        console.log(`✅ [list_messages] reply (vacío) enviado en ${Date.now() - t0}ms`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📅 Mensajes programados')
        .setColor('#00AEEF')
        .setDescription('Lista de mensajes actualmente almacenados en la base de datos.')
        .setTimestamp();

      for (const msg of messages) {
        embed.addFields({
          name: `🆔 ID: ${msg.id}`,
          value:
            `**Canal:** <#${msg.channel_id}>\n` +
            `**Hora:** ${msg.send_time}\n` +
            `**Días:** ${msg.days_of_week || 'Todos'}\n` +
            `**Contenido:** ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`,
        });
      }

      console.log(`🔎 [list_messages] intentando editReply con embed...`);
      try {
        await Promise.race([
          interaction.editReply({ embeds: [embed] }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout 5s')), 5000))
        ]);
        console.log(`✅ [list_messages] editReply OK en ${Date.now() - t0}ms`);
      } catch (editErr) {
        console.error(`❌ [list_messages] editReply falló: ${editErr.message}, usando channel.send fallback`);
        try {
          await interaction.channel.send({ embeds: [embed] });
          await interaction.deleteReply().catch(() => {});
          console.log(`✅ [list_messages] fallback channel.send OK en ${Date.now() - t0}ms`);
        } catch (sendErr) {
          console.error(`❌ [list_messages] channel.send también falló:`, sendErr);
        }
      }
    } catch (err) {
      console.error(`❌ [list_messages] error post-query en ${Date.now() - t0}ms:`, err);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply('❌ Error formateando la respuesta.');
        }
      } catch (_) { /* */ }
    }
  },
};
