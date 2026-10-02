// Esempio da integrare nel tuo comando sp.js:
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const row = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('like_spotify_song')
            .setLabel('Mi piace')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⭐')
    );

// Quando rispondi all'embed, aggiungi components: [row]
// es: await interaction.reply({ embeds: [embed], components: [row] });
