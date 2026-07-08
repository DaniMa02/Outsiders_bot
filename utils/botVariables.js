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

/**
 * Obtener una variable del bot por clave (lookup case-insensitive).
 *
 * Por convención las claves se guardan en MAYÚSCULAS (ROLE_ADMIN,
 * ROLE_LIDER_GRUPO, etc.), pero si por algún motivo se guardaron en
 * otro case (ej: un /add_variable antiguo guardó "role_lider_grupo"),
 * esta función sigue resolviendo el valor correcto en lugar de devolver
 * undefined silenciosamente.
 *
 * @param {string} key - Clave a buscar (case-insensitive)
 * @returns {string|undefined} El valor o undefined si no existe
 */
export const getBotVariable = (key) => {
  if (!key) return undefined;
  if (botVariables[key] !== undefined) return botVariables[key];

  const upper = String(key).toUpperCase();
  for (const k of Object.keys(botVariables)) {
    if (k.toUpperCase() === upper) return botVariables[k];
  }
  return undefined;
};
