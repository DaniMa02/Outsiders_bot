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
    // --- Reemplazo dinámico de variables también en el canal ---
    const resolvedChannelId = channelId.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return botVariables[key] || `{{${key}}}`; // si no existe la variable, deja el marcador
    });

    const channel = await client.channels.fetch(resolvedChannelId.trim());
    if (!channel) return console.log(`⚠️ Canal no encontrado: ${resolvedChannelId}`);

    // --- Reemplazo dinámico de variables en el contenido ---
    const finalContent = content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = botVariables[key];
      if (!value) return `{{${key}}}`;

      // Si la variable empieza por "role", se interpreta como un rol
      if (key.toLowerCase().startsWith('role')) {
        return `<@&${value}>`; // formato de mención a rol
      }

      return value;
    });

    await channel.send(finalContent);
    console.log(`✅ Mensaje enviado al canal ${resolvedChannelId}: ${finalContent}`);
  } catch (err) {
    console.error(`❌ Error enviando mensaje al canal ${channelId}:`, err);
  }
};




/* // ---------------- Función para programar mensajes con cron ----------------
const scheduleAllMessages = () => {
  scheduledMessages.forEach(msg => {
    const [hour, minute] = msg.send_time.split(':');
    const days = msg.days_of_week.split(',');
    days.forEach(day => {
      const cronPattern = `${minute} ${hour} * * ${day}`;
      cron.schedule(cronPattern, () => {
        sendMessage(msg.channel_id, msg.content);
      });
    });
  });
  console.log('🕐 Todos los mensajes programados en cron jobs');
}; */
// ---------------- Función para programar mensajes con cron ----------------
const scheduleAllMessages = () => {
  // Cancelar tareas anteriores para evitar duplicados al recargar
  cron.getTasks().forEach(task => task.stop());

  scheduledMessages.forEach(msg => {
    try {
      if (!msg.send_time || !msg.days_of_week) {
        console.warn(`⚠️ Mensaje con ID ${msg.id} tiene hora o días vacíos, se omite.`);
        return;
      }

      const [hourStr, minuteStr] = msg.send_time.trim().split(':');
      const hour = parseInt(hourStr, 10);
      const minute = parseInt(minuteStr, 10);

      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        console.error(`❌ Formato de hora inválido para el mensaje ID ${msg.id}: "${msg.send_time}"`);
        return;
      }

      const cronDays = msg.days_of_week
        .split(',')
        .map(d => d.trim())
        .filter(d => d !== '' && !isNaN(parseInt(d)))
        .join(',');

      if (!cronDays) {
        console.error(`❌ Días de la semana inválidos para mensaje ID ${msg.id}: "${msg.days_of_week}"`);
        return;
      }

      const cronPattern = `${minute} ${hour} * * ${cronDays}`;

      cron.schedule(cronPattern, () => {
        sendMessage(msg.channel_id, msg.content);
      });

      console.log(`✅ Cron creado para mensaje ID ${msg.id} (${msg.send_time} días: ${cronDays})`);
    } catch (err) {
      console.error(`❌ Error creando cron para mensaje ID ${msg.id}:`, err);
    }
  });

  console.log('🕐 Todos los mensajes programados en cron jobs');
};
// ---------------- Comandos de Discord ----------------
const commands = [
  addVariable,
  addMessage,
  listMessage,
  listVariable,
  deleteMessage,
  deleteVariable
];



// ---------------- Evento clientReady ----------------
/* client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);

  // --- Registrar comandos aquí, después de que client.application exista ---
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const guildId = process.env.GUILD_ID; // <-- pon aquí el ID de tu servidor de Discord

    await rest.put(
        Routes.applicationGuildCommands(client.application.id, guildId),
        { body: commands.map(c => c.toJSON()) }
);
    console.log(`✅ Comandos registrados en el servidor ${guildId}`);

  } catch (err) {
    console.error('❌ Error registrando comandos:', err);
  }

  // --- Cargar variables y mensajes ---
  await loadBotVariables();
  await loadScheduledMessages();
  scheduleAllMessages();
}); */

/* // ---------------- Evento clientReady ----------------
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  const guildId = process.env.GUILD_ID;

  try {
    // --- Obtener comandos actuales ---
    const existingCommands = await rest.get(
      Routes.applicationGuildCommands(client.application.id, guildId)
    );

    // --- Convertir tus comandos a formato JSON ---
    const newCommands = commands.map(c => c.toJSON());

    // --- Comparar para evitar duplicados ---
    const hasChanges =
      existingCommands.length !== newCommands.length ||
      existingCommands.some((cmd, i) => JSON.stringify(cmd) !== JSON.stringify(newCommands[i]));

    if (hasChanges) {
      await rest.put(
        Routes.applicationGuildCommands(client.application.id, guildId),
        { body: newCommands.map(c => c.data.toJSON()) }
      );
      console.log(`✅ Comandos actualizados en el servidor ${guildId}`);
    } else {
      console.log('ℹ️ Los comandos ya están registrados correctamente, sin duplicados.');
    }

  } catch (err) {
    console.error('❌ Error registrando comandos:', err);
  }

  // --- Cargar variables y mensajes ---
  await loadBotVariables();
  await loadScheduledMessages();
  scheduleAllMessages();
}); */

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  const guildId = process.env.GUILD_ID;

  try {
    // --- Obtener los comandos registrados actualmente ---
    const existingCommands = await rest.get(
      Routes.applicationGuildCommands(client.application.id, guildId)
    );

    // --- Convertir tus comandos a JSON usando .data.toJSON() ---
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
      console.log('ℹ️ Los comandos ya están registrados correctamente, sin duplicados.');
    }

  } catch (err) {
    console.error('❌ Error registrando comandos:', err);
  }

  // --- Cargar variables y mensajes ---
  await loadBotVariables();
  await loadScheduledMessages();
  scheduleAllMessages();
});


// ---------------- Manejo dinámico de comandos ----------------
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isCommand()) return;

  // 🧩 DEBUG: mostrar los comandos cargados y sus nombres
  console.log("📦 Comandos cargados:");
  commands.forEach((c, i) => {
    console.log(i, c?.data?.name ?? "❌ sin data");
  });

  const command = commands.find(c => c.data.name === interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Error ejecutando el comando ${interaction.commandName}:`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ Error interno al ejecutar el comando.');
    } else {
      await interaction.reply('❌ Error interno al ejecutar el comando.');
    }
  }
});


// ---------------- Express para Render ----------------
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot activo ✅'));
app.listen(PORT, () => console.log(`🌐 Servidor web escuchando en puerto ${PORT}`));

// ---------------- Exportaciones para otros módulos ----------------
export { loadScheduledMessages, scheduleAllMessages, loadBotVariables };

// ---------------- Login ----------------
client.login(process.env.TOKEN);
