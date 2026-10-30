// plugins/pl.js: la tua playlist personale (.PL).
//   !pl                       pannello con i tuoi brani (scegli un brano, avvia la coda, stop)
//   !pl add <link>            aggiunge i brani di una playlist o video YouTube
//   !pl del <numero>          toglie un brano
//   !pl all                   manda in canale tutti i brani, uno dopo l'altro
// I bottoni funzionano solo per il proprietario della playlist.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const ytdl = require('../lib/ytdl');

const run = promisify(execFile);
const PLAYLIST_DB = path.resolve('playlist_db.json');
const PAGINA = 10;
const code = new Map();            // uid -> coda in corso { tracks, channel, stop }

const leggi = () => {
    if (!fs.existsSync(PLAYLIST_DB)) return {};
    try { return JSON.parse(fs.readFileSync(PLAYLIST_DB, 'utf8')); } catch { return {}; }
};
const scrivi = (dati) => {
    const tmp = `${PLAYLIST_DB}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dati, null, 2), 'utf8');
    fs.renameSync(tmp, PLAYLIST_DB);
};
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const nomeFile = (t) => (t || '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 60) || 'zeno';
const rimuovi = (p) => { try { if (p && fs.existsSync(p)) fs.rmSync(p, { force: true }); } catch {} };

// Link di una playlist o di un video: yt-dlp elenca i brani senza scaricarli
let elencoLink = async (link) => {
    const { stdout } = await run('yt-dlp', ['--flat-playlist', '--dump-json', link], { maxBuffer: 20 * 1024 * 1024, timeout: 2 * 60 * 1000 });
    return stdout.trim().split('\n').map((riga) => {
        try {
            const info = JSON.parse(riga);
            const url = info.url && info.url.startsWith('http') ? info.url : (info.id ? `https://www.youtube.com/watch?v=${info.id}` : null);
            return url ? { title: info.title || 'Brano importato', url, duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.round(info.duration % 60)).padStart(2, '0')}` : '--:--' } : null;
        } catch { return null; }
    }).filter(Boolean);
};

function pannello(uid, pagina = 0) {
    const brani = leggi()[uid] || [];
    if (!brani.length) {
        return { content: '❌ La tua playlist (.PL) è vuota! Aggiungi una playlist con `!pl add <link>` oppure col pulsante ➕ di `!song`.', embeds: [], components: [] };
    }
    const pagine = Math.ceil(brani.length / PAGINA);
    pagina = Math.min(Math.max(pagina, 0), pagine - 1);
    const inizio = pagina * PAGINA;
    const fetta = brani.slice(inizio, inizio + PAGINA);

    const embed = new EmbedBuilder()
        .setTitle('🎵 La tua playlist')
        .setColor(0x9b59ff)
        .setDescription(fetta.map((t, i) => `**${inizio + i + 1}.** ${clip(t.title || 'Sconosciuto', 80)}${t.duration ? ` \`${t.duration}\`` : ''}`).join('\n'))
        .setFooter({ text: `Totale brani: ${brani.length} • Pagina ${pagina + 1}/${pagine} • ZenoKronos` });

    const righe = [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`pl:sel:${uid}`)
                .setPlaceholder('🎧 Ascolta un brano singolarmente')
                .addOptions(fetta.map((t, i) => ({
                    label: clip(`${inizio + i + 1}. ${t.title || 'Sconosciuto'}`, 100),
                    value: String(inizio + i),
                }))),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`pl:all:${uid}`).setLabel('▶️ Avvia coda').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`pl:stop:${uid}`).setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
        ),
    ];
    if (pagine > 1) {
        righe.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`pl:page:${uid}:${pagina - 1}`).setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(pagina === 0),
            new ButtonBuilder().setCustomId(`pl:page:${uid}:${pagina + 1}`).setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= pagine - 1),
        ));
    }
    return { embeds: [embed], components: righe };
}

async function aggiungi(message, uid, link) {
    if (!/^https?:\/\//i.test(link || '')) return message.reply('❌ Inserisci un link valido: `!pl add <link>`');
    const stato = await message.reply('⏳ Lettura del link in corso...');
    let trovati;
    try {
        trovati = await elencoLink(link);
    } catch (err) {
        console.error('[PL] Errore lettura link:', err.stderr || err.message);
        return stato.edit(ytdl.explainDownloadError(err, '❌ Errore durante la lettura del link. Assicurati che sia un link valido.'));
    }
    if (!trovati.length) return stato.edit('❌ Nessun brano trovato in questo link.');

    const db = leggi();
    db[uid] = db[uid] || [];
    let aggiunti = 0;
    for (const t of trovati) {
        if (!db[uid].some((x) => x.url === t.url)) { db[uid].push(t); aggiunti++; }
    }
    if (!aggiunti) return stato.edit('⚠️ Questi brani sono già presenti nella tua playlist!');
    scrivi(db);
    return stato.edit(`✅ Aggiunti **${aggiunti}** brani alla tua playlist! Scrivi \`!pl\` per vederla.`);
}

function togli(message, uid, arg) {
    const idx = parseInt(arg, 10) - 1;
    const db = leggi();
    const brani = db[uid] || [];
    if (Number.isNaN(idx) || idx < 0 || idx >= brani.length) {
        return message.reply('❌ Numero di brano non valido. Esempio: `!pl del 2`');
    }
    const [tolto] = brani.splice(idx, 1);
    db[uid] = brani;
    scrivi(db);
    return message.reply(`🗑️ Brano rimosso: **${tolto.title || 'Sconosciuto'}**`);
}

async function invia(canale, uid, brano) {
    let file = null;
    try {
        file = await ytdl.downloadAudio(brano.url, { quality: '128K' });
        if (fs.statSync(file).size > ytdl.MAX_UPLOAD) {
            await canale.send(`❌ **${brano.title}**: file troppo grande per Discord.`);
            return false;
        }
        await canale.send({ content: `🎧 **${brano.title || 'Brano'}**`, files: [new AttachmentBuilder(file, { name: `${nomeFile(brano.title)}.mp3` })] });
        return true;
    } catch (err) {
        console.error('[PL] Errore download:', err.stderr || err.message);
        await canale.send(`❌ Non riesco a scaricare **${brano.title}**.`).catch(() => {});
        return false;
    } finally {
        rimuovi(file);
    }
}

// Coda: un brano alla volta, si ferma con il pulsante Stop
async function avviaCoda(uid, canale, brani) {
    if (code.has(uid)) return canale.send('⏳ Hai già una coda in corso: aspetta che finisca o premi Stop.');
    const coda = { tracce: brani.slice(), canale, stop: false };
    code.set(uid, coda);
    let riusciti = 0;
    try {
        while (coda.tracce.length && !coda.stop) {
            if (ytdl.isBusy()) { await new Promise((r) => setTimeout(r, 3000)); continue; }
            const brano = coda.tracce.shift();
            if (await invia(canale, uid, brano)) riusciti++;
        }
    } finally {
        code.delete(uid);
    }
    const msg = coda.stop ? '⏹️ Coda fermata.' : `✅ Coda completata: ${riusciti} brani inviati.`;
    return canale.send(msg).catch(() => {});
}

module.exports = {
    name: 'pl',
    commands: ['pl'],
    prefix: 'pl',
    desc: 'La tua playlist: ascolto, coda, aggiungi e togli brani',
    tags: ['musica'],

    async run(message, ctx) {
        const uid = message.author.id;
        const args = ctx.args || [];
        const sub = (args[0] || '').toLowerCase();
        const resto = args.slice(1).join(' ');

        if (!sub || sub === 'lista') return message.reply(pannello(uid));
        if (sub === 'add') return aggiungi(message, uid, resto);
        if (sub === 'del') return togli(message, uid, resto);
        if (sub === 'all') {
            const brani = leggi()[uid] || [];
            if (!brani.length) return message.reply('❌ La tua playlist è vuota.');
            return avviaCoda(uid, message.channel, brani);
        }
        if (sub === 'stop') {
            const c = code.get(uid);
            if (!c) return message.reply('ℹ️ Non hai nessuna coda in corso.');
            c.stop = true;
            return message.reply('⏹️ Fermo la coda dopo il brano in corso.');
        }
        return message.reply('❌ Comandi: `!pl`, `!pl add <link>`, `!pl del <numero>`, `!pl all`, `!pl stop`');
    },

    async onComponent(i) {
        const parti = i.customId.split(':');
        const azione = parti[1];
        const uid = parti[2];
        if (i.user.id !== uid) {
            return i.reply({ content: '⛔ Questa playlist non è tua.', flags: MessageFlags.Ephemeral });
        }

        if (azione === 'sel') {
            const brano = (leggi()[uid] || [])[parseInt(i.values?.[0], 10)];
            if (!brano?.url) return i.reply({ content: '❌ Brano non trovato.', flags: MessageFlags.Ephemeral });
            if (ytdl.isBusy()) return i.reply({ content: '⏳ Sto già scaricando altri brani, riprova tra qualche secondo.', flags: MessageFlags.Ephemeral });
            await i.deferReply();
            let file = null;
            try {
                file = await ytdl.downloadAudio(brano.url, { quality: '128K' });
                await i.editReply({ content: `🎧 **${brano.title || 'Brano'}**`, files: [new AttachmentBuilder(file, { name: `${nomeFile(brano.title)}.mp3` })] });
            } catch (err) {
                await i.editReply(ytdl.explainDownloadError(err, '❌ Errore download.')).catch(() => {});
            } finally {
                rimuovi(file);
            }
            return;
        }
        if (azione === 'all') {
            const brani = leggi()[uid] || [];
            if (!brani.length) return i.reply({ content: '❌ La tua playlist è vuota.', flags: MessageFlags.Ephemeral });
            await i.reply({ content: '▶️ Avvio la coda nel canale.', flags: MessageFlags.Ephemeral });
            return avviaCoda(uid, i.channel, brani);
        }
        if (azione === 'stop') {
            const c = code.get(uid);
            if (!c) return i.reply({ content: 'ℹ️ Non hai nessuna coda in corso.', flags: MessageFlags.Ephemeral });
            c.stop = true;
            return i.reply({ content: '⏹️ Fermo la coda dopo il brano in corso.', flags: MessageFlags.Ephemeral });
        }
        if (azione === 'page') {
            return i.update(pannello(uid, parseInt(parti[3], 10) || 0));
        }
        return i.reply({ content: '⌛ Pulsante scaduto, scrivi di nuovo `!pl`.', flags: MessageFlags.Ephemeral });
    },

    _test: { pannello, leggi, scrivi, avviaCoda, code, setElencoLink: (f) => { elencoLink = f; } },
};
