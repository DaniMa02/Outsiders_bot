// embeds/hellEmbed.js
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { query } from '../db/database.js';
import { visualRoleMap } from '../config/hellRoles.js';

export const createHellEmbed = async (channel, hellId = 1) => {
  // ---------------- Crear embed base ----------------
  const embed = new EmbedBuilder()
    .setTitle('HELL 16:15')
    .setDescription('Apúntate haciendo click en **Join Hell** o seleccionando tu clase.')
    .setColor(0xff0000);

  // ---------------- Listar participantes actuales ----------------
  const res = await query(`
    SELECT discord_id, assigned_role
    FROM hell_participants
    WHERE hell_id = $1 AND state = 'ACTIVE'
    ORDER BY joined_at ASC
  `, [hellId]);

  if (res.rowCount > 0) {
    // Intentar traer todos los miembros en paralelo
    const memberInfos = await Promise.allSettled(
      res.rows.map(async p => {
        try {
          const member = await channel.guild.members.fetch(p.discord_id);
          const name = member.nickname || member.user.username;
          return { discord_id: p.discord_id, name, assigned_role: p.assigned_role };
        } catch {
          // Fallback si no se puede traer el miembro
          return { discord_id: p.discord_id, name: `<@${p.discord_id}>`, assigned_role: p.assigned_role };
        }
      })
    );

    const finalMembers = memberInfos
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean);

    const lines = finalMembers.map(p => {
      const roleVisual = visualRoleMap[p.assigned_role] || '???';
      return `• ${p.name} → ${roleVisual}`;
    });

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
