// utils/deleteQueue.js

/**
 * Cola global para ejecutar operaciones de borrado en Discord con tasa limitada.
 * Se encola una función async (por ejemplo: () => message.delete()) y devuelve
 * una promesa que se resuelve/rechaza cuando la operación se ejecuta.
 *
 * Esto evita ráfagas de DELETE / webhook.deleteMessage simultáneos que puedan
 * provocar rate limits (429) si muchos componentes del bot intentan borrar
 * mensajes a la vez.
 */

const queue = [];
let interval = null;
const DEFAULT_DELETES_PER_SECOND = 5; // ajustar según sea necesario
const envVal = Number(process.env.DELETES_PER_SECOND);
let deletesPerSecond = Number.isFinite(envVal) && envVal > 0 ? Math.max(1, Math.floor(envVal)) : DEFAULT_DELETES_PER_SECOND;

function startProcessor() {
  if (interval) return;
  interval = setInterval(async () => {
    try {
      for (let i = 0; i < deletesPerSecond; i++) {
        const item = queue.shift();
        if (!item) break;
        const { fn, resolve, reject } = item;
        try {
          const res = await fn();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      }
    } catch (err) {
      // No dejar que errores rompan el loop
      console.error('❌ Error en deleteQueue processor:', err);
    }
  }, 1000);

  if (interval.unref) interval.unref();
}

/**
 * Enqueue a deletion function. fn must be a function returning a Promise.
 * Returns a promise that resolves/rejects with the fn result.
 */
export function enqueueDelete(fn) {
  if (typeof fn !== 'function') {
    return Promise.reject(new Error('enqueueDelete requires a function'));
  }

  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    startProcessor();
  });
}

export function setDeletesPerSecond(n) {
  deletesPerSecond = Math.max(1, Math.floor(n));
}

export function stopProcessor() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

export default { enqueueDelete, setDeletesPerSecond, stopProcessor };
