// utils/interactionHelpers.js

/**
 * HELPERS PARA INTERACCIONES
 *
 * - withEphemeralAutoDelete(interaction):
 *     Parchea reply/editReply/followUp en la propia interaction para que sus
 *     mensajes efímeros se borren automáticamente a los EPHEMERAL_DELETE_DELAY_MS.
 *     Cubre los tres métodos que pueden enviar un mensaje efímero:
 *       - reply({ ephemeral: true })           → respuesta inicial
 *       - editReply(...) tras deferReply ephemeral → respuesta diferida
 *       - followUp({ ephemeral: true })        → mensajes adicionales
 *
 *     Mutamos la interaction directamente (en vez de Object.create / Proxy)
 *     porque discord.js setea `deferred`/`replied`/`ephemeral` sobre el `this`
 *     del método original. Si envolvemos con un wrapper, el deferReply se
 *     ejecuta con `this === wrapper` y deja el estado en el wrapper, no en la
 *     interaction original → la siguiente editReply falla con InteractionNotReplied.
 *     Mutando la propia interaction (que es de un solo uso) el estado siempre
 *     está en el mismo objeto.
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
 * Parchea una interacción para auto-borrar sus mensajes efímeros.
 * Modifica la interaction in-place y la devuelve.
 * @param {import('discord.js').Interaction} interaction
 * @returns {import('discord.js').Interaction} la misma interaction, ya parchada
 */
export function withEphemeralAutoDelete(interaction) {
  // Guardamos los originales bound a la propia interaction para que `this`
  // dentro del método de discord.js sea SIEMPRE la interaction (no el wrapper)
  const originalReply = interaction.reply.bind(interaction);
  const originalEditReply = interaction.editReply.bind(interaction);
  const originalFollowUp = interaction.followUp.bind(interaction);

  interaction.reply = async function(options) {
    const msg = await originalReply(options);
    if (options?.ephemeral) scheduleEphemeralDeletion(msg);
    return msg;
  };

  interaction.editReply = async function(options) {
    const msg = await originalEditReply(options);
    // Si el deferReply fue con ephemeral, el editReply resultante también lo es
    // (discord.js marca interaction.ephemeral = true en ese caso)
    if (interaction.ephemeral) scheduleEphemeralDeletion(msg);
    return msg;
  };

  interaction.followUp = async function(options) {
    const msg = await originalFollowUp(options);
    if (options?.ephemeral) scheduleEphemeralDeletion(msg);
    return msg;
  };

  return interaction;
}
