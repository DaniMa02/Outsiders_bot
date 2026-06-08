// db/database.js
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config(); // carga variables de entorno desde .env

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // necesario para Neon en Node.js
  }
});

const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout (${ms}ms): ${label}`)), ms)
    )
  ]);

// Función para ejecutar queries fácilmente con timeout
export const query = async (text, params, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS) => {
  return withTimeout(pool.query(text, params), timeoutMs, text.split('\n')[0].slice(0, 60));
};

export { pool };

