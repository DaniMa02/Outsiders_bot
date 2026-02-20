// schedulers/hellScheduler.js
import cron from 'node-cron';
import { getOrCreateOpenHell } from '../services/hellManager.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';
import { getBotVariables } from '../utils/botVariables.js';

const HELL_SCHEDULE = {
  WEEK: {
    days: [1, 3, 5], // lunes, miércoles, viernes
    slots: ['WEEK_16_15', 'WEEK_20_15']
  },
  WEEKEND: {
    days: [6, 0], // sábado, domingo
    slots: ['WEEKEND_18_50', 'WEEKEND_22_50']
  }
};

export const startHellScheduler = (client) => {
  cron.schedule(
    '55 21 * * *',
    async () => {
      try {
        const botVars = getBotVariables();
        const hellChannelId = botVars.HELL_CHANNEL_ID;

        if (!hellChannelId) {
          console.warn('⚠️ HELL_CHANNEL no definido');
          return;
        }

        // 📅 mañana
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateStr = tomorrow.toISOString().split('T')[0];
        const day = tomorrow.getDay();
        let schedule = null;

        if (HELL_SCHEDULE.WEEK.days.includes(day)) {
          schedule = HELL_SCHEDULE.WEEK;
        } else if (HELL_SCHEDULE.WEEKEND.days.includes(day)) {
          schedule = HELL_SCHEDULE.WEEKEND;
        }

        if (!schedule) {
          console.log('ℹ️ Mañana no hay hells');
          return;
        }

        for (const timeSlot of schedule.slots) {
          const hellId = await getOrCreateOpenHell({
            date: dateStr,
            timeSlot,
            channelId: hellChannelId
          });

          await createOrUpdateHellEmbed(client, hellId);

          console.log(`🔥 Hell preparado → ${dateStr} | ${timeSlot}`);
        }

      } catch (err) {
        console.error('❌ Error en hellScheduler:', err);
      }
    },
    { timezone: 'Europe/Madrid' }
  );

  console.log('⏰ Hell scheduler iniciado (21:30 Europe/Madrid)');
};
