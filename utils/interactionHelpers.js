// utils/interactionHelpers.js

/**
 * HELPERS PARA INTERACCIONES
 *
 * - withEphemeralAutoDelete(interaction):
 *     Envuelve una interacción para que sus mensajes efímeros se borren
 *     automáticamente después de EPHEMERAL_DELETE_DELAY_MS. Cubre los tres
 *     métodos que pueden enviar un mensaje efímero:
 *       - reply({ ephemeral: true })           → respuesta inicial
 *       - editReply(...) tras deferReply ephemeral → respuesta diferida
 *       - followUp({ ephemeral: true })        → mensajes adicionales
 *
 *     El resto de propiedades y métodos se delegan al objeto original vía
 *     prototype chain, por lo que es totalmente transparente para los handlers.
 *     Solo hay que envolver la interacción en el dispatcher (index.js) una vez.
 */

export const EPHEMERAL_DELETE_DELAY_MS = 10000; // 10 segundos

/**
 * Programa el borrado de un mensaje efímero tras EPHEMERAL_DELETE_DELAY_MS.
 * - Si el mensaje ya no existe (10008) o la interacción expiró (50027), se ignora.
 * - El setTimeout se unref() para no bloquear el cierre del proceso.
 */
function scheduleEphemeralDeletion(message) {
  if (!message) return;

  const timer = setTimeout(async () => {
    try {
      await message.delete();
    } catch (err) {
      // 10008 = Unknown Message (ya borrado), 50027 = Invalid Webhook Token (interacción expirada)
      if (err.code !== 10008 && err.code !== 50027) {
        console.warn('⚠️ No se pudo borrar mensaje efímero:', err.message);
      }
    }
  }, EPHEMERAL_DELETE_DELAY_MS);

  if (timer.unref) timer.unref();
}

/**
 * Envuelve una interacción para auto-borrar sus mensajes efímeros.
 * @param {import('discord.js').Interaction} interaction
 * @returns {Proxy} interacción envuelta (mismo aspecto, métodos parchados)
 */
export function withEphemeralAutoDelete(interaction) {
  const wrapped = Object.create(interaction);

  wrapped.reply = async (options) => {
    const msg = await interaction.reply(options);
    if (options?.ephemeral) scheduleEphemeralDeletion(msg);
    return msg;
  };

  wrapped.editReply = async (options) => {
    const msg = await interaction.editReply(options);
    // Si el deferReply fue con ephemeral, el editReply resultante también lo es
    // (discord.js marca interaction.ephemeral = true en ese caso)
    if (interaction.ephemeral) scheduleEphemeralDeletion(msg);
    return msg;
  };

  wrapped.followUp = async (options) => {
    const msg = await interaction.followUp(options);
    if (options?.ephemeral) scheduleEphemeralDeletion(msg);
    return msg;
  };

  return wrapped;
}
