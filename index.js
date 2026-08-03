// ==================== COMANDOS ====================
import { addMessage } from './commands/addMessage.js';
import { addVariable } from './commands/addVariable.js';
import { listMessage } from './commands/listMessage.js';
import { listVariable } from './commands/listVariable.js';
import { deleteMessage } from './commands/deleteMessage.js';
import { deleteVariable } from './commands/deleteVariable.js';
import { createEvent } from './commands/createEvent.js';
import { restoreEvent } from './commands/restoreEvent.js';
import { debugMyPermissions } from './commands/debugMyPermissions.js';

// ==================== DISCORD.JS ====================
import { Client, GatewayIntentBits, Events, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import { query } from './db/database.js';
import https from "https";

// ==================== INTERACCIONES ====================
import { handleEventButton, handleEventModalSubmit, handleAddRoleSelect, handleMoveSelect, handleMoveConfirm, handleEditModalSubmit, handleRemoveSelect, handleRemoveConfirm } from './interactions/eventButtons.js';

// ==================== LISTENERS ====================
import { handleGuildMemberUpdate } from './listeners/guildMemberUpdate.js';
import { initChatAutoClean } from './listeners/chatAutoClean.js';

// ==================== SERVICIOS ====================
import { createOrUpdateEventEmbed } from './services/eventEmbedService.js';

// ==================== UTILITIES ====================
import { loadBotVariables, getBotVariables } from './utils/botVariables.js';
import { loadEventsCache } from './utils/eventCache.js';
import { withEphemeralAutoDelete } from './utils/interactionHelpers.js';

// ==================== SCHEDULER ====================
import { initEventLifecycleScheduler, checkAndFixEventStatesOnStartup, initEmbedCleanupScheduler } from './scheduler/eventLifecycleScheduler.js';
import { loadScheduledReminders } from './utils/eventReminders.js';


dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,

  ],
});

//DEBUGG
console.log("LOGIN START");

client.login(process.env.TOKEN)
  .then(() => console.log("Login success"))
  .catch(console.error);

console.log("LOGIN END");

https.get("https://discord.com/api/v10/gateway", res => {
  console.log("Gateway status:", res.statusCode);
});

// ---------------- Cache ----------------
let scheduledMessages = [];

const loadScheduledMessages = async () => {
  try {
    const res = await query('SELECT * FROM scheduled_messages');
    scheduledMessages = res.rows;
    console.log('🕐 Mensajes programados cargados:', scheduledMessages.length);
  } catch (err) {
    console.error('❌ Error cargando mensajes programados:', err);
  }
};

// ---------------- Función genérica para enviar mensajes ----------------
const DISCORD_ID_RE = /^\d{17,20}$/;

const sendMessage = async (channelId, content, botVars) => {
  try {
    const resolvedChannelId = channelId.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return botVars[key] || `{{${key}}}`;
    });

    const channel = await client.channels.fetch(resolvedChannelId.trim());
    if (!channel) return;

    const finalContent = content
      .replace(/\\n/g, '\n')
      .replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const now = new Date();
        const daysES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const daysEN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        switch (key) {
          case 'DIA_SEMANA': return daysES[now.getDay()];
          case 'DIA_SIGUIENTE': return daysES[(now.getDay() + 1) % 7];
          case 'DIA_SEMANA_ENG': return daysEN[now.getDay()];
          case 'DIA_SIGUIENTE_ENG': return daysEN[(now.getDay() + 1) % 7];
        }

        const value = botVars[key];
        if (!value) return `{{${key}}}`;

        if (DISCORD_ID_RE.test(value)) {
          const k = key.toLowerCase();
          if (k.includes('channel')) return `<#${value}>`;
          if (k.includes('role')) return `<@&${value}>`;
          return `<@${value}>`;
        }

        return value;
      });

    await channel.send(finalContent);
  } catch (err) {
    console.error('❌ Error enviando mensaje:', err);
  }
};


// ---------------- Scheduler mensajes ----------------
const scheduleAllMessages = () => {
  const botVars = getBotVariables();

  if (!botVars || Object.keys(botVars).length === 0) {
    console.warn('⚠️ Bot variables no cargadas, no se programan mensajes');
    return;
  }

  cron.getTasks().forEach(task => task.stop());

  scheduledMessages.forEach(msg => {
    if (!msg.send_time || !msg.days_of_week) return;

    const [hourStr, minuteStr] = msg.send_time.split(':');
    const hour = parseInt(hourStr);
    const minute = parseInt(minuteStr);

    const cronDays = msg.days_of_week
      .split(',')
      .map(d => d.trim())
      .filter(Boolean)
      .join(',');

    const cronPattern = `${minute} ${hour} * * ${cronDays}`;

    cron.schedule(
      cronPattern,
      () => sendMessage(msg.channel_id, msg.content, botVars),
      { timezone: 'Europe/Madrid' }
    );
  });
};



// ==================== REGISTRAR COMANDOS ====================
const commands = [
  // Mensajes y variables
  addVariable,
  addMessage,
  listMessage,
  listVariable,
  deleteMessage,
  deleteVariable,

  // Events
  createEvent,
  restoreEvent,

  // Debug
  debugMyPermissions
];

// ---------------- Client Ready ----------------

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  const guildId = process.env.GUILD_ID;

  try {
    // --- Obtener comandos registrados ---
    const existingCommands = await rest.get(
      Routes.applicationGuildCommands(client.application.id, guildId)
    );

    const newCommands = commands.map(c => c.data.toJSON());

    // Comparar por nombre (no por índice): Discord puede devolver los
    // comandos en otro orden al que se enviaron, lo que hacía que la
    // detección basada en índice diese falsos positivos y, peor aún, que
    // un default_member_permissions cacheado NO se detectase como cambio
    // si coincidía la posición.
    const existingByName = new Map(existingCommands.map(cmd => [cmd.name, cmd]));
    const newByName = new Map(newCommands.map(cmd => [cmd.name, cmd]));

    let hasChanges = existingByName.size !== newByName.size;
    if (!hasChanges) {
      for (const [name, newCmd] of newByName) {
        const existingCmd = existingByName.get(name);
        if (!existingCmd || JSON.stringify(existingCmd) !== JSON.stringify(newCmd)) {
          hasChanges = true;
          break;
        }
      }
    }

    if (hasChanges) {
      await rest.put(
        Routes.applicationGuildCommands(client.application.id, guildId),
        { body: newCommands }
      );
      console.log(`✅ Comandos actualizados en el servidor ${guildId} (${newCommands.length} comandos)`);
    } else {
      console.log('ℹ️ Comandos ya registrados, sin cambios.');
    }
  } catch (err) {
    console.error('❌ Error registrando comandos:', err);
  }

  // --- Cargar datos ---
  await loadBotVariables();
  const botVars = getBotVariables();
  await loadEventsCache();
  await loadScheduledMessages();
  scheduleAllMessages();

  // ==================== ONE-TIME SYNC ====================
  // Si RUN_SYNC=1 en .env, ejecuta la sincronización inicial de
  // users + user_role_capabilities y avisa al final. Cuando termine,
  // quitar la variable de .env y reiniciar.
  if (process.env.RUN_SYNC === '1') {
    try {
      const { runOneTimeSync } = await import('./utils/oneTimeSync.js');
      await runOneTimeSync(client);
    } catch (err) {
      console.error('❌ [SYNC] Error durante la sincronización:', err);
    }
  }

  // ==================== EVENTS SCHEDULER ====================
  initEventLifecycleScheduler(client);
  initEmbedCleanupScheduler(client);
  await checkAndFixEventStatesOnStartup(client);
  await loadScheduledReminders(client);
  // await initChatAutoClean(client); // DESACTIVADO: auto-clean de mensajes >1h en RAID/HELL/HARDCORE
});




// ---------------- Interactions ----------------
client.on(Events.InteractionCreate, async interaction => {
  // Envolver para auto-borrar mensajes efímeros a los 10s
  const interaction$ = withEphemeralAutoDelete(interaction);

  try {
    // Slash commands
    if (interaction$.isChatInputCommand()) {
      const command = commands.find(c => c.data.name === interaction$.commandName);
      if (!command) return;
      await command.execute(interaction$);
    }

    // Autocomplete (de slash commands)
    else if (interaction$.isAutocomplete()) {
      const command = commands.find(c => c.data.name === interaction$.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction$);
      }
    }

    // Buttons
    else if (interaction$.isButton()) {
      if (interaction$.customId.startsWith('event_')) {
        if (interaction$.customId.startsWith('event_move_confirm:')) {
          await handleMoveConfirm(interaction$);
        } else if (interaction$.customId.startsWith('event_remove_confirm:')) {
          await handleRemoveConfirm(interaction$);
        } else {
          await handleEventButton(interaction$);
        }
      }
    }

    // StringSelectMenu (selects de rol en flujos manuales)
    else if (interaction$.isStringSelectMenu()) {
      if (interaction$.customId.startsWith('event_add_role:')) {
        await handleAddRoleSelect(interaction$);
      } else if (interaction$.customId.startsWith('event_move_select_')) {
        await handleMoveSelect(interaction$);
      } else if (interaction$.customId.startsWith('event_remove_select_')) {
        await handleRemoveSelect(interaction$);
      }
    }

    // Modal submits (gestión manual + editar evento)
    else if (interaction$.isModalSubmit()) {
      if (interaction$.customId.startsWith('event_modal_edit:')) {
        await handleEditModalSubmit(interaction$);
      } else if (interaction$.customId.startsWith('event_modal_')) {
        await handleEventModalSubmit(interaction$);
      }
    }

  } catch (err) {
    console.error('❌ Error en interacción:', err);
    try {
      if (!interaction$.replied && !interaction$.deferred) {
        await interaction$.reply({ content: '❌ Error interno', ephemeral: true });
      } else if (interaction$.deferred && !interaction$.replied) {
        const expired = err?.code === 50027 || err?.message?.includes('Invalid Webhook Token');
        await interaction$.editReply({
          content: expired
            ? '❌ La interacción expiró. Vuelve a intentarlo.'
            : '❌ Error interno'
        });
      }
    } catch (innerErr) {
      console.error('❌ No se pudo responder al usuario:', innerErr);
    }
  }
});


// DEBUGS

client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("disconnect", () => {
  console.log("❌ Bot disconnected");
});

client.on("reconnecting", () => {
  console.log("🔄 Reconnecting...");
});

client.on("shardDisconnect", (event, id) => {
  console.log("Shard disconnected", id);
});

client.on("error", console.error);

client.on('rateLimit', (info) => {
  console.warn('Rate limit alcanzado:', info);
});

// ---------------- Guild Member Update ----------------

// Un único listener unificado: clase + nickname + capabilities + recálculo
// de eventos, con debounce y comparaciones para no escribir si nada cambió.
client.on(Events.GuildMemberUpdate, handleGuildMemberUpdate(client));


// ---------------- Express ----------------
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot activo ✅'));
app.listen(PORT, () => console.log(`🌐 Web escuchando en ${PORT}`));

// ---------------- Exports ----------------
export { loadScheduledMessages, scheduleAllMessages };

// ---------------- Login ----------------
console.log("TOKEN:", process.env.TOKEN);

// ---------------- Graceful shutdown ----------------
const shutdown = async (signal) => {
  console.log(`🛑 Señal ${signal} recibida, cerrando conexiones limpiamente...`);
  try {
    if (client && client.isReady()) {
      client.destroy();
      console.log('✅ Cliente Discord cerrado');
    }
  } catch (err) {
    console.error('❌ Error cerrando cliente Discord:', err.message);
  }
  try {
    const { pool } = await import('./db/database.js');
    await pool.end();
    console.log('✅ Pool Postgres cerrado');
  } catch (err) {
    console.error('❌ Error cerrando pool Postgres:', err.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
