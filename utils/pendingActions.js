// utils/pendingActions.js

/**
 * Almacén en memoria de acciones pendientes (entre modal y siguiente paso).
 * Se pierde al reiniciar el bot, pero es aceptable para flujos cortos.
 *
 * Estructura: key = `${userId}:${eventId}`, value = { name?, participantId?, newRole?, timestamp }
 */

const pendingActions = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutos

const isExpired = (entry) => Date.now() - entry.timestamp > PENDING_TTL_MS;

// ==================== ADD (modal nombre → select rol) ====================

export const setPendingAdd = (userId, eventId, name) => {
  pendingActions.set(`add:${userId}:${eventId}`, { name, timestamp: Date.now() });
};

export const getPendingAdd = (userId, eventId) => {
  const entry = pendingActions.get(`add:${userId}:${eventId}`);
  if (!entry) return null;
  if (isExpired(entry)) {
    pendingActions.delete(`add:${userId}:${eventId}`);
    return null;
  }
  return entry;
};

export const clearPendingAdd = (userId, eventId) => {
  pendingActions.delete(`add:${userId}:${eventId}`);
};

// ==================== MOVE (2 selects + confirm) ====================

export const setMoveSelection = (userId, eventId, partial) => {
  const key = `move:${userId}:${eventId}`;
  const current = pendingActions.get(key) || {};
  pendingActions.set(key, { ...current, ...partial, timestamp: Date.now() });
};

export const getMoveSelection = (userId, eventId) => {
  const entry = pendingActions.get(`move:${userId}:${eventId}`);
  if (!entry) return null;
  if (isExpired(entry)) {
    pendingActions.delete(`move:${userId}:${eventId}`);
    return null;
  }
  return entry;
};

export const clearMoveSelection = (userId, eventId) => {
  pendingActions.delete(`move:${userId}:${eventId}`);
};

// ==================== LIMPIEZA ====================

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingActions) {
    if (isExpired(value)) {
      pendingActions.delete(key);
    }
  }
}, 60 * 1000).unref();

