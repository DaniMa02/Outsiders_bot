// utils/eventCache.js
import { query } from '../db/database.js';

/**
 * Caché en memoria de eventos OPEN para alimentar el autocomplete
 * de /restore_event sin tener que consultar la DB en cada keystroke.
 *
 * Se carga al arrancar el bot y se mantiene sincronizado con los
 * cambios que hace el propio bot (create / finish / delete).
 *
 * No es crítico: si se desincroniza por un cambio externo (SQL manual,
 * etc.), el siguiente reinicio lo corrige.
 */

let openEventsCache = new Map(); // key: eventId, value: { id, type, title, datetime }

/**
 * Cargar todos los eventos OPEN desde la BD al caché
 */
export const loadOpenEventsCache = async () => {
  try {
    const res = await query(
      `SELECT id, type, title, datetime
       FROM events
       WHERE status = 'OPEN'
       ORDER BY datetime ASC`
    );
    openEventsCache = new Map();
    for (const row of res.rows) {
      openEventsCache.set(row.id, row);
    }
    console.log(`✅ Caché de eventos OPEN cargada: ${openEventsCache.size} eventos`);
  } catch (err) {
    console.error('❌ Error cargando caché de eventos OPEN:', err.message);
  }
};

/**
 * Añadir un evento al caché (solo si está OPEN)
 */
export const addEventToCache = (event) => {
  if (!event) return;
  if (event.status === 'OPEN') {
    openEventsCache.set(event.id, {
      id: event.id,
      type: event.type,
      title: event.title,
      datetime: event.datetime
    });
  }
};

/**
 * Eliminar un evento del caché
 */
export const removeEventFromCache = (eventId) => {
  openEventsCache.delete(eventId);
};

/**
 * Obtener todos los eventos OPEN del caché (array ordenado)
 */
export const getOpenEventsFromCache = () => {
  return Array.from(openEventsCache.values()).sort(
    (a, b) => new Date(a.datetime) - new Date(b.datetime)
  );
};
