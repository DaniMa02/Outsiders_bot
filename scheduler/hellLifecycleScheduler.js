// schedulers/hellLifecycleScheduler.js
import cron from 'node-cron';
import { query } from '../db/database.js';
import { createOrUpdateHellEmbed } from '../services/hellEmbedService.js';

/**
 * Definición fija de horarios por enum
 */
const HELL_SCHEDULES = [
  // WEEK
  {
    timeSlot: 'WEEK_16_15',
    days: '1,3,5', // Lunes, Miércoles, Viernes
    close: '15 15',    // 15:15
    finish: '15 17'    // 17:15
  },
  {
    timeSlot: 'WEEK_20_15',
    days: '1,3,5',
    close: '15 19',
    finish: '15 21'
  },

  // WEEKEND
  {
    timeSlot: 'WEEKEND_18_50',
    days: '6,0', // Sábado, Domingo
    close: '50 17',
    finish: '50 19'
  },
  {
    timeSlot: 'WEEKEND_22_50',
    days: '6,0',
    close: '50 21',
    finish: '50 23'
  }
];

/**
 * Inicializa todos los cron jobs del ciclo de vida del hell
 */
export const initHellLifecycleScheduler = (client) => {
  for (const hell of HELL_SCHEDULES) {
    // ----------------------------
    // OPEN → CLOSED
    // ----------------------------
    cron.schedule(
      `${hell.close} * * ${hell.days}`,
      async () => {
        try {
          const res = await query(`
            UPDATE hells
            SET status = 'CLOSED'
            WHERE status = 'OPEN'
              AND time_slot = $1
              AND date = CURRENT_DATE
            RETURNING id
          `, [hell.timeSlot]);

          for (const row of res.rows) {
            await createOrUpdateHellEmbed(client, row.id);
          }

          if (res.rowCount > 0) {
            console.log(`🔒 Hell ${hell.timeSlot} cerrado (${res.rowCount})`);
          }
        } catch (err) {
          console.error('❌ Error cerrando hell:', err);
        }
      },
      { timezone: 'Europe/Madrid' }
    );

    // ----------------------------
    // CLOSED → FINISHED
    // ----------------------------
    cron.schedule(
      `${hell.finish} * * ${hell.days}`,
      async () => {
        try {
          const res = await query(`
            UPDATE hells
            SET status = 'FINISHED'
            WHERE status = 'CLOSED'
              AND time_slot = $1
              AND date = CURRENT_DATE
          `, [hell.timeSlot]);

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

/**
 * Revisa todos los Hells que deberían estar CLOSED o FINISHED
 * y los actualiza si es necesario (por si el bot arrancó tarde).
 */
export const checkAndFixHellStatesOnStartup = async (client) => {
  try {
    const now = new Date();

    const res = await query(`
      SELECT id, date, time_slot, status
      FROM hells
      WHERE status IN ('OPEN', 'CLOSED')
    `);

    for (const hell of res.rows) {
      const { id, date, time_slot: timeSlot, status } = hell;

      // Buscar en la definición fija de HELL_SCHEDULES para este slot
      const slotDef = HELL_SCHEDULES.find(h => h.timeSlot === timeSlot);
      if (!slotDef) continue;

      const [closeMinute, closeHour] = slotDef.close.split(' ').map(Number);
      const [finishMinute, finishHour] = slotDef.finish.split(' ').map(Number);

      const closeTime = new Date(`${date}T${String(closeHour).padStart(2,'0')}:${String(closeMinute).padStart(2,'0')}:00`);
      const finishTime = new Date(`${date}T${String(finishHour).padStart(2,'0')}:${String(finishMinute).padStart(2,'0')}:00`);

      // Si sigue OPEN pero ya pasó hora de cierre → CLOSED
      if (status === 'OPEN' && now >= closeTime) {
        await query(`UPDATE hells SET status = 'CLOSED' WHERE id = $1`, [id]);
        await createOrUpdateHellEmbed(client, id);
        console.log(`🔒 Hell ${id} cerrado automáticamente al arrancar`);
      }

      // Si sigue CLOSED pero ya pasó hora de finish → FINISHED
      if (status === 'CLOSED' && now >= finishTime) {
        await query(`UPDATE hells SET status = 'FINISHED' WHERE id = $1`, [id]);
        console.log(`✅ Hell ${id} finalizado automáticamente al arrancar`);
      }
    }
  } catch (err) {
    console.error('❌ Error corrigiendo estados de Hells al arrancar:', err);
  }
};
