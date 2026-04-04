// schedulers/hellLifecycleScheduler.js
import cron from 'node-cron';
import { query } from '../db/database.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';

const HELL_SCHEDULES = [
  {
    timeSlot: 'WEEK_16_15',
    days: '1,3,5',
    finish: '25 16'
  },
  {
    timeSlot: 'WEEK_20_15',
    days: '1,3,5',
    finish: '25 20'
  },
  {
    timeSlot: 'WEEKEND_18_50',
    days: '6,0',
    finish: '00 19'
  },
  {
    timeSlot: 'WEEKEND_22_50',
    days: '6,0',
    finish: '00 23'
  }
];

export const initHellLifecycleScheduler = (client) => {
  for (const hell of HELL_SCHEDULES) {

    // ----------------------------
    // OPEN → FINISHED
    // ----------------------------
    cron.schedule(
      `${hell.finish} * * ${hell.days}`,
      async () => {
        try {
          const res = await query(`
            UPDATE hells
            SET status = 'FINISHED'
            WHERE status = 'OPEN'
              AND time_slot = $1
              AND date = (now() AT TIME ZONE 'Europe/Madrid')::date
            RETURNING id
          `, [hell.timeSlot]);

          for (const row of res.rows) {
            await createOrUpdateHellEmbed(client, row.id);
          }

          if (res.rowCount > 0) {
            console.log(`✅ Hell ${hell.timeSlot} finalizado (${res.rowCount})`);
          }

        } catch (err) {
          console.error('❌ Error finalizando hell:', err);
        }
      },
      { timezone: 'Europe/Madrid' }
    );
  }

  console.log('⏱️ Hell lifecycle scheduler inicializado');
};

// 🔧 FIX STARTUP
export const checkAndFixHellStatesOnStartup = async (client) => {
  try {
    const now = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' })
    );

    const res = await query(`
      SELECT id, date, time_slot, status
      FROM hells
      WHERE status = 'OPEN'
    `);

    for (const hell of res.rows) {
      const { id, date, time_slot: timeSlot } = hell;

      const slotDef = HELL_SCHEDULES.find(h => h.timeSlot === timeSlot);
      if (!slotDef) continue;

      const [finishMinute, finishHour] = slotDef.finish.split(' ').map(Number);

      const finishTime = new Date(
        `${date}T${String(finishHour).padStart(2,'0')}:${String(finishMinute).padStart(2,'0')}:00`
      );

      if (now >= finishTime) {
        await query(`UPDATE hells SET status = 'FINISHED' WHERE id = $1`, [id]);
        await createOrUpdateHellEmbed(client, id);

        console.log(`✅ Hell ${id} finalizado automáticamente al arrancar`);
      }
    }

  } catch (err) {
    console.error('❌ Error corrigiendo estados de Hells al arrancar:', err);
  }
};