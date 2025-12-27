import { setUserClass, addUserRoleCapability, toggleParticipantAbsence } from '../db/hellRepository.js';
import { MessageFlagsBitField } from 'discord.js';

// Mapeo de clases a roles de Discord (rellena con los IDs de tus roles)
const classRoleIds = {
  ARCHER: '1453435742855364752',
  SWORDSMAN: '1453436355467153409',
  MAGE: '1453436274269753649',
  MARTIAL_ARTIST: '1453436495460306944'
};

export const handleHellButton = async (interaction) => {
  const { customId, user, guild } = interaction;

  try {
    // ---------------- Botones de clase ----------------
    if (customId.startsWith('class_')) {
      const chosenClass = customId.split('_')[1].toUpperCase();
      await setUserClass(user.id, chosenClass);

      // 🔹 Asignar rol en Discord
      const guildMember = await guild.members.fetch(user.id);
      if (guildMember) {
        // Elimina roles de clase anteriores
        for (const roleId of Object.values(classRoleIds)) {
          if (guildMember.roles.cache.has(roleId) && roleId !== classRoleIds[chosenClass]) {
            await guildMember.roles.remove(roleId).catch(console.error);
          }
        }
        // Añade el nuevo rol
        const newRoleId = classRoleIds[chosenClass];
        if (newRoleId && !guildMember.roles.cache.has(newRoleId)) {
          await guildMember.roles.add(newRoleId).catch(console.error);
        }
      }

      return interaction.reply({
        content: `⚔️ ${user.username}, tu clase se ha asignado: **${chosenClass}**`,
        flags: MessageFlagsBitField.Ephemeral
      });
    }

    // ---------------- Botones de rol ----------------
    if (customId.startsWith('role_')) {
      const chosenRole = customId.split('_')[1].toUpperCase();
      await addUserRoleCapability(user.id, chosenRole);

      return interaction.reply({
        content: `🛡️ ${user.username}, tu rol elegido para Hell ha sido registrado: **${chosenRole}**`,
        flags: MessageFlagsBitField.Ephemeral
      });
    }

    // ---------------- Botón de absence ----------------
    if (customId === 'hell_absence') {
      const hellId = 1; // TEMPORAL: reemplaza por ID real según embed
      await toggleParticipantAbsence(hellId, user.id);

      return interaction.reply({
        content: `❌ ${user.username}, tu estado de **absence** ha sido actualizado`,
        flags: MessageFlagsBitField.Ephemeral
      });
    }

    // ---------------- Botón no reconocido ----------------
    return interaction.reply({
      content: '❓ Botón no reconocido',
      flags: MessageFlagsBitField.Ephemeral
    });

  } catch (err) {
    console.error('❌ Error manejando botón:', err);
    if (!interaction.replied) {
      return interaction.reply({ content: '❌ Error interno', flags: MessageFlagsBitField.Ephemeral });
    }
  }
};
