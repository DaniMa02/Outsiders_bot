// utils/botVariables.js
import { query } from '../db/database.js';

let botVariables = {};

export const loadBotVariables = async () => {
  try {
    const res = await query('SELECT key, value FROM bot_variables');
    botVariables = {};
    res.rows.forEach(row => {
      botVariables[row.key] = row.value;
    });
    console.log('✅ Variables del bot cargadas:', botVariables);
  } catch (err) {
    console.error('❌ Error cargando variables del bot:', err);
  }
};

// Función para acceder al objeto ya cargado
export const getBotVariables = () => botVariables;
