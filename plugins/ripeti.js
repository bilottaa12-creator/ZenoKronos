// !ripeti <testo> -> il bot ripete il testo in un embed, con Tux piccolo come thumbnail
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const TUX = path.join(__dirname, '../assets/tux1.webp');
const MAX = 4000;   // limite della descrizione di un embed (Discord: 4096)

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
        const embed = new EmbedBuilder()
            .setDescription(testo.slice(0, MAX))
            .setColor(0x5865f2);

        if (!fs.existsSync(TUX)) {
            console.error(`Errore ripeti: immagine non trovata in ${TUX}`);
            await message.channel.send({ ...opzioni, embeds: [embed] }).catch(() => {});
            return;
        }

        try {
            embed.setThumbnail('attachment://tux1.webp');
            await message.channel.send({
                ...opzioni,
                embeds: [embed],
                files: [{ attachment: TUX, name: 'tux1.webp' }],
            });
        } catch (e) {
            console.error('Errore ripeti:', e.message);
            await message.channel.send({
                ...opzioni,
                embeds: [new EmbedBuilder().setDescription(testo.slice(0, MAX)).setColor(0x5865f2)],
            }).catch(() => {});
        }
    }
};
