
// !ripeti <testo> -> il bot ripete il testo, sempre con l'immagine di Tux
const fs = require('fs');
const path = require('path');

const TUX = path.join(__dirname, '../assets/tux1.webp');
const MAX = 1900;   // Discord accetta 2000 caratteri per messaggio

module.exports = {
    name: 'ripeti',

    onMessage: async (message) => {
        const m = message.content.trim().match(/^!ripeti(?:\s+([\s\S]*))?$/i);
        if (!m) return;

        const testo = (m[1] || '').trim();
        if (!testo) {
            await message.channel.send('❌ Scrivi cosa ripetere: `!ripeti ciao`').catch(() => {});
            return;
        }

        // allowedMentions vuoto: se l'utente scrive @everyone o @ruolo, il bot non fa scattare la notifica
        const opzioni = { allowedMentions: { parse: [] } };
        const contenuto = testo.slice(0, MAX);

        if (!fs.existsSync(TUX)) {
            console.error(`Errore ripeti: immagine non trovata in ${TUX}`);
            await message.channel.send({ content: contenuto, ...opzioni }).catch(() => {});
            return;
        }

        try {
            await message.channel.send({
                content: contenuto,
                files: [{ attachment: TUX, name: 'tux1.webp' }],
                ...opzioni,
            });
        } catch (e) {
            console.error('Errore ripeti:', e.message);
            await message.channel.send({ content: contenuto, ...opzioni }).catch(() => {});
        }
    }
};
