import { SlashCommandBuilder } from 'discord.js';
import { query } from '../db/database.js';
import { loadScheduledMessages, scheduleAllMessages } from '../index.js';
import { getBotVariables } from '../utils/botVariables.js';

/**
 * COMANDO: /add_message
 *
 * Campos con autocomplete:
 *   - canal: filtra variables que contienen "CHANNEL" (ej: HELL_CHANNEL_ID)
 *   - roles: filtra variables que contienen "ROLE" (ej: ROLE_TANK, HELL_NOTIFY_ROLE_ID)
 *
 * Se almacenan como `{{KEY}}` en la DB, de modo que sendMessage las
 * resuelve en tiempo de envío. Así, si cambias el ID de la variable,
 * el mensaje programado se actualiza automáticamente.
 *
 * Para múltiples roles, sepáralos por comas: "ROLE_TANK, ROLE_HOLY"
 */
export const addMessage = {
  data: new SlashCommandBuilder()
    .setName('add_message')
    .setDescription('Añade o actualiza un mensaje programado')
    .setDefaultMemberPermissions(null)
    .addIntegerOption(o =>
      o.setName('id')
        .setDescription('ID del mensaje a actualizar (vacío = nuevo)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('canal')
        .setDescription('Variable del canal (autocompletado)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('roles')
        .setDescription('Variables de roles a mencionar, separadas por coma')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('content')
        .setDescription('Contenido del mensaje')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('send_time')
        .setDescription('Hora HH:MM (24h)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('days_of_week')
        .setDescription('Días separados por coma (0=Domingo)')
        .setRequired(false)
    ),

  /**
   * Autocomplete para `canal` y `roles`.
   * Lee de la caché en memoria (loadBotVariables se ejecuta al arrancar
   * y se recarga en addVariable/deleteVariable).
   */
  autocomplete: async (interaction) => {
    const focusedOption = interaction.options.getFocused(true);
    const focused = (focusedOption.value || '').toLowerCase();
    const fieldName = focusedOption.name;

    const botVars = getBotVariables();

    let filtered = Object.keys(botVars);

    if (fieldName === 'canal') {
      filtered = filtered.filter(k => k.toLowerCase().includes('channel'));
    } else if (fieldName === 'roles') {
      filtered = filtered.filter(k => k.toLowerCase().includes('role'));
    }

    filtered = filtered.filter(k => k.toLowerCase().includes(focused));

    const choices = filtered.slice(0, 25).map(k => ({ name: k, value: k }));

    try {
      await interaction.respond(choices);
    } catch {}
  },

  async execute(interaction) {
    const id = interaction.options.getInteger('id');
    const canal = interaction.options.getString('canal');
    const roles = interaction.options.getString('roles');
    const content = interaction.options.getString('content');
    const send_time = interaction.options.getString('send_time');
    const days_of_week = interaction.options.getString('days_of_week');

    try {
      // Validación mínima
      if (!id && !canal && !content && !send_time && !days_of_week && !roles) {
        return await interaction.reply('⚠️ Debes proporcionar al menos un campo (canal, content, send_time, days_of_week, roles).');
      }

      if (!id) {
        if (!canal) return await interaction.reply('⚠️ El campo `canal` es obligatorio para crear un mensaje nuevo.');
        if (!send_time) return await interaction.reply('⚠️ El campo `send_time` es obligatorio para crear un mensaje nuevo.');
      }

      const botVars = getBotVariables();

      // Resolver canal: almacenar como {{KEY}} para que sendMessage lo resuelva
      let resolvedChannelId = null;
      if (canal) {
        if (!botVars[canal]) {
          return await interaction.reply(`❌ Variable de canal \`${canal}\` no encontrada.`);
        }
        resolvedChannelId = `{{${canal}}}`;
      }

      // Resolver roles a {{KEY}} placeholders (se concatenan al inicio del content)
      let rolePrefix = '';
      if (roles) {
        const roleKeys = roles.split(',').map(r => r.trim()).filter(Boolean);
        const placeholders = [];
        for (const key of roleKeys) {
          if (!botVars[key]) {
            return await interaction.reply(`❌ Variable de rol \`${key}\` no encontrada.`);
          }
          placeholders.push(`{{${key}}}`);
        }
        if (placeholders.length > 0) {
          rolePrefix = placeholders.join(' ') + '\n';
        }
      }

      if (id) {
        // UPDATE
        const fields = [];
        const values = [];
        let i = 1;

        // Si el usuario quiere actualizar roles o contenido, hay que manejar
        // la posible presencia de {{ROLE_X}} al inicio del content
        if (roles !== null || content !== null) {
          // Leer contenido actual
          const existing = await query('SELECT content FROM scheduled_messages WHERE id = $1', [id]);
          if (existing.rowCount === 0) {
            return await interaction.reply(`❌ No existe ningún mensaje con ID ${id}.`);
          }
          let currentContent = existing.rows[0].content || '';

          // Extraer y quitar el bloque de menciones de roles existente
          const roleMatch = currentContent.match(/^(\{\{[^}]+\}\}\s*)+\n?/);
          const existingRolePrefix = roleMatch ? roleMatch[0] : '';
          const stripped = currentContent.replace(/^(\{\{[^}]+\}\}\s*)+\n?/, '');

          // Si el usuario pasa nuevo content, usarlo; si no, mantener el stripped
          const newText = content !== null ? content : stripped;

          // Si el usuario pasa nuevos roles, usar el nuevo; si no, mantener el existente
          const finalRolePrefix = roles !== null ? rolePrefix : existingRolePrefix;

          const finalContent = finalRolePrefix + newText;

          fields.push(`content = $${i++}`);
          values.push(finalContent);
        }

        if (resolvedChannelId) {
          fields.push(`channel_id = $${i++}`);
          values.push(resolvedChannelId);
        }
        if (send_time) {
          fields.push(`send_time = $${i++}`);
          values.push(send_time);
        }
        if (days_of_week) {
          fields.push(`days_of_week = $${i++}`);
          values.push(days_of_week);
        }

        if (fields.length === 0) {
          return await interaction.reply('⚠️ No has proporcionado ningún campo para actualizar.');
        }

        values.push(id);
        const result = await query(`
          UPDATE scheduled_messages
          SET ${fields.join(', ')}
          WHERE id = $${i}
          RETURNING *;
        `, values);

        if (result.rowCount === 0) {
          return await interaction.reply(`❌ No existe ningún mensaje con ID ${id}.`);
        }

        await loadScheduledMessages();
        scheduleAllMessages();

        return await interaction.reply(`✅ Mensaje con ID ${id} actualizado.`);
      } else {
        // INSERT
        const finalContent = rolePrefix + (content || '');

        await query(`
          INSERT INTO scheduled_messages (content, channel_id, send_time, days_of_week)
          VALUES ($1, $2, $3, $4);
        `, [finalContent, resolvedChannelId, send_time, days_of_week]);

        await loadScheduledMessages();
        scheduleAllMessages();

        return await interaction.reply(`✅ Mensaje programado correctamente.`);
      }
    } catch (err) {
      console.error('❌ Error en add_message:', err);
      await interaction.reply('❌ Error al programar o actualizar el mensaje');
    }
  },
};
