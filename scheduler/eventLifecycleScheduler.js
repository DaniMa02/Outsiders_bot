// scheduler/eventLifecycleScheduler.js
import cron from 'node-cron';
import { query } from '../db/database.js';
import { getEventsToFinish } from '../db/eventRepository.js';
import { finishEvent } from '../services/eventManager.js';
import { createOrUpdateEventEmbed } from '../services/eventEmbedService.js';

/**
 * SCHEDULER DE CICLO DE VIDA DE EVENTOS
 * Responsable de:
 * - Cada minuto: verificar si algún evento OPEN debe cambiar a FINISHED
 * - Después de FINISHED: programar eliminación de embed en 1 hora
 * - Al arrancar: corregir eventos que deberían estar FINISHED pero no lo están
 */

let schedulerTask = null;

/**
 * Inicializar scheduler de ciclo de vida de eventos
 */
export const initEventLifecycleScheduler = (client) => {
  console.log('⏱️ Iniciando Event Lifecycle Scheduler...');

  // Ejecutar cada minuto
  schedulerTask = cron.schedule('* * * * *', async () => {
    try {
      await checkAndUpdateEventStates(client);
    } catch (err) {
      console.error('❌ Error en Event Lifecycle Scheduler:', err);
    }
  });

  console.log('✅ Event Lifecycle Scheduler inicializado (cada minuto)');
};

/**
 * Detener scheduler
 */
export const stopEventLifecycleScheduler = () => {
  if (schedulerTask) {
    schedulerTask.stop();
    console.log('🛑 Event Lifecycle Scheduler detenido');
  }
};

/**
 * Verificar y actualizar estados de eventos (OPEN → FINISHED)
 */
async function checkAndUpdateEventStates(client) {
  try {
    // 1️⃣ Obtener eventos que necesitan ser finalizados
    const eventsToFinish = await getEventsToFinish();

    if (eventsToFinish.length === 0) {
      return; // Nada que hacer
    }

    // 2️⃣ Para cada evento, cambiar estado a FINISHED
    for (const event of eventsToFinish) {
      try {
        console.log(`⏰ Finalizando evento ${event.id} (${event.title})`);

        // Cambiar estado a FINISHED
        await finishEvent(event.id, client);

        // Actualizar embed para mostrar "Finalizado"
        await createOrUpdateEventEmbed(client, event.id);

      } catch (err) {
        console.error(`❌ Error finalizando evento ${event.id}:`, err);
      }
    }

    if (eventsToFinish.length > 0) {
      console.log(`✅ ${eventsToFinish.length} evento(s) finalizado(s)`);
    }

  } catch (err) {
    console.error('❌ Error en checkAndUpdateEventStates:', err);
  }
}

/**
 * LIMPIAR EMBEDS VIEJOS
 * Verificar cada hora si hay embeds que deben eliminarse (1h después de FINISHED)
 */
export const initEmbedCleanupScheduler = (client) => {
  console.log('🧹 Iniciando Embed Cleanup Scheduler...');

  // Ejecutar cada hora
  cron.schedule('0 * * * *', async () => {
    try {
      await cleanupOldEmbeds(client);
    } catch (err) {
      console.error('❌ Error en Embed Cleanup Scheduler:', err);
    }
  });

  console.log('✅ Embed Cleanup Scheduler inicializado (cada hora)');
};

/**
 * Limpiar embeds de eventos FINISHED hace más de 1 hora
 */
async function cleanupOldEmbeds(client) {
  try {
    // Obtener eventos FINISHED hace más de 1 hora
    const oneHourAgo = new Date(Date.now() - 3600000);

    const res = await query(`
      SELECT id, channel_id, message_id
      FROM events
      WHERE status = 'FINISHED'
        AND updated_at <= $1
        AND message_id IS NOT NULL
      LIMIT 200
    `, [oneHourAgo.toISOString()]);

    if (res.rowCount === 0) {
      return; // Nada que limpiar
    }

    let cleaned = 0;
    let skipped = 0;

    for (const event of res.rows) {
      try {
        const channel = await client.channels.fetch(event.channel_id);
        if (channel) {
          const message = await channel.messages.fetch(event.message_id);
          await message.delete();
          cleaned++;
          console.log(`🗑️ Embed eliminado: evento ${event.id}`);
        } else {
          // Canal borrado, nada más que hacer
          skipped++;
        }

        // Limpiar message_id (tanto en éxito como si el canal ya no existe)
        await query('UPDATE events SET message_id = NULL WHERE id = $1', [event.id]);

      } catch (err) {
        // Discord code 10008: Unknown Message → ya fue borrado, limpiar referencia
        if (err.code === 10008) {
          await query('UPDATE events SET message_id = NULL WHERE id = $1', [event.id]);
          skipped++;
        } else {
          console.warn(`⚠️ Error limpiando embed de evento ${event.id}:`, err.message);
        }
      }
    }

    console.log(`✅ ${cleaned} embed(s) eliminado(s), ${skipped} referencia(s) limpiada(s)`);

  } catch (err) {
    console.error('❌ Error en cleanupOldEmbeds:', err);
  }
}

/**
 * VALIDAR ESTADOS AL ARRANCAR
 * Verificar eventos que deberían estar FINISHED pero todavía están OPEN
 * (Por si el bot estuvo offline durante la hora de finalización)
 */
export const checkAndFixEventStatesOnStartup = async (client) => {
  console.log('🔧 Verificando estados de eventos al arrancar...');

  try {
    const now = new Date();

    // Obtener todos los eventos OPEN cuya datetime ya pasó
    const res = await query(`
      SELECT id, type, title, datetime, channel_id, message_id
      FROM events
      WHERE status = 'OPEN' AND datetime <= NOW()
      ORDER BY datetime DESC
    `);

    if (res.rowCount === 0) {
      console.log('✅ Todos los eventos están en estado correcto');
      return;
    }

    console.log(`⚠️ Encontrados ${res.rowCount} evento(s) que debería estar FINISHED...`);

    for (const event of res.rows) {
      try {
        console.log(`🔧 Finalizando evento: ${event.title}`);

        // Cambiar estado a FINISHED
        await query(
          'UPDATE events SET status = $1, updated_at = NOW() WHERE id = $2',
          ['FINISHED', event.id]
        );

        // Actualizar embed
        await createOrUpdateEventEmbed(client, event.id);

      } catch (err) {
        console.error(`❌ Error corrigiendo evento ${event.id}:`, err);
      }
    }

    console.log(`✅ Corregidos ${res.rowCount} evento(s)`);

  } catch (err) {
    console.error('❌ Error en checkAndFixEventStatesOnStartup:', err);
  }
};

// ==================== SHADOW TOWER DIARIO ====================

/**
 * Recordatorio diario para Shadow Tower (21:30).
 * Envía un mensaje al canal configurado con la mención al rol @Miembros
 * 10 minutos antes del evento.
 *
 * Variables requeridas:
 *   SHADOW_TOWER_CHANNEL_ID - canal donde se envía el recordatorio
 *   MIEMBROS_ROLE_ID        - rol a mencionar
 */
export const initShadowTowerReminder = (client) => {
  const botVars = getBotVariables();
  const channelId = botVars.SHADOW_TOWER_CHANNEL_ID;
  const roleId = botVars.MIEMBROS_ROLE_ID;

  if (!channelId || !roleId) {
    console.warn('⚠️ Shadow Tower reminder no configurado (falta SHADOW_TOWER_CHANNEL_ID o MIEMBROS_ROLE_ID)');
    return;
  }

  console.log('⏰ Iniciando Shadow Tower daily reminder (21:20)...');

  // 21:20 todos los días, hora Madrid
  cron.schedule('20 21 * * *', async () => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send({
          content: `⏰ <@&${roleId}> **Shadow Tower** empieza en 10 minutos (21:30).`
        });
        console.log('⏰ Recordatorio de Shadow Tower enviado');
      }
    } catch (err) {
      console.error('❌ Error enviando recordatorio de Shadow Tower:', err);
    }
  }, { timezone: 'Europe/Madrid' });

  console.log('✅ Shadow Tower reminder programado');
};
