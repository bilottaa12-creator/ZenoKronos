// plugins/manutenzione.js
const path = require('path');

module.exports = {
    name: "manutenzione",

    onMessage: async (message, { client }) => {
        if (!message.member?.permissions.has('ManageGuild')) return;
        if (message.content.toLowerCase() !== '!manutenzione') return;

        try {
            await message.channel.send({
                content: `@everyone\n\n🔧 **BOT IN MANUTENZIONE** 🔧\nNon usatelo per ora, stiamo lavorando!\n\n*by Tux* 🐧`,
                 const TUX_IMAGES = [
    'https://raw.githubusercontent.com/bilottaa12-creator/bot-sicurezza/main/assets/tux1.webp'
    // aggiungi qui altri link man mano che carichi altre immagini
];
                allowedMentions: { parse: ['everyone'] }
            });
            return true;
        } catch (e) {
            console.error('Errore manutenzione:', e.message);
            // fallback senza foto se non trova il file
            await message.channel.send(`@everyone 🔧 BOT IN MANUTENZIONE - Non usatelo! 🐧`).catch(()=>{});
        }
    }
};