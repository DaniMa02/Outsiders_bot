import { addMessage } from './commands/addMessage.js';
import { addVariable } from './commands/addVariable.js';
import { listMessage } from './commands/listMessage.js';
import { listVariable } from './commands/listVariable.js';
import { deleteMessage } from './commands/deleteMessage.js';
import { deleteVariable } from './commands/deleteVariable.js';

import { Client, GatewayIntentBits, Events, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import { query } from './db/database.js';
import https from "https";

EVO: handlers de interacciones
import { handleHellButton } from './interactions/hellButtons.js';
//import { createHellEmbed } from './embeds/hellEmbed.js'; HELLEMBEDIMPORT
// import { syncRolesWithDatabase } from './db/syncRoles.js';
import { handleGuildMemberUpdate } from './listeners/guildMemberUpdate.js';
import { handleGuildMemberUpdateRoles } from './listeners/guildMemberUpdateRoles.js';

// Creacion de los hells automaticamente
import { getOrCreateOpenHell, getAllOpenHells } from './services/hellManager.js';
import { createOrUpdateHellEmbed } from './services/hellEmbedService.js';
// Nuevas variables
import { loadBotVariables, getBotVariables } from './utils/botVariables.js';
// Automatizacion del envio de hell embed
import { startHellScheduler } from './scheduler/hellScheduler.js';
// Cambio de estados del hell
import { initHellLifecycleScheduler, checkAndFixHellStatesOnStartup } from './scheduler/hellLifecycleScheduler.js';


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
// 🔹 NU
// ---------------- Cache ----------------
// let botVariables = {};
let scheduledMessages = [];

// ---------------- Funciones para la base de datos ----------------

// AHORA EN utils/botVariables.js
// const loadBotVariables = async () => {
//   try {
//     const res = await query('SELECT key, value FROM bot_variables');
//     botVariables = {};
//     res.rows.forEach(row => {
//       botVariables[row.key] = row.value;
//     });
//     console.log('✅ Variables del bot cargadas:', botVariables);
//   } catch (err) {
//     console.error('❌ Error cargando variables del bot:', err);
//   }
// };

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

        if (key.toLowerCase().startsWith('role')) {
          return `<@&${value}>`;
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



// ---------------- Comandos ----------------
const commands = [
  addVariable,
  addMessage,
  listMessage,
  listVariable,
  deleteMessage,
  deleteVariable
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
  const botVars = getBotVariables(); // ahora todas las variables están en botVars
  await loadScheduledMessages();
  scheduleAllMessages();
  startHellScheduler(client);
  await checkAndFixHellStatesOnStartup(client);
  initHellLifecycleScheduler(client);


  // -----------------------
  // 🧪 ENVÍO EMBEDS HELL ABIERTOS
  // -----------------------
try {
  // 🔹 Obtenemos todos los Hells abiertos
  const today = new Date().toISOString().split('T')[0];
  const openHells = await getAllOpenHells({ date: today }); // función que devuelve todos los ids de Hells OPEN

  if (openHells.length === 0) {
    console.log('ℹ️ No hay Hells abiertos para hoy');
    return;
  }

  // 🔹 Iteramos y enviamos/actualizamos embeds
  for (const hellId of openHells) {
    await createOrUpdateHellEmbed(client, hellId);
    console.log(`🔥 Embed de Hell ${hellId} enviado correctamente`);
  }

} catch (err) {
  console.error('❌ Error enviando embeds de Hell abiertos:', err);
}
  // syncRolesWithDatabase(client);
  // setInterval(() => { syncRolesWithDatabase(client); }, 10 * 60 * 1000);
});




// ---------------- Interactions ----------------
client.on(Events.InteractionCreate, async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = commands.find(c => c.data.name === interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    }

    // Buttons
    else if (interaction.isButton()) {
      await handleHellButton(interaction);
    }

  } catch (err) {
    console.error('❌ Error en interacción:', err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Error interno', ephemeral: true });
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
//client.login(process.env.TOKEN)
//  .then(() => console.log("Login success"))
//  .catch(console.error);
