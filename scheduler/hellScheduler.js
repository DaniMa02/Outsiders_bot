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
    '55 21 * * *', // ⬅️ cambia temporalmente esto para testear
    async () => {
      try {
        console.log('⏰ Ejecutando hellScheduler...');

        const now = new Date();
        console.log('🕒 Server time:', now.toString());

        const madridNow = new Date().toLocaleString('en-US', {
          timeZone: 'Europe/Madrid'
        });
        console.log('🇪🇸 Madrid time:', madridNow);

        const botVars = getBotVariables();
        const hellChannelId = botVars.HELL_CHANNEL_ID;

        if (!hellChannelId) {
          console.warn('⚠️ HELL_CHANNEL no definido');
          return;
        }

        // 📅 Función para fecha en España
        function getSpainDate(offsetDays = 0) {
          const date = new Date();
          date.setDate(date.getDate() + offsetDays);

          return date.toLocaleDateString('en-CA', {
            timeZone: 'Europe/Madrid'
          });
        }

        // 📅 mañana (fecha)
        const dateStr = getSpainDate(1);

        // 📆 mañana (día de la semana correctamente)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const day = tomorrow.getDay();

        console.log('📅 Fecha calculada (mañana):', dateStr);
        console.log('📆 Día de la semana (0=Domingo):', day);

        let schedule = null;

        if (HELL_SCHEDULE.WEEK.days.includes(day)) {
          schedule = HELL_SCHEDULE.WEEK;
        } else if (HELL_SCHEDULE.WEEKEND.days.includes(day)) {
          schedule = HELL_SCHEDULE.WEEKEND;
        }

        if (!schedule) {
          console.log('❌ No hay schedule para este día:', day);
          return;
        }

        console.log('✅ Schedule detectado:', schedule);

        for (const timeSlot of schedule.slots) {
          console.log('🧩 Creando hell para slot:', timeSlot);

          const hellId = await getOrCreateOpenHell({
            date: dateStr,
            timeSlot,
            channelId: hellChannelId
          });

          console.log('🆔 Hell ID creado/encontrado:', hellId);

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