// plugins/esci.js: fa uscire il bot da un server. Solo il creatore del bot (OWNER_ID).
//   !esci <idServer> conferma   -> esce dal server con quell'ID
//   !esci conferma              -> esce dal server dove scrivi
// Serve la parola "conferma": così un comando scritto per sbaglio non fa uscire il bot.
const { isOwner } = require('../lib/owner');

const ID_SERVER = /^\d{17,20}$/;

module.exports = {
    name: 'esci',
    commands: ['esci'],
    desc: 'Fa uscire il bot da un server (solo creatore del bot)',
    tags: ['owner'],

    async run(message, ctx) {
        if (!isOwner(message.author.id)) {
            return message.reply('⛔ Solo il creatore del bot può usare questo comando.');
        }

        const args = ctx.args || [];
        const conferma = args[args.length - 1] === 'conferma';
        const idScritto = args[0] && ID_SERVER.test(args[0]) ? args[0] : null;
        const client = ctx.client;

        const guild = idScritto
            ? client.guilds.cache.get(idScritto)
            : message.guild;

        if (!idScritto && !message.guild) {
            return message.reply('❌ Scrivi l\'ID del server: `!esci <idServer> conferma`');
        }
        if (!guild) {
            return message.reply('❌ Non sono in un server con quell\'ID.');
        }
        if (!conferma) {
            const cmd = idScritto ? `!esci ${idScritto} conferma` : '!esci conferma';
            return message.reply(`⚠️ Stai per far uscire il bot da **${guild.name}**. Per confermare scrivi \`${cmd}\`.`);
        }

        try {
            const nome = guild.name;
            await guild.leave();
            // Se il comando è partito dal server stesso, il messaggio di conferma non si vedrà più
            if (!idScritto) return;
            return message.reply(`✅ Uscito da **${nome}**.`);
        } catch (err) {
            console.error('[ESCI] Errore:', err.message);
            return message.reply('❌ Non riesco a uscire da quel server.');
        }
    },
};
