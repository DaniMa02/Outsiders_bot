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
 *
 *     El borrado se hace vía `interaction.webhook.deleteMessage(messageId)` en
 *     vez de `message.delete()` porque el webhook de la interacción es la
 *     vía correcta (y siempre disponible) para borrar replies, mientras que
 *     `message.delete()` depende de que `message.channel` resuelva bien, lo
 *     cual no siempre es fiable para mensajes efímeros de interacción.
 */

export const EPHEMERAL_DELETE_DELAY_MS = 10000; // 10 segundos

/**
 * Programa el borrado de un mensaje efímero tras EPHEMERAL_DELETE_DELAY_MS
 * usando el webhook de la interaction (más fiable que message.delete()).
 * - Si el mensaje ya no existe (10008) o la interacción expiró (50027), se ignora.
 * - El setTimeout se unref() para no bloquear el cierre del proceso.
 */
function scheduleEphemeralDeletion(interaction, message) {
  if (!message?.id) return;

  const messageId = message.id;

  const timer = setTimeout(async () => {
    try {
      await interaction.webhook.deleteMessage(messageId);
    } catch (err) {
      // 10008 = Unknown Message (ya borrado), 50027 = Invalid Webhook Token (interacción expirada)
      if (err.code !== 10008 && err.code !== 50027) {
        console.warn(`⚠️ No se pudo borrar mensaje efímero ${messageId}:`, err.message);
      }
    }
  }, EPHEMERAL_DELETE_DELAY_MS);

  if (timer.unref) timer.unref();
}

/**
 * Parchea una interacción para auto-borrar sus mensajes efímeros.
 * Modifica la interaction in-place y la devuelve.
 *
 * Solo parchea los métodos que existan en la interaction. Las
 * AutocompleteInteraction no tienen `reply`/`editReply`/`followUp`
 * (usan `respond`), así que las dejamos pasar sin tocar para que el
 * wrapper no pete con "Cannot read properties of undefined (reading 'bind')".
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {import('discord.js').Interaction} la misma interaction, ya parchada
 */
export function withEphemeralAutoDelete(interaction) {
  // Guardamos los originales bound a la propia interaction para que `this`
  // dentro del método de discord.js sea SIEMPRE la interaction (no el wrapper)

  if (typeof interaction.reply === 'function') {
    const originalReply = interaction.reply.bind(interaction);
    interaction.reply = async function(options = {}) {
      // Soportar llamada con string suelto: reply('hola')
      if (typeof options === 'string') options = { content: options };
      // Necesitamos el Message para poder borrarlo. Si el caller no pidió
      // explícitamente fetchReply:false y el mensaje es efímero, añadimos
      // fetchReply:true para que discord.js nos devuelva el Message.
      if (options.ephemeral && options.fetchReply === undefined) {
        const msg = await originalReply({ ...options, fetchReply: true });
        scheduleEphemeralDeletion(interaction, msg);
        return msg;
      }
      return originalReply(options);
    };
  }

  if (typeof interaction.editReply === 'function') {
    const originalEditReply = interaction.editReply.bind(interaction);
    interaction.editReply = async function(options = {}) {
      // Soportar llamada con string suelto: editReply('hola')
      if (typeof options === 'string') options = { content: options };
      // Tras un deferReply({ephemeral:true}), el editReply resultante es efímero.
      // Discord.js marca interaction.ephemeral=true en ese caso.
      if (interaction.ephemeral && options.fetchReply === undefined) {
        const msg = await originalEditReply({ ...options, fetchReply: true });
        scheduleEphemeralDeletion(interaction, msg);
        return msg;
      }
      return originalEditReply(options);
    };
  }

  if (typeof interaction.followUp === 'function') {
    const originalFollowUp = interaction.followUp.bind(interaction);
    interaction.followUp = async function(options = {}) {
      // Soportar llamada con string suelto: followUp('hola')
      if (typeof options === 'string') options = { content: options };
      if (options.ephemeral && options.fetchReply === undefined) {
        const msg = await originalFollowUp({ ...options, fetchReply: true });
        scheduleEphemeralDeletion(interaction, msg);
        return msg;
      }
      return originalFollowUp(options);
    };
  }

  return interaction;
}
