import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';

export const hellDelete = {
  data: new SlashCommandBuilder()
    .setName('hell_delete')
    .setDescription('🗑️ Borra hells abiertos')
    .addStringOption(o =>
      o.setName('date')
        .setDescription('Filtrar por fecha YYYY-MM-DD')
    )
    .addIntegerOption(o =>
      o.setName('hell_id')
        .setDescription('ID del hell a borrar')
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      const date = interaction.options.getString('date');
      const hellId = interaction.options.getInteger('hell_id');

      // 🔴 BORRAR UNO
      if (hellId) {
        const res = await query(`
          SELECT * FROM hells WHERE id = $1
        `, [hellId]);

        if (!res.rowCount) {
          return interaction.editReply('❌ Hell no encontrado');
        }

        const hell = res.rows[0];

        // borrar mensaje si existe
        if (hell.message_id) {
          try {
            const channel = await interaction.client.channels.fetch(hell.channel_id);
            if (channel) {
              const msg = await channel.messages.fetch(hell.message_id);
              await msg.delete();
            }
          } catch (err) {
            console.warn('⚠️ No se pudo borrar mensaje:', err.message);
          }
        }

        await query(`DELETE FROM hells WHERE id = $1`, [hellId]);

        return interaction.editReply(`🗑️ Hell ${hellId} eliminado`);
      }

      // 🔴 LISTAR (y posible borrado por fecha)
      let hells;

      if (date) {
        const res = await query(`
          SELECT id, date, time_slot, group_number
          FROM hells
          WHERE status = 'OPEN' AND date = $1
          ORDER BY date, time_slot, group_number
        `, [date]);

        hells = res.rows;
      } else {
        const res = await query(`
          SELECT id, date, time_slot, group_number
          FROM hells
          WHERE status = 'OPEN'
          ORDER BY date, time_slot, group_number
        `);

        hells = res.rows;
      }

      if (!hells.length) {
        return interaction.editReply('❌ No hay hells abiertos');
      }

      // 🧾 Mostrar lista
      const list = hells.map(h =>
        `ID: ${h.id} | ${h.date} | ${h.time_slot} | Grupo ${h.group_number}`
      ).join('\n');

      return interaction.editReply(
        `📋 Hells abiertos:\n\n${list}\n\n👉 Usa /hell_delete hell_id:ID para borrar uno`
      );

    } catch (err) {
      console.error('❌ Error en hell_delete:', err);
      return interaction.editReply('❌ Error ejecutando comando');
    }
  }
};