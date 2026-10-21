// plugins/del.js: cancella messaggi.
//   !del              (rispondendo a un messaggio) -> cancella quel messaggio e il comando
//   !del <N>          -> cancella gli ultimi N messaggi del canale (1-100), serve Gestisci messaggi
//   !del id:<ID>      -> cancella il messaggio con quell'ID
// Puoi sempre cancellare i tuoi messaggi; quelli degli altri servono Gestisci messaggi.
const { PermissionFlagsBits } = require('discord.js');

const SNOWFLAKE = /^\d{17,20}$/;
const MAX_BULK = 100;
const USO = '🗑️ **Come si usa:**\n• Rispondi a un messaggio con `!del` per cancellarlo\n• `!del <N>` cancella gli ultimi N messaggi (1-100)\n• `!del id:<ID>` cancella un messaggio per ID\n⚠️ Per i messaggi degli altri serve **Gestisci messaggi**.';

const puoGestire = (member) => Boolean(member?.permissions?.has(PermissionFlagsBits.ManageMessages));

// Messaggio di servizio che si cancella da solo dopo qualche secondo
async function avviso(channel, testo, ms = 6000) {
    const info = await channel.send(testo).catch(() => null);
    if (info) setTimeout(() => info.delete().catch(() => {}), ms);
}

async function cancellaBersaglio(message, target, gestisce) {
    const tuo = target.author?.id === message.author.id;
    if (!tuo && !gestisce) {
        return message.reply('❌ Non puoi cancellare questo messaggio (non è tuo e non hai **Gestisci messaggi**).');
    }
    try {
        await target.delete();
    } catch (err) {
        console.error('[DEL] delete target:', err.message);
        return message.reply('❌ Non riesco a cancellare quel messaggio.');
    }
    await message.delete().catch(() => {});
}

module.exports = {
    name: 'del',
    commands: ['del', 'delete'],
    desc: 'Cancella messaggi: rispondi con !del, oppure !del <N>, oppure !del id:<ID>',
    tags: ['moderazione'],

    async run(message, ctx) {
        const channel = message.channel;
        const args = ctx.args || [];
        const referenced = message.reference?.messageId;
        const gestisce = puoGestire(message.member);

        // Nessun argomento e nessuna risposta: istruzioni
        if (!referenced && args.length === 0) {
            await message.delete().catch(() => {});
            return avviso(channel, USO, 15000);
        }

        // !del <N>: cancellazione in blocco
        if (!referenced && /^\d+$/.test(args[0])) {
            if (!gestisce) return message.reply('❌ Ti serve il permesso **Gestisci messaggi**.');
            const n = Math.min(Math.max(parseInt(args[0], 10), 1), MAX_BULK);
            await message.delete().catch(() => {});
            try {
                const cancellati = await channel.bulkDelete(n, true);
                return avviso(channel, `🗑️ Cancellati **${cancellati.size}** messaggi.`, 4000);
            } catch (err) {
                console.error('[DEL] bulkDelete:', err.message);
                return avviso(channel, '❌ Non riesco a cancellare in blocco: i messaggi più vecchi di 14 giorni non si possono cancellare così.', 8000);
            }
        }

        // !del id:<ID>
        if (args[0] && args[0].toLowerCase().startsWith('id:')) {
            const id = args[0].slice(3);
            if (!SNOWFLAKE.test(id)) return message.reply('❌ ID non valido.');
            const target = await channel.messages.fetch(id).catch(() => null);
            if (!target) return message.reply('❌ Messaggio non trovato.');
            return cancellaBersaglio(message, target, gestisce);
        }

        // Risposta a un messaggio
        if (referenced) {
            const target = await channel.messages.fetch(referenced).catch(() => null);
            if (!target) return message.reply('❌ Messaggio non trovato.');
            return cancellaBersaglio(message, target, gestisce);
        }

        return message.reply(USO);
    },
};
