import { SlashCommandBuilder } from 'discord.js';
import { getOrCreateOpenHell } from '../services/hellManager.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';
import { getBotVariables } from '../utils/botVariables.js';

const HELL_SCHEDULE = {
  WEEK: {
    days: [1, 3, 5],
    slots: ['WEEK_16_15', 'WEEK_20_15']
  },
  WEEKEND: {
    days: [6, 0],
    slots: ['WEEKEND_18_50', 'WEEKEND_22_50']
  }
};

export const hellForce = {
  data: new SlashCommandBuilder()
    .setName('hell_force')
    .setDescription('🔥 Fuerza la creación de hells manualmente (admin)'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      const botVars = getBotVariables();
      const hellChannelId = botVars.HELL_CHANNEL_ID;

      if (!hellChannelId) {
        return interaction.editReply('❌ HELL_CHANNEL_ID no configurado');
      }

      // 📅 Función fecha España
      function getSpainDate(offsetDays = 0) {
        const date = new Date();
        date.setDate(date.getDate() + offsetDays);

        return date.toLocaleDateString('en-CA', {
          timeZone: 'Europe/Madrid'
        });
      }

      const dateStr = getSpainDate(1);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const day = tomorrow.getDay();

      let schedule = null;

      if (HELL_SCHEDULE.WEEK.days.includes(day)) {
        schedule = HELL_SCHEDULE.WEEK;
      } else if (HELL_SCHEDULE.WEEKEND.days.includes(day)) {
        schedule = HELL_SCHEDULE.WEEKEND;
      }

      if (!schedule) {
        return interaction.editReply(`❌ No hay hells para el día ${day}`);
      }

      let created = [];

      for (const timeSlot of schedule.slots) {
        const hellId = await getOrCreateOpenHell({
          date: dateStr,
          timeSlot,
          channelId: hellChannelId
        });

        await createOrUpdateHellEmbed(interaction.client, hellId);

        created.push(`${dateStr} | ${timeSlot} (ID: ${hellId})`);
      }

      return interaction.editReply(
        `🔥 Hells generados correctamente:\n\n${created.join('\n')}`
      );

    } catch (err) {
      console.error('❌ Error en hell_force:', err);
      return interaction.editReply('❌ Error ejecutando hell_force');
    }
  }
};