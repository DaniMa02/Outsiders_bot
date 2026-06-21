// utils/eventCache.js
import { query } from '../db/database.js';

/**
 * Caché en memoria de eventos para alimentar el autocomplete
 * de /restore_event sin tener que consultar la DB en cada keystroke.
 *
 * Contiene:
 *  - Todos los eventos OPEN
 *  - Los eventos FINISHED de las últimas RECENT_FINISHED_HOURS horas
 *    (para poder recuperar cancelados por error)
 *
 * Se carga al arrancar el bot y se mantiene sincronizado con los
 * cambios que hace el propio bot (create / finish / restore / delete).
 *
 * No es crítico: si se desincroniza por un cambio externo (SQL manual,
 * etc.), el siguiente reinicio lo corrige.
 */

const RECENT_FINISHED_HOURS = 24;
let eventsCache = new Map(); // key: eventId, value: { id, type, title, datetime, status, updatedAt }

/**
 * Cargar todos los eventos relevantes desde la BD al caché:
 * - OPEN
 * - FINISHED de las últimas RECENT_FINISHED_HOURS horas
 */
export const loadEventsCache = async () => {
  try {
    const res = await query(
      `SELECT id, type, title, datetime, status, updated_at
       FROM events
       WHERE status = 'OPEN'
          OR (status = 'FINISHED' AND updated_at > NOW() - ($1::int * INTERVAL '1 hour'))
       ORDER BY datetime ASC`,
      [RECENT_FINISHED_HOURS]
    );
    eventsCache = new Map();
    for (const row of res.rows) {
      eventsCache.set(row.id, {
        id: row.id,
        type: row.type,
        title: row.title,
        datetime: row.datetime,
        status: row.status,
        updatedAt: row.updated_at
      });
    }
    console.log(`✅ Caché de eventos cargada: ${eventsCache.size} eventos (OPEN + FINISHED últimas ${RECENT_FINISHED_HOURS}h)`);
  } catch (err) {
    console.error('❌ Error cargando caché de eventos:', err.message);
  }
};

/**
 * Añadir/actualizar un evento en el caché (cualquier status).
 * Si el status es FINISHED pero updated_at tiene más de 24h, NO se añade
 * (sería inútil para el autocomplete de /restore_event).
 */
export const addEventToCache = (event) => {
  if (!event) return;

  if (event.status === 'FINISHED') {
    const updatedAt = event.updated_at ? new Date(event.updated_at) : new Date();
    const cutoff = Date.now() - RECENT_FINISHED_HOURS * 60 * 60 * 1000;
    if (updatedAt.getTime() < cutoff) {
      // Ya pasó la ventana de 24h, no lo guardamos
      eventsCache.delete(event.id);
      return;
    }
  }

  eventsCache.set(event.id, {
    id: event.id,
    type: event.type,
    title: event.title,
    datetime: event.datetime,
    status: event.status,
    updatedAt: event.updated_at || new Date().toISOString()
  });
};

/**
 * Eliminar un evento del caché
 */
export const removeEventFromCache = (eventId) => {
  eventsCache.delete(eventId);
};

/**
 * Obtener todos los eventos OPEN del caché (array ordenado por datetime)
 */
export const getOpenEventsFromCache = () => {
  return Array.from(eventsCache.values())
    .filter(e => e.status === 'OPEN')
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
};

/**
 * Obtener eventos FINISHED recientes del caché (últimas N horas, ordenado
 * por updatedAt DESC para mostrar primero los cancelados más recientes).
 */
export const getRecentFinishedEventsFromCache = (hours = RECENT_FINISHED_HOURS) => {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return Array.from(eventsCache.values())
    .filter(e => e.status === 'FINISHED' && new Date(e.updatedAt).getTime() > cutoff)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
};
