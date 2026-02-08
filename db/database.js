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

// Función para ejecutar queries fácilmente
export const query = async (text, params) => {
  return pool.query(text, params);
};

export { pool };
