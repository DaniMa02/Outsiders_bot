import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const createHellEmbed = async (channel) => {
  const embed = new EmbedBuilder()
    .setTitle('HELL 16:15')
    .setDescription('Apúntate seleccionando tu clase y rol')
    .setColor(0xff0000);

  // ---------------- Botones de clase ----------------
  const classRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('class_archer').setLabel('Arquero').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('class_swordsman').setLabel('Espadachín').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('class_mage').setLabel('Mago').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('class_martial_artist').setLabel('Artista Marcial').setStyle(ButtonStyle.Primary)
  );

  // ---------------- Botones de rol ----------------
  const roleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('role_dd').setLabel('DD').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_healer').setLabel('Holy').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_main_tank').setLabel('Main Tank').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('role_tank_debuffer').setLabel('Tank/Debuffer').setStyle(ButtonStyle.Secondary)
  );

  // ---------------- Botón de absence ----------------
  const absenceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hell_absence').setLabel('Absence').setStyle(ButtonStyle.Danger)
  );

  // ---------------- Enviar embed con botones ----------------
  await channel.send({
    embeds: [embed],
    components: [classRow, roleRow, absenceRow]
  });
};
