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
    .setDescription('🔥 Fuerza creación de hells')
    .addStringOption(o =>
      o.setName('date')
        .setDescription('Fecha YYYY-MM-DD')
    )
    .addStringOption(o =>
      o.setName('type')
        .setDescription('Tipo de hell')
        .addChoices(
          { name: 'auto', value: 'auto' },
          { name: 'week', value: 'week' },
          { name: 'weekend', value: 'weekend' }
        )
    )
    .addStringOption(o =>
      o.setName('slot')
        .setDescription('Slot manual (ej: WEEK_16_15)')
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      const botVars = getBotVariables();
      const hellChannelId = botVars.HELL_CHANNEL_ID;

      if (!hellChannelId) {
        return interaction.editReply('❌ HELL_CHANNEL_ID no configurado');
      }

      const inputDate = interaction.options.getString('date');
      const type = interaction.options.getString('type') || 'auto';
      const manualSlot = interaction.options.getString('slot');

      // 📅 Fecha
      let dateStr;
      if (inputDate) {
        dateStr = inputDate;
      } else {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        dateStr = date.toLocaleDateString('en-CA', {
          timeZone: 'Europe/Madrid'
        });
      }

      let slots = [];

      // 🔥 MODO SLOT MANUAL
      if (manualSlot) {
        slots = [manualSlot];
      } else {
        const dateObj = new Date(dateStr);
        const day = dateObj.getDay();

        let schedule = null;

        if (type === 'week') schedule = HELL_SCHEDULE.WEEK;
        else if (type === 'weekend') schedule = HELL_SCHEDULE.WEEKEND;
        else {
          if (HELL_SCHEDULE.WEEK.days.includes(day)) {
            schedule = HELL_SCHEDULE.WEEK;
          } else if (HELL_SCHEDULE.WEEKEND.days.includes(day)) {
            schedule = HELL_SCHEDULE.WEEKEND;
          }
        }

        if (!schedule) {
          return interaction.editReply(`❌ No hay schedule para ${dateStr}`);
        }

        slots = schedule.slots;
      }

      const created = [];

      for (const timeSlot of slots) {
        const hellId = await getOrCreateOpenHell({
          date: dateStr,
          timeSlot,
          channelId: hellChannelId
        });

        await createOrUpdateHellEmbed(interaction.client, hellId);

        created.push(`${dateStr} | ${timeSlot} (ID: ${hellId})`);
      }

      return interaction.editReply(
        `🔥 Hells generados:\n\n${created.join('\n')}`
      );

    } catch (err) {
      console.error('❌ Error en hell_force:', err);
      return interaction.editReply('❌ Error ejecutando comando');
    }
  }
};