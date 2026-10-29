const { inviaLogSicurezza } = require('../utils');
const { isStaff } = require('../lib/staff');
const { GuildSettings } = require('../db');

// Servizi noti per rubare IP o tracciare chi clicca (travestiti da link normali)
const DOMINI_TRACCIAMENTO = [
    'grabify.link', 'iplogger.org', 'iplogger.com', 'blasze.com',
    '2no.co', 'yip.su', 'gyazo.st', 'ps3cfw.com', 'stopify.co',
    'checkip.io', 'ipgrabber.ru', 'spottheip.com'
];

// Accorciatori URL: nascondono la vera destinazione, spesso usati per bypassare i filtri
const ACCORCIATORI = [
    'bit.ly', 'tinyurl.com', 'is.gd', 'cutt.ly', 't.co', 'rebrand.ly',
    'shorturl.at', 'rb.gy', 'v.gd', 'lnk.to', 'shorte.st'
];

// Domini che imitano Discord/Steam per rubare account (phishing "Nitro gratis" ecc.)
const DOMINI_PHISHING = [
    'dlscord', 'discörd', 'discord-nitro', 'discocrd', 'discrod', 'discrodapp',
    'steamcommunlty', 'steancommunity', 'steamcommunityy', 'steamconmunity'
];

function estraiUrl(testo) {
    return testo.match(/https?:\/\/[^\s<>]+/gi) || [];
}

function eLinkSospetto(url) {
    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch {
        return null; // URL malformato, non blocchiamo per sicurezza (evitiamo falsi positivi)
    }

    if (DOMINI_TRACCIAMENTO.some(d => hostname.includes(d))) return 'tracciamento/IP grabber';
    if (ACCORCIATORI.some(d => hostname === d || hostname.endsWith('.' + d))) return 'accorciatore URL (destinazione nascosta)';
    if (DOMINI_PHISHING.some(d => hostname.includes(d))) return 'phishing (imita Discord/Steam)';

    return null;
}

module.exports = {
    name: 'antilink',

    async onMessage(message, ctx) {
        const content = message.content.trim();

        if (content === '!antilink-on' || content === '!antilink-off') {
            if (!(await isStaff(message))) {
                await message.reply('❌ Solo mod/admin');
                return true;
            }

            const attivo = content === '!antilink-on';
            try {
                await GuildSettings.findOneAndUpdate(
                    { guildId: message.guildId },
                    { antilinkEnabled: attivo },
                    { upsert: true }
                );
            } catch (err) {
                console.error('[ERRORE ANTILINK - toggle]:', err.message);
                await message.reply('⚠️ Errore nel salvare l\'impostazione. Riprova tra poco.');
                return true;
            }

            await message.reply(
                attivo
                    ? '✅ Antilink **attivato** — blocco link sospetti/tracciamento/phishing.'
                    : '✅ Antilink **disattivato**.'
            );
            return true;
        }

        if (content.startsWith('!antilink-test ')) {
            if (!(await isStaff(message))) {
                await message.reply('❌ Solo mod/admin');
                return true;
            }

            const linkDaTestare = content.replace('!antilink-test', '').trim();
            const motivoTest = eLinkSospetto(linkDaTestare);

            await message.reply(
                motivoTest
                    ? `🚫 Questo link **verrebbe bloccato** — motivo: **${motivoTest}**.`
                    : `✅ Questo link **non verrebbe bloccato**.`
            );
            return true;
        }

        // Controllo passivo su ogni messaggio (solo se attivo e non è un mod)
        if (await isStaff(message)) return false;

        const url = estraiUrl(message.content);
        if (url.length === 0) return false;

        let settings;
        try {
            settings = await GuildSettings.findOne({ guildId: message.guildId });
        } catch (err) {
            console.error('[ERRORE ANTILINK - lettura impostazioni]:', err.message);
            return false;
        }

        if (!settings?.antilinkEnabled) return false;

        for (const link of url) {
            const motivo = eLinkSospetto(link);
            if (motivo) {
                try {
                    await message.delete();
                } catch (err) {
                    console.error('[ERRORE ANTILINK - cancellazione]:', err.message);
                }

                await message.channel.send(
                    `🚫 Link rimosso da ${message.author} — motivo: **${motivo}**. Non cliccare mai link di questo tipo.`
                );

                await inviaLogSicurezza(
                    message.guild,
                    `🚫 **ANTILINK**: link sospetto (${motivo}) rimosso da ${message.author.tag} nel canale <#${message.channel.id}>. Link: \`${link}\``
                );

                return true;
            }
        }

        return false;
    }
};
