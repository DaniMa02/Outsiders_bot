// embeds/hellEmbed.js
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { query } from '../db/database.js'; // para leer la base de datos
import { visualRoleMap } from '../config/hellRoles.js'; // opcional: para mapear roles internos a visuales

export const createHellEmbed = async (channel, hellId = 1) => {
  // ---------------- Crear embed base ----------------
  const embed = new EmbedBuilder()
    .setTitle('HELL 16:15')
    .setDescription('Apúntate haciendo click en **Join Hell** o seleccionando tu clase.')
    .setColor(0xff0000);

  // ---------------- Listar participantes actuales ----------------
  const res = await query(`
    SELECT hp.discord_id, hp.assigned_role
    FROM hell_participants hp
    WHERE hp.hell_id = $1 AND hp.state = 'ACTIVE'
    ORDER BY hp.joined_at ASC
  `, [hellId]);

  if (res.rowCount > 0) {
    const lines = [];

    // Obtener los nombres de Discord directamente
    for (const p of res.rows) {
      try {
        const member = await channel.guild.members.fetch(p.discord_id);
        const username = member.user.username; // nombre real de Discord
        const roleVisual = visualRoleMap[p.assigned_role] || '???';
        lines.push(`• ${username} → ${roleVisual}`);
      } catch (err) {
        console.error(`❌ No se pudo obtener usuario ${p.discord_id}:`, err);
        lines.push(`• <@${p.discord_id}> → ${visualRoleMap[p.assigned_role] || '???'}`);
      }
    }

    embed.addFields({ name: 'Participantes', value: lines.join('\n') });
  }

  // ---------------- Botones de clase ----------------
  const classRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('class_archer').setLabel('Arquero').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('class_swordsman').setLabel('Espadachín').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('class_mage').setLabel('Mago').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('class_martial_artist').setLabel('Artista Marcial').setStyle(ButtonStyle.Primary)
  );

  // ---------------- Botón de Join ----------------
  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hell_join').setLabel('⚔️ Join Hell').setStyle(ButtonStyle.Success)
  );

  // ---------------- Botón de Absence ----------------
  const absenceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hell_absence').setLabel('Absence').setStyle(ButtonStyle.Danger)
  );

  // ---------------- Enviar embed con botones ----------------
  await channel.send({
    embeds: [embed],
    components: [classRow, joinRow, absenceRow]
  });
};
