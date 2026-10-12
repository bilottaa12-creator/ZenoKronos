
// !manutenzione      -> avviso di manutenzione (con @everyone)
// !fine manutenzione -> avviso che la manutenzione è finita (con @everyone)
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const TUX = path.join(__dirname, '../assets/tux1.webp');

const MESSAGGI = {
    '!manutenzione':
        `🔧 **BOT IN MANUTENZIONE** 🔧\nNon usatelo per ora, stiamo lavorando!\n\n*by Tux* 🐧`,
    '!fine manutenzione':
        `✅ **MANUTENZIONE TERMINATA** ✅\nIl bot è di nuovo disponibile, potete usarlo!\n\n*by Tux* 🐧`,
};

// Invia l'avviso con Tux come thumbnail (piccola, in alto a destra, come negli embed di fun-parla).
// Se il file manca o l'invio con immagine fallisce, manda l'embed senza immagine.
async function invia(channel, testo) {
    const opzioni = { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
    const embed = new EmbedBuilder().setDescription(testo).setColor(0x5865f2);

    if (!fs.existsSync(TUX)) {
        console.error(`Errore manutenzione: immagine non trovata in ${TUX}`);
        return channel.send({ ...opzioni, embeds: [embed] }).catch(() => {});
    }
    try {
        embed.setThumbnail('attachment://tux1.webp');
        return await channel.send({
            ...opzioni,
            embeds: [embed],
            files: [{ attachment: TUX, name: 'tux1.webp' }],
        });
    } catch (e) {
        console.error('Errore manutenzione:', e.message);
        return channel.send({ ...opzioni, embeds: [new EmbedBuilder().setDescription(testo).setColor(0x5865f2)] }).catch(() => {});
    }
}

module.exports = {
    name: "manutenzione",

    onMessage: async (message) => {
        if (!message.member?.permissions.has('ManageGuild')) return;

        const comando = message.content.trim().toLowerCase().replace(/\s+/g, ' ');
        const testo = MESSAGGI[comando];
        if (!testo) return;

        await invia(message.channel, testo);
        return true;
    }
};
