// ==================== COMANDOS ====================
import { addMessage } from './commands/addMessage.js';
import { addVariable } from './commands/addVariable.js';
import { listMessage } from './commands/listMessage.js';
import { listVariable } from './commands/listVariable.js';
import { deleteMessage } from './commands/deleteMessage.js';
import { deleteVariable } from './commands/deleteVariable.js';
import { createEvent } from './commands/createEvent.js';
import { restoreEvent } from './commands/restoreEvent.js';

// ==================== DISCORD.JS ====================
import { Client, GatewayIntentBits, Events, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import { query } from './db/database.js';
import https from "https";

// ==================== INTERACCIONES ====================
import { handleEventButton, handleEventModalSubmit, handleAddRoleSelect, handleMoveSelect, handleMoveConfirm, handleEditModalSubmit } from './interactions/eventButtons.js';

// ==================== LISTENERS ====================
import { handleGuildMemberUpdate } from './listeners/guildMemberUpdate.js';
import { handleGuildMemberUpdateRoles } from './listeners/guildMemberUpdateRoles.js';

// ==================== SERVICIOS ====================
import { createOrUpdateEventEmbed } from './services/eventEmbedService.js';

// ==================== UTILITIES ====================
import { loadBotVariables, getBotVariables } from './utils/botVariables.js';
import { loadOpenEventsCache } from './utils/eventCache.js';
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
  restoreEvent
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

    const hasChanges =
      existingCommands.length !== newCommands.length ||
      existingCommands.some((cmd, i) => JSON.stringify(cmd) !== JSON.stringify(newCommands[i]));

    if (hasChanges) {
      await rest.put(
        Routes.applicationGuildCommands(client.application.id, guildId),
        { body: newCommands }
      );
      console.log(`✅ Comandos actualizados en el servidor ${guildId}`);
    } else {
      console.log('ℹ️ Comandos ya registrados, sin cambios.');
    }
  } catch (err) {
    console.error('❌ Error registrando comandos:', err);
  }

  // --- Cargar datos ---
  await loadBotVariables();
  const botVars = getBotVariables();
  await loadOpenEventsCache();
  await loadScheduledMessages();
  scheduleAllMessages();

  // ==================== EVENTS SCHEDULER ====================
  initEventLifecycleScheduler(client);
  initEmbedCleanupScheduler(client);
  await checkAndFixEventStatesOnStartup(client);
  await loadScheduledReminders(client);
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

client.on(Events.GuildMemberUpdate, handleGuildMemberUpdate);
client.on(Events.GuildMemberUpdate, handleGuildMemberUpdateRoles(client));


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
