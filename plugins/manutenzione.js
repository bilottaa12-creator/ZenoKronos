
// !manutenzione      -> avviso di manutenzione (con @everyone)
// !fine manutenzione -> avviso che la manutenzione è finita (con @everyone)
const fs = require('fs');
const path = require('path');

const TUX = path.join(__dirname, '../assets/tux1.webp');

const MESSAGGI = {
    '!manutenzione':
        `@everyone\n\n🔧 **BOT IN MANUTENZIONE** 🔧\nNon usatelo per ora, stiamo lavorando!\n\n*by Tux* 🐧`,
    '!fine manutenzione':
        `@everyone\n\n✅ **MANUTENZIONE TERMINATA** ✅\nIl bot è di nuovo disponibile, potete usarlo!\n\n*by Tux* 🐧`,
};

// Invia il messaggio con l'immagine; se il file manca o l'invio con foto fallisce, manda solo il testo
async function invia(channel, testo) {
    const opzioni = { allowedMentions: { parse: ['everyone'] } };

    if (!fs.existsSync(TUX)) {
        console.error(`Errore manutenzione: immagine non trovata in ${TUX}`);
        return channel.send({ content: testo, ...opzioni }).catch(() => {});
    }
    try {
        return await channel.send({
            content: testo,
            files: [{ attachment: TUX, name: 'tux1.webp' }],
            ...opzioni,
        });
    } catch (e) {
        console.error('Errore manutenzione:', e.message);
        return channel.send({ content: testo, ...opzioni }).catch(() => {});
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
