import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
const clientId = process.env.CLIENT_ID;

if (!clientId) {
  console.error('❌ ERROR: Falta CLIENT_ID en el archivo .env');
  process.exit(1);
}

// Pequeña utilidad para pedir confirmación por consola
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question) => new Promise(resolve => rl.question(question, resolve));

async function cleanupGlobalCommands() {
  try {
    console.log('🔍 Obteniendo comandos globales...');
    const commands = await rest.get(Routes.applicationCommands(clientId));

    if (commands.length === 0) {
      console.log('✅ No hay comandos globales registrados.');
      rl.close();
      return;
    }

    console.log(`📋 Se encontraron ${commands.length} comandos globales:\n`);
    commands.forEach(cmd => {
      console.log(`• ${cmd.name} (ID: ${cmd.id})`);
    });

    const answer = await ask('\n¿Deseas eliminar TODOS los comandos globales? (yes/no): ');

    if (answer.toLowerCase() === 'yes') {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log('🧹 Todos los comandos globales han sido eliminados.');
    } else {
      console.log('❎ Cancelado. No se eliminaron comandos.');
    }

  } catch (err) {
    console.error('❌ Error limpiando comandos:', err);
  } finally {
    rl.close();
  }
}

cleanupGlobalCommands();
