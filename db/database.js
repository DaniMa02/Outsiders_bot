// db/database.js
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

const withTimeout = (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Query timeout (${ms}ms): ${label}`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const query = async (text, params, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS) => {
  return withTimeout(pool.query(text, params), timeoutMs, text.split('\n')[0].slice(0, 60));
};

export { pool };


