// utils/interactionAggregator.js
import { query } from '../db/database.js';

const buckets = new Map(); // key: minuteISO|type|name -> count
let flushInterval = null;
const FLUSH_INTERVAL_MS = 60_000; // flush cada minuto

async function ensureTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS interactions_aggregate (
        id BIGSERIAL PRIMARY KEY,
        ts_minute TIMESTAMPTZ NOT NULL,
        interaction_type TEXT,
        name TEXT,
        count INTEGER NOT NULL
      )
    `);
    await query('CREATE INDEX IF NOT EXISTS interactions_aggregate_ts_idx ON interactions_aggregate (ts_minute DESC)');
    await query('CREATE INDEX IF NOT EXISTS interactions_aggregate_type_idx ON interactions_aggregate (interaction_type)');
  } catch (err) {
    console.warn('⚠️ No se pudo asegurar la tabla interactions_aggregate:', err.message || err);
  }
}

function recordInteraction(type, name) {
  try {
    const now = new Date();
    now.setSeconds(0, 0);
    const minuteKey = now.toISOString();
    const k = `${minuteKey}|${type || 'unknown'}|${name || ''}`;
    const prev = buckets.get(k) || 0;
    buckets.set(k, prev + 1);
  } catch (err) {
    // no dejar que falle la interacción
    console.warn('⚠️ interactionAggregator.recordInteraction error:', err.message || err);
  }
}

async function flush() {
  if (buckets.size === 0) return;
  const rows = [];
  for (const [k, count] of buckets.entries()) {
    const [minuteISO, type, name] = k.split('|');
    rows.push({ minuteISO, type, name, count });
  }

  // preparar batch insert
  const valuesSql = [];
  const params = [];
  let idx = 1;
  for (const r of rows) {
    valuesSql.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    params.push(r.minuteISO, r.type, r.name, r.count);
  }

  const sql = `INSERT INTO interactions_aggregate (ts_minute, interaction_type, name, count) VALUES ${valuesSql.join(', ')} `;

  try {
    await query(sql, params, 30_000);
    buckets.clear();
  } catch (err) {
    console.warn('⚠️ interactionAggregator.flush error:', err.message || err);
    // No vaciar buckets para reintentar en próximo flush
  }
}

export function start() {
  if (flushInterval) return;
  ensureTable().catch(() => {});
  flushInterval = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  if (flushInterval.unref) flushInterval.unref();
}

let purgeInterval = null;

export function stop() {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (purgeInterval) {
    clearInterval(purgeInterval);
    purgeInterval = null;
  }
}

async function purgeOldRows() {
  try {
    const res = await query("DELETE FROM interactions_aggregate WHERE ts_minute < NOW() - INTERVAL '15 days'");
    if (res && typeof res.rowCount === 'number') {
      console.log(`🧹 interactions_aggregate: purgados ${res.rowCount} fila(s) antiguas (>15 días)`);
    }
  } catch (err) {
    console.warn('⚠️ interactionAggregator.purgeOldRows error:', err.message || err);
  }
}

export { recordInteraction };

// Auto-start on import
start();

// Programar purge diario (cada 24h) para limpiar >15 días
purgeInterval = setInterval(() => {
  purgeOldRows().catch(() => {});
}, 24 * 60 * 60 * 1000);
if (purgeInterval.unref) purgeInterval.unref();

// Ejecutar una purga al arrancar (no forzar en caso de que DB no exista)
purgeOldRows().catch(() => {});
