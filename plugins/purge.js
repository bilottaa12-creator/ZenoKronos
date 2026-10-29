const { isStaff } = require('../lib/staff');

module.exports = {
    name: 'purge',

    async onMessage(message, ctx) {
        if (!message.content.trim().startsWith('!purge')) return false;

        if (!(await isStaff(message))) {
            await message.reply('❌ Solo mod/admin');
            return true;
        }

        const args = message.content.trim().split(/\s+/);
        const numero = parseInt(args[1], 10);

        if (isNaN(numero) || numero < 1 || numero > 100) {
            await message.reply('Usa `!purge <numero>` con un numero tra 1 e 100 (es. `!purge 20`).');
            return true;
        }

        try {
            // +1 per eliminare anche il messaggio del comando stesso
            // "true" = ignora automaticamente i messaggi più vecchi di 14 giorni invece di dare errore
            const eliminati = await message.channel.bulkDelete(numero + 1, true);

            const confermaMsg = await message.channel.send(
                `🗑️ Eliminati **${eliminati.size - 1}** messaggi.`
            );
            // Il messaggio di conferma si autodistrugge dopo 5 secondi, per non intasare il canale
            setTimeout(() => confermaMsg.delete().catch(() => {}), 5000);

        } catch (err) {
            console.error('[ERRORE PURGE]:', err.message);
            await message.reply(
                '⚠️ Errore durante la cancellazione. Controlla che il bot abbia il permesso ' +
                '"Gestisci Messaggi" nel server, e che tu non stia cercando di cancellare ' +
                'messaggi più vecchi di 14 giorni (limite di Discord, non del bot).'
            );
        }

        return true;
    }
};
