// db/hellRepository.js
import { query } from './database.js';

// ---------------- Clase del usuario ----------------
export const setUserClass = async (discordId, chosenClass) => {
  try {
    await query(`
      INSERT INTO users (discord_id, class)
      VALUES ($1, $2)
      ON CONFLICT (discord_id) DO UPDATE SET class = $2;
    `, [discordId, chosenClass]);

    console.log(`✅ Clase de ${discordId} asignada: ${chosenClass}`);
  } catch (err) {
    console.error(`❌ Error asignando clase a ${discordId}:`, err);
  }
};

// ---------------- Rol que puede cumplir un usuario ----------------
export const addUserRoleCapability = async (discordId, role) => {
  try {
    await query(`
      INSERT INTO user_role_capabilities (discord_id, role)
      VALUES ($1, $2)
      ON CONFLICT (discord_id, role) DO NOTHING;
    `, [discordId, role]);

    console.log(`✅ Capacidad de rol añadida para ${discordId}: ${role}`);
  } catch (err) {
    console.error(`❌ Error añadiendo capacidad de rol a ${discordId}:`, err);
  }
};

// ---------------- Marcar/desmarcar ausencia ----------------
export const toggleParticipantAbsence = async (hellId, discordId) => {
  try {
    const res = await query(`
      SELECT state FROM hell_participants
      WHERE hell_id = $1 AND discord_id = $2;
    `, [hellId, discordId]);

    if (res.rowCount === 0) return;

    const newState = res.rows[0].state === 'ABSENCE' ? 'ACTIVE' : 'ABSENCE';
    await query(`
      UPDATE hell_participants
      SET state = $1
      WHERE hell_id = $2 AND discord_id = $3;
    `, [newState, hellId, discordId]);

    console.log(`⚠️ Estado de ${discordId} en Hell ${hellId} cambiado a ${newState}`);
  } catch (err) {
    console.error(`❌ Error toggling absence de ${discordId}:`, err);
  }
};
