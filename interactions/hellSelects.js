import { StringSelectMenuBuilder, ActionRowBuilder, MessageFlagsBitField } from 'discord.js';

export const handleHellSelect = async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    const selectedClass = interaction.values[0];

    return interaction.reply({
      content: `🧙 ${interaction.user.username}, has elegido la clase: **${selectedClass}**`,
      flags: MessageFlagsBitField.Ephemeral
    });
  }

  if (interaction.customId === 'hell_select_class') {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_class_menu')
      .setPlaceholder('Selecciona tu clase')
      .addOptions([
        { label: 'Arquero', value: 'Arquero', description: 'Especialista en ataques a distancia' },
        { label: 'Espadachín', value: 'Espadachin', description: 'Maestro del combate cuerpo a cuerpo' },
        { label: 'Mago', value: 'Mago', description: 'Lanza hechizos poderosos' },
        { label: 'Artista Marcial', value: 'Artista Marcial', description: 'Combate ágil y versátil' }
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.reply({
      content: 'Selecciona tu clase:',
      components: [row],
      flags: MessageFlagsBitField.Ephemeral
    });
  }
};
