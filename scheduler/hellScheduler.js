import cron from 'node-cron';
import { getOrCreateOpenHell } from '../services/hellManager.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';
import { getBotVariables } from '../utils/botVariables.js';
import { eventBus } from '../utils/eventBus.js';

let currentTask = null;
let currentSchedule = null;

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

// ---------------- CREAR CRON ----------------
function createCron(client, time) {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    console.warn('⚠️ Formato inválido en HELL_SCHEDULER_TIME:', time);
    return null;
  }

  const [hour, minute] = time.split(':');
  const pattern = `${minute} ${hour} * * *`;

  console.log(`⏰ Scheduler configurado: ${pattern}`);

  return cron.schedule(pattern, async () => {
    try {
      console.log('⏰ Ejecutando hellScheduler dinámico...');

      const botVars = getBotVariables();
      const hellChannelId = botVars.HELL_CHANNEL_ID;

      if (!hellChannelId) return;

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

      if (!schedule) return;

      for (const timeSlot of schedule.slots) {
        const hellId = await getOrCreateOpenHell({
          date: dateStr,
          timeSlot,
          channelId: hellChannelId
        });

        await createOrUpdateHellEmbed(client, hellId);
      }

    } catch (err) {
      console.error('❌ Error en hellScheduler:', err);
    }
  }, { timezone: 'Europe/Madrid' });
}

// ---------------- RELOAD DINÁMICO ----------------
function updateScheduler(client, newTime) {
  if (newTime === currentSchedule) return;

  console.log(`🔄 Scheduler actualizado: ${currentSchedule} → ${newTime}`);

  if (currentTask) {
    currentTask.stop();
  }

  const newTask = createCron(client, newTime);

  if (newTask) {
    currentTask = newTask;
    currentSchedule = newTime;
  }
}

// ---------------- INIT ----------------
export const startHellScheduler = (client) => {
  const botVars = getBotVariables();
  const time = botVars.HELL_SCHEDULER_TIME;

  if (!time) {
    console.warn('⚠️ HELL_SCHEDULER_TIME no definida');
    return;
  }

  currentTask = createCron(client, time);
  currentSchedule = time;

  // 🔥 EVENT LISTENER (CLAVE)
  eventBus.on('botVariableChanged', ({ key, value }) => {
    if (key !== 'HELL_SCHEDULER_TIME') return;

    updateScheduler(client, value);
  });

  console.log(`⏰ Scheduler iniciado a las ${time}`);
};