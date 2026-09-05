// scripts/createInteractionsLog.js
// Run with: node scripts/createInteractionsLog.js

import dotenv from 'dotenv';
import { query, pool } from '../db/database.js';

dotenv.config();

async function main() {
  try {
    console.log('🔧 Creando tabla interactions_log si no existe...');
    await query(`
      CREATE TABLE IF NOT EXISTS interactions_log (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        guild_id TEXT,
        user_id TEXT,
        interaction_type TEXT,
        name TEXT,
        raw JSONB
      );
    `, [] , 30000);

    await query(`CREATE INDEX IF NOT EXISTS interactions_log_ts_idx ON interactions_log (ts DESC);`, [], 30000);
    await query(`CREATE INDEX IF NOT EXISTS interactions_log_type_idx ON interactions_log (interaction_type);`, [], 30000);

    console.log('✅ Tabla interactions_log asegurada.');
  } catch (err) {
    console.error('❌ Error creando interactions_log:', err.message || err);
  } finally {
    try { await pool.end(); } catch {};
  }
}

main();
