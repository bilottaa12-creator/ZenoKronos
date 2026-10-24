// plugins/ripeti.js: !ripeti <testo> (o .ripeti) -> il bot ripete il testo in un embed con Tux piccolo,
// e cancella il tuo messaggio, così resta solo quello del bot.
// Per cancellare serve che il bot abbia il permesso Gestisci messaggi nel canale.
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const TUX = path.join(__dirname, '../assets/tux1.webp');
const MAX = 4000;   // limite della descrizione di un embed (Discord: 4096)

module.exports = {
    name: 'ripeti',
    commands: ['ripeti'],
    desc: 'Ripete il testo con Tux: il tuo messaggio viene cancellato',
    tags: ['divertimento'],

    async run(message, ctx) {
        const testo = (ctx.rest || '').trim();
        if (!testo) {
            return message.channel.send('❌ Scrivi cosa ripetere: `!ripeti ciao`').catch(() => {});
        }

        // allowedMentions vuoto: se scrivi @everyone o @ruolo, non fa scattare la notifica
        const embed = new EmbedBuilder().setDescription(testo.slice(0, MAX)).setColor(0x5865f2);
        const opzioni = { allowedMentions: { parse: [] } };

        let inviato;
        if (!fs.existsSync(TUX)) {
            console.error(`Errore ripeti: immagine non trovata in ${TUX}`);
            inviato = await message.channel.send({ ...opzioni, embeds: [embed] }).catch(() => null);
        } else {
            embed.setThumbnail('attachment://tux1.webp');
            inviato = await message.channel.send({
                ...opzioni,
                embeds: [embed],
                files: [{ attachment: TUX, name: 'tux1.webp' }],
            }).catch(() => null);
            if (!inviato) {
                // Se l'invio con immagine fallisce, riprova solo col testo
                inviato = await message.channel.send({
                    ...opzioni,
                    embeds: [new EmbedBuilder().setDescription(testo.slice(0, MAX)).setColor(0x5865f2)],
                }).catch(() => null);
            }
        }

        // Solo se il bot ha risposto cancelliamo il tuo messaggio
        if (inviato) {
            await message.delete().catch((err) => console.error('[RIPETI] Non posso cancellare il messaggio:', err.message));
        }
        return true;
    },
};
