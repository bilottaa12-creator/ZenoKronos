// plugins/timeout.js: mette e toglie il timeout (mute) a un utente.
//   !timeout @utente [minuti] [motivo]   alias: !muta !mute !blocca   (default 5 minuti, max 28 giorni)
//   !untimeout @utente                   alias: !smuta !unmute !sblocca
// Chi può: creatore del bot (OWNER_ID nel .env), oppure chi ha Modera membri / Amministratore / Gestisci messaggi.
// Non si puniscono: creatore del server, creatore del bot, admin, bot, e chi ha un ruolo uguale o superiore.
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { isOwner } = require('../lib/owner');

const DURATA_DEFAULT_MIN = 5;
const DURATA_MASSIMA_MIN = 40320;   // 28 giorni: limite di Discord
const ALIAS_TIMEOUT = ['timeout', 'muta', 'mute', 'blocca'];
const ALIAS_UNTIMEOUT = ['untimeout', 'smuta', 'unmute', 'sblocca'];

function puoModerare(member) {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.ModerateMembers)
        || member.permissions.has(PermissionFlagsBits.Administrator)
        || member.permissions.has(PermissionFlagsBits.ManageMessages);
}

// Canale dove scrivere il log di sicurezza: LOG_CHANNEL_ID oppure un canale chiamato "log-sicurezza"
async function logSicurezza(guild, testo) {
    try {
        let canale = null;
        if (process.env.LOG_CHANNEL_ID) canale = await guild.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
        if (!canale) canale = guild.channels.cache.find((c) => c.name === 'log-sicurezza');
        if (canale) await canale.send(testo);
    } catch (err) {
        console.error('[LOG SICUREZZA] Errore invio:', err.message);
    }
}

async function timeoutCmd(message, ctx) {
    const guild = message.guild;
    if (!guild) return message.reply('❌ Questo comando funziona solo nei server.');

    const autoreId = message.author.id;
    const autore = message.member;
    const senzaPermesso = !isOwner(autoreId) && !puoModerare(autore);
    if (senzaPermesso) {
        return message.reply('❌ Serve il permesso **Modera membri** (o essere il creatore del bot).');
    }

    const bersaglio = message.mentions.members?.first?.() || null;
    if (!bersaglio) {
        return message.reply('⚠️ Menziona l\'utente. Esempio: `!timeout @utente 10 spam`');
    }
    if (bersaglio.id === guild.ownerId) return message.reply('🧠 Non puoi mettere in timeout il **proprietario del server**.');
    if (isOwner(bersaglio.id)) return message.reply('🧠 Non puoi mettere in timeout il **creatore del bot**.');
    if (bersaglio.id === guild.client.user.id) return message.reply('🤖 Non posso mettere in timeout me stesso.');
    if (bersaglio.user.bot) return message.reply('🤖 Non puoi mettere in timeout un altro bot.');
    if (bersaglio.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('🧠 Non puoi mettere in timeout un amministratore.');
    }
    if (!isOwner(autoreId) && autore && bersaglio.roles.highest.position >= autore.roles.highest.position) {
        return message.reply('❌ Non puoi mettere in timeout un utente con un ruolo uguale o superiore al tuo.');
    }
    if (!bersaglio.moderatable) {
        return message.reply('❌ Non posso mettere in timeout questo utente: il mio ruolo è sotto il suo.');
    }

    // Motivo e durata: il primo numero è la durata, il resto è il motivo
    const parole = (ctx.rest || '').split(/\s+/).filter((p) => p && !p.startsWith('<@'));
    const i = parole.findIndex((p) => /^\d+$/.test(p));
    const minuti = i !== -1 ? Math.min(parseInt(parole[i], 10), DURATA_MASSIMA_MIN) : DURATA_DEFAULT_MIN;
    const motivo = (i !== -1 ? [...parole.slice(0, i), ...parole.slice(i + 1)] : parole).join(' ') || 'Nessun motivo specificato';

    try {
        await bersaglio.timeout(minuti * 60 * 1000, `${motivo} — da ${message.author.username}`);
    } catch (err) {
        console.error('[TIMEOUT] Errore:', err.message);
        return message.reply('❌ Impossibile mettere in timeout: controlla la posizione del ruolo del bot.');
    }

    const embed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle('🔇 Timeout applicato')
        .setDescription(`👤 **Membro:** <@${bersaglio.id}>\n⏱️ **Durata:** ${minuti} minuti\n📝 **Motivo:** ${motivo}\n👮 **Applicato da:** <@${autoreId}>`);
    await message.channel.send({ embeds: [embed] });
    await logSicurezza(guild, `🔇 **Timeout** — <@${autoreId}> ha messo in timeout <@${bersaglio.id}> per ${minuti} min (motivo: ${motivo}).`);
    return true;
}

async function untimeoutCmd(message) {
    const guild = message.guild;
    if (!guild) return message.reply('❌ Questo comando funziona solo nei server.');
    const autoreId = message.author.id;
    if (!isOwner(autoreId) && !puoModerare(message.member)) {
        return message.reply('❌ Serve il permesso **Modera membri** (o essere il creatore del bot).');
    }
    const bersaglio = message.mentions.members?.first?.() || null;
    if (!bersaglio) return message.reply('⚠️ Menziona l\'utente. Esempio: `!untimeout @utente`');
    const attivo = bersaglio.communicationDisabledUntilTimestamp && bersaglio.communicationDisabledUntilTimestamp > Date.now();
    if (!attivo) return message.reply('❌ Questo utente non ha nessun timeout attivo.');

    try {
        await bersaglio.timeout(null, `Timeout revocato da ${message.author.username}`);
    } catch (err) {
        console.error('[UNTIMEOUT] Errore:', err.message);
        return message.reply('❌ Impossibile togliere il timeout: controlla la posizione del ruolo del bot.');
    }
    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🔊 Timeout revocato')
        .setDescription(`✅ <@${bersaglio.id}> può di nuovo scrivere.\n👮 **Revocato da:** <@${autoreId}>`);
    await message.channel.send({ embeds: [embed] });
    await logSicurezza(guild, `🔊 **Untimeout** — <@${autoreId}> ha rimosso il timeout a <@${bersaglio.id}>.`);
    return true;
}

module.exports = {
    name: 'timeout',
    commands: [...ALIAS_TIMEOUT, ...ALIAS_UNTIMEOUT],
    desc: 'Mette o toglie il timeout (mute) a un utente',
    tags: ['moderazione'],

    async run(message, ctx) {
        if (ALIAS_UNTIMEOUT.includes(ctx.name)) return untimeoutCmd(message, ctx);
        return timeoutCmd(message, ctx);
    },
};
