// listeners/guildMemberUpdate.js
import { setUserClass, getUserCapabilities, addUserCapability, removeUserCapability } from '../db/eventRepository.js';
import { query } from '../db/database.js';
import { handleEventRecalcOnRoleChange } from '../services/eventAutoRecalcOnRoleChange.js';
import { inferClassFromDiscordRoles } from '../utils/classInference.js';
import { classRoleIds, ROLE_SIN_CLASE } from '../config/classRoles.js';

/**
 * LISTENER UNIFICADO DE GuildMemberUpdate
 *
 * Antes había dos listeners separados sobre el mismo evento:
 *   - handleGuildMemberUpdate: clase + nickname
 *   - handleGuildMemberUpdateRoles: capabilities + recálculo de eventos
 *
 * Eso duplicaba queries en cada cambio de rol y disparaba un UPDATE del
 * nickname aunque el nickname no hubiera cambiado. Ahora se hace todo en
 * un solo recorrido, con:
 *
 *   1. Debounce por usuario: si llegan varios GUILD_MEMBER_UPDATE seguidos
 *      (p.ej. un bot de verificación añade 3 roles a la vez y Discord
 *      emite 3 eventos), solo se procesa el estado final.
 *
 *   2. Comparación de valores antes de escribir:
 *      - setUserClass: el SQL solo actualiza si class IS DISTINCT FROM
 *      - nickname: el SQL solo actualiza si nickname IS DISTINCT FROM
 *      - capabilities: en lugar de comparar oldMember vs newMember, se
 *        compara el estado real de Discord (newMember.roles) contra la
 *        BD. INSERT solo si no existe, DELETE solo si existe.
 *
 *   3. Una sola pasada sobre las 5 capabilities (antes se hacía siempre
 *      un INSERT/DELETE por cada una, incluso si nada había cambiado).
 */

const eventRoleCapabilities = [
  'HTank',
  'HDD',
  'HHealer',
  'HDebuffer',
  'HLurer'
];

const DEBOUNCE_MS = 2000;
const debounceTimers = new Map();

export const handleGuildMemberUpdate = (client) => async (oldMember, newMember) => {
  // 1️⃣ Si nada cambió (ni roles ni nickname), salimos sin programar nada
  if (oldMember.roles.cache.equals(newMember.roles.cache) &&
      oldMember.nickname === newMember.nickname) {
    return;
  }

  // 2️⃣ Debounce: si ya hay un timer pendiente para este usuario, lo cancelamos
  const userId = newMember.id;
  const existing = debounceTimers.get(userId);
  if (existing) clearTimeout(existing);

  // 3️⃣ Programamos el procesamiento del estado FINAL (newMember)
  const timer = setTimeout(() => {
    debounceTimers.delete(userId);
    processUpdate(client, newMember).catch(err =>
      console.error(`❌ Error en guildMemberUpdate (debounced) para ${newMember.user?.tag || userId}:`, err)
    );
  }, DEBOUNCE_MS);

  if (typeof timer.unref === 'function') timer.unref();
  debounceTimers.set(userId, timer);
};

async function processUpdate(client, newMember) {
  // 1️⃣ Clase inferida desde roles
  const inferredClass = inferClassFromDiscordRoles(newMember);
  if (inferredClass) {
    // setUserClass ya hace INSERT...ON CONFLICT DO UPDATE solo si class
    // IS DISTINCT FROM, así que es un no-op si la clase no cambió.
    await setUserClass(newMember.id, inferredClass);
  }

  // 2️⃣ Quitar rol temporal "Sin Clase" si ya tiene rol de clase
  const hasClassRole = Object.values(classRoleIds).some(roleId => newMember.roles.cache.has(roleId));
  if (hasClassRole && newMember.roles.cache.has(ROLE_SIN_CLASE)) {
    await newMember.roles.remove(ROLE_SIN_CLASE).catch(err =>
      console.error(`❌ Error quitando ROLE_SIN_CLASE a ${newMember.user.tag}:`, err)
    );
  }

  // 3️⃣ Nickname: solo escribimos si cambió (IS DISTINCT FROM)
  const newNickname = newMember.displayName;
  await query(`
    UPDATE users
    SET nickname = $1
    WHERE discord_id = $2 AND nickname IS DISTINCT FROM $1
  `, [newNickname, newMember.id]);

  // 4️⃣ Sincronizar capabilities: comparamos estado de Discord vs BD
  const dbCaps = await getUserCapabilities(newMember.id);
  const dbCapsSet = new Set(dbCaps);
  const memberRoleNames = new Set(newMember.roles.cache.map(r => r.name));

  let capabilityChanged = false;

  for (const cap of eventRoleCapabilities) {
    const hasInMember = memberRoleNames.has(cap);
    const hasInDb = dbCapsSet.has(cap);

    if (hasInMember && !hasInDb) {
      await addUserCapability(newMember.id, cap);
      capabilityChanged = true;
      console.log(`✅ Capacidad añadida: ${newMember.user.tag} → ${cap}`);
    } else if (!hasInMember && hasInDb) {
      await removeUserCapability(newMember.id, cap);
      capabilityChanged = true;
      console.log(`❌ Capacidad eliminada: ${newMember.user.tag} → ${cap}`);
    }
  }

  // 5️⃣ Recalcular eventos si cambió alguna capability
  if (capabilityChanged) {
    await handleEventRecalcOnRoleChange(client, null, newMember);
  }

  console.log(`🔄 Sync GuildMemberUpdate: ${newMember.user.tag} → Clase: ${inferredClass || 'N/A'}, Nickname: ${newNickname}, CapsΔ: ${capabilityChanged}`);
}
