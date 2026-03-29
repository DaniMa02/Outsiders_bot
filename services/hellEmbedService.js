// services/hellEmbedService.js
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { query } from '../db/database.js';
import { visualRoleMap } from '../config/hellRoles.js';

/**
 * Días de la semana ES / EN
 */
const DAYS_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado'
];

const DAYS_EN = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

/**
 * Obtiene título del Hell en formato:
 * Miércoles / Wednesday - 20:15
 */
const buildHellTitle = (dateStr, timeSlot) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);  const dayIndex = date.getDay();

  const dayEs = DAYS_ES[dayIndex];
  const dayEn = DAYS_EN[dayIndex];

  const hour = timeSlot.split('_').slice(-2).join(':');

 return `🔥 Hell — ${dayEs} / ${dayEn} - ${hour}`;
};

/**
 * Crea o actualiza el embed de un hell concreto con botones
 */
export const createOrUpdateHellEmbed = async (client, hellId) => {
  // 1️⃣ Obtener info del hell
  const hellRes = await query(`
    SELECT id, date, time_slot, channel_id, message_id, status
    FROM hells
    WHERE id = $1
  `, [hellId]);

  if (hellRes.rowCount === 0) return;

  const hell = hellRes.rows[0];

  // 2️⃣ Obtener participantes incluyendo si son replacement
  const participantsRes = await query(`
    SELECT u.nickname, hp.state, hp.assigned_role, hp.is_replacement
    FROM hell_participants hp
    JOIN users u ON u.discord_id = hp.discord_id
    WHERE hp.hell_id = $1
    ORDER BY hp.slot_number ASC
  `, [hellId]);

  const active = [];
  const absence = [];

  for (const row of participantsRes.rows) {
    // Mostrar nombre y rol
    const displayName = row.assigned_role
      ? `${row.nickname} → ${visualRoleMap[row.assigned_role] || '???'}`
      : row.nickname;

    // Añadir "(Replacement)" si corresponde
    const replacementText = row.is_replacement ? ' (Replacement)' : '';

    const nameToShow = displayName + replacementText;

    if (row.state === 'ACTIVE') active.push(nameToShow);
    if (row.state === 'ABSENCE') absence.push(nameToShow);
  }

  // 3️⃣ Construir textos
  const participantsText = active.length
    ? active.map(u => `• ${u}`).join('\n')
    : '_Sin participantes_';

  const absenceText = absence.length
    ? absence.map(u => `• ${u}`).join('\n')
    : '_Nadie en absence_';

  // 4️⃣ Crear embed
  const embed = new EmbedBuilder()
    .setTitle(buildHellTitle(hell.date, hell.time_slot))
    .addFields(
      { name: '👥 Participantes', value: participantsText, inline: false },
      { name: '🚫 Absence', value: absenceText, inline: false }
    )
    .setColor(0xff4d4d);

  // 5️⃣ Botones
  const classRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('class_archer')
      .setLabel('Arquero')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('class_swordsman')
      .setLabel('Espadachín')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('class_mage')
      .setLabel('Mago')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('class_martial_artist')
      .setLabel('Artista Marcial')
      .setStyle(ButtonStyle.Primary)
  );

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hell_join')
      .setLabel('⚔️ Join Hell')
      .setStyle(ButtonStyle.Success)
  );

  const absenceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hell_absence')
      .setLabel('Absence')
      .setStyle(ButtonStyle.Danger)
  );

  // 6️⃣ Enviar o editar mensaje
  const channel = await client.channels.fetch(hell.channel_id);
  if (!channel) return;

  if (hell.message_id) {
    try {
      const message = await channel.messages.fetch(hell.message_id);
      await message.edit({
        embeds: [embed],
        components: [classRow, joinRow, absenceRow]
      });
    } catch {
      const msg = await channel.send({
        embeds: [embed],
        components: [classRow, joinRow, absenceRow]
      });
      await query(
        `UPDATE hells SET message_id = $1 WHERE id = $2`,
        [msg.id, hell.id]
      );
    }
  } else {
    const msg = await channel.send({
      embeds: [embed],
      components: [classRow, joinRow, absenceRow]
    });
    await query(
      `UPDATE hells SET message_id = $1 WHERE id = $2`,
      [msg.id, hell.id]
    );
  }
};
