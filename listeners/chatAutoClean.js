// listeners/chatAutoClean.js
import { Events } from 'discord.js';
import { getBotVariables } from '../utils/botVariables.js';
import { eventBus } from '../utils/eventBus.js';

/**
 * Auto-limpieza de chat: borra mensajes con >1h de antigüedad,
 * EXCEPTO los embeds enviados por el propio bot (embeds de eventos).
 *
 * El borrado es POR MENSAJE: cada mensaje programa su propio setTimeout
 * para (createdTimestamp + 1h). No es un cron global.
 *
 * Configuración: lee estas variables del bot y aplica auto-clean a sus canales.
 *   - RAID_CHANNEL_ID
 *   - HELL_CHANNEL_ID
 *   - HARDCORE_CHANNEL_ID
 * Cada una acepta un ID de canal (o varios separados por coma).
 * Si un canal listado contiene threads, los threads también se limpian.
 *
 * Persistencia: si el bot se reinicia, al arrancar se escanean los
 * últimos 100 mensajes de cada canal configurado y se reprograma el
 * borrado de los que aún no han cumplido la 1h.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const VAR_KEYS = ['RAID_CHANNEL_ID', 'HELL_CHANNEL_ID', 'HARDCORE_CHANNEL_ID'];
const SCAN_LIMIT = 100;

const scheduledTimers = new Map();

let configuredChannelIds = new Set();

const isAutoCleanChannel = (channel) => {
  if (!channel) return false;
  if (configuredChannelIds.has(channel.id)) return true;
  if (channel.parentId && configuredChannelIds.has(channel.parentId)) return true;
  return false;
};

const isProtectedMessage = (message, client) => {
  return Boolean(
    message?.author?.id === client.user.id &&
    Array.isArray(message.embeds) &&
    message.embeds.length > 0
  );
};

const tryDelete = async (message) => {
  try {
    const fresh = await message.channel.messages.fetch(message.id);
    if (fresh.pinned) return false;
    if (isProtectedMessage(fresh, message.client)) return false;
    await fresh.delete();
    console.log(`🧹 Auto-clean: borrado ${message.id} en #${message.channel.id}`);
    return true;
  } catch (err) {
    if (err.code === 10008) return false;
    console.warn(`⚠️ Auto-clean: no se pudo borrar ${message.id}:`, err.message);
    return false;
  }
};

const scheduleDeletion = (message) => {
  if (!message?.id) return;
  if (scheduledTimers.has(message.id)) {
    clearTimeout(scheduledTimers.get(message.id));
  }

  const elapsed = Date.now() - message.createdTimestamp;
  const delay = Math.max(0, ONE_HOUR_MS - elapsed);

  const timer = setTimeout(async () => {
    scheduledTimers.delete(message.id);
    await tryDelete(message);
  }, delay);

  if (typeof timer.unref === 'function') timer.unref();

  scheduledTimers.set(message.id, timer);
};

const refreshConfiguredChannels = () => {
  const vars = getBotVariables() || {};
  const ids = new Set();
  for (const key of VAR_KEYS) {
    const raw = vars[key];
    if (!raw) continue;
    for (const id of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      ids.add(id);
    }
  }
  configuredChannelIds = ids;
};

const scanChannelOnStartup = async (client, channelId) => {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      console.warn(`⚠️ Auto-clean: canal ${channelId} no accesible`);
      return;
    }

    const messages = await channel.messages.fetch({ limit: SCAN_LIMIT });
    const now = Date.now();
    let scheduled = 0;
    let immediate = 0;

    for (const msg of messages.values()) {
      if (isProtectedMessage(msg, client)) continue;
      if (msg.pinned) continue;

      const age = now - msg.createdTimestamp;
      if (age >= ONE_HOUR_MS) {
        await tryDelete(msg);
        immediate++;
      } else {
        scheduleDeletion(msg);
        scheduled++;
      }
    }

    console.log(
      `🧹 Auto-clean: canal ${channelId} escaneado → ${scheduled} programado(s), ${immediate} borrado(s) inmediato(s)`
    );
  } catch (err) {
    console.warn(`⚠️ Auto-clean: error escaneando canal ${channelId}:`, err.message);
  }
};

export const initChatAutoClean = async (client) => {
  refreshConfiguredChannels();

  if (configuredChannelIds.size === 0) {
    console.log(`ℹ️ Auto-clean: ninguna de [${VAR_KEYS.join(', ')}] definida, listener inactivo`);
  } else {
    console.log(`🧹 Auto-clean: canales configurados →`, [...configuredChannelIds]);
    for (const id of configuredChannelIds) {
      await scanChannelOnStartup(client, id);
    }
  }

  eventBus.on('botVariableChanged', ({ key }) => {
    if (!VAR_KEYS.includes(key)) return;
    refreshConfiguredChannels();
    if (configuredChannelIds.size > 0) {
      console.log(`🧹 Auto-clean: config actualizada →`, [...configuredChannelIds]);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }

    if (configuredChannelIds.size === 0) return;
    if (!isAutoCleanChannel(message.channel)) return;
    if (isProtectedMessage(message, client)) return;
    if (message.pinned) return;

    scheduleDeletion(message);
  });
};

export const stopChatAutoClean = () => {
  for (const timer of scheduledTimers.values()) {
    clearTimeout(timer);
  }
  scheduledTimers.clear();
};
