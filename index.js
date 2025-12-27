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

// 🔹 NUEVO: handlers de interacciones
import { handleHellButton } from './interactions/hellButtons.js';
import { handleHellSelect } from './interactions/hellSelects.js';
import { createHellEmbed } from './embeds/hellEmbed.js';
import { syncRolesWithDatabase } from './db/syncRoles.js';


dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---------------- Cache ----------------
let botVariables = {};
let scheduledMessages = [];

// ---------------- Funciones para la base de datos ----------------
const loadBotVariables = async () => {
  try {
    const res = await query('SELECT key, value FROM bot_variables');
    botVariables = {};
    res.rows.forEach(row => {
      botVariables[row.key] = row.value;
    });
    console.log('✅ Variables del bot cargadas:', botVariables);
  } catch (err) {
    console.error('❌ Error cargando variables del bot:', err);
  }
};

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
const sendMessage = async (channelId, content) => {
  try {
    const resolvedChannelId = channelId.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return botVariables[key] || `{{${key}}}`;
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

        const value = botVariables[key];
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
  cron.getTasks().forEach(task => task.stop());

  scheduledMessages.forEach(msg => {
    if (!msg.send_time || !msg.days_of_week) return;

    const [hourStr, minuteStr] = msg.send_time.split(':');
    const hour = parseInt(hourStr);
    const minute = parseInt(minuteStr);

    const cronDays = msg.days_of_week
      .split(',')
      .map(d => d.trim())
      .filter(d => d !== '')
      .join(',');

    const cronPattern = `${minute} ${hour} * * ${cronDays}`;

    cron.schedule(cronPattern, () => {
      sendMessage(msg.channel_id, msg.content);
    }, { timezone: 'Europe/Madrid' });
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

    // --- Convertir comandos actuales ---
    const newCommands = commands.map(c => c.data.toJSON());

    // --- Comparar para evitar duplicados ---
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
  await loadScheduledMessages();
  scheduleAllMessages();

  // -----------------------
  // 🧪 ENVÍO EMBED HELL TEST
  // -----------------------
  try {
    // 👉 Usa una variable del bot o pon el ID directamente
    const hellChannelId = botVariables.TEST_CHANNEL; // o '123456789...'

    if (!hellChannelId) {
      console.warn('⚠️ HELL_CHANNEL no está definido en bot_variables');
      return;
    }

    const channel = await client.channels.fetch(hellChannelId);
    if (!channel) {
      console.warn('⚠️ Canal de Hell no encontrado');
      return;
    }

await createHellEmbed(channel);

    console.log('🔥 Embed de Hell enviado correctamente');

  } catch (err) {
    console.error('❌ Error enviando embed de Hell:', err);
  }
    syncRolesWithDatabase(client);

  // 🔹 Llamadas periódicas cada 10 minutos
  setInterval(() => {
    syncRolesWithDatabase(client);
  }, 10 * 60 * 1000); // 10 min
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

    // Select menus
    else if (interaction.isStringSelectMenu()) {
      await handleHellSelect(interaction);
    }

  } catch (err) {
    console.error('❌ Error en interacción:', err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Error interno', ephemeral: true });
    }
  }
});

// ---------------- Express ----------------
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot activo ✅'));
app.listen(PORT, () => console.log(`🌐 Web escuchando en ${PORT}`));

// ---------------- Exports ----------------
export { loadScheduledMessages, scheduleAllMessages, loadBotVariables };

// ---------------- Login ----------------
client.login(process.env.TOKEN);
