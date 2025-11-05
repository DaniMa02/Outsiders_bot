// db/test_db.js
import { query } from './database.js';

const test = async () => {
  try {
    const res = await query('SELECT NOW()'); // consulta simple para probar
    console.log('✅ Conexión exitosa a la base de datos:', res.rows[0]);
  } catch (err) {
    console.error('❌ Error conectando a la base de datos:', err);
  }
};

test();
