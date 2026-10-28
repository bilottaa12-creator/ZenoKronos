// plugins/tp.js: le 5 canzoni più ascoltate di un cantante (cercate su YouTube).
//   !tp <cantante>   oppure   .tp <cantante>
// Scorri con ◀ ▶, poi scegli Audio, Video o Aggiungi a .PL. Solo chi ha fatto la ricerca può usare i pulsanti.
const fs = require('fs');
const path = require('path');
const ytsModulo = require('yt-search');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const ytdl = require('../lib/ytdl');

const yts = ytsModulo.default || ytsModulo;
const PLAYLIST_DB = path.resolve('playlist_db.json');
const MAX_VIDEO_SEC = 480;      // 8 minuti per i video
const YT_ID = /^[\w-]{11}$/;
const COLORE = 0x5865f2;
const CACHE_MS = 60 * 60 * 1000;

// Ricerche recenti, per scorrere le schede senza rifare la ricerca (uid -> { ts, artist, videos })
const cache = new Map();

const rimuovi = (p) => { try { if (p && fs.existsSync(p)) fs.rmSync(p, { force: true }); } catch {} };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const nomeFile = (t) => (t || '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 60) || 'zeno';
const miniatura = (v) => v?.thumbnail || v?.image || null;
const visualizzazioni = (v) => (v?.views ?? 0).toLocaleString('it-IT');
const urlVideo = (id) => `https://www.youtube.com/watch?v=${id}`;
const normalizza = (s) => (s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Titoli da scartare: compilation, cover, remix, dal vivo, ecc.
const SCARTA = /\b(mix|compilation|karaoke|reaction|cover|remix|slowed|sped up|nightcore|1 hour|playlist|best of|greatest hits|full album|live|tutorial|instrumental)\b/;

function leggiPlaylist() {
    if (!fs.existsSync(PLAYLIST_DB)) return {};
    try { return JSON.parse(fs.readFileSync(PLAYLIST_DB, 'utf8')); } catch { return {}; }
}
function scriviPlaylist(dati) {
    const tmp = `${PLAYLIST_DB}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dati, null, 2), 'utf8');
    fs.renameSync(tmp, PLAYLIST_DB);
}

// Non esiste una classifica ufficiale accessibile: cerco i brani dell'artista su YouTube,
// scarto compilation/cover/live, tolgo i doppioni e ordino per visualizzazioni.
async function cinqueMigliori(artista) {
    const ricerche = [`${artista} official audio`, `${artista} official video`, artista];
    const risultati = await Promise.all(ricerche.map((q) => yts(q).then((r) => r.videos || []).catch(() => [])));

    const visti = new Set();
    const tutti = risultati.flat().filter((v) => v?.videoId && !visti.has(v.videoId) && visti.add(v.videoId));

    const na = normalizza(artista);
    const validi = tutti.filter((v) => v.seconds >= 60 && v.seconds <= 600 && !SCARTA.test(normalizza(v.title)));
    const stretti = validi.filter((v) => normalizza(v.title).includes(na) || normalizza(v.author?.name).includes(na));
    const pool = (stretti.length ? stretti : validi).sort((a, b) => (b.views || 0) - (a.views || 0));

    const chiave = (v) => normalizza(v.title.replace(/[(\[].*?[)\]]/g, ''))
        .replace(na, '')
        .replace(/\b(official|audio|video|lyrics?|hd|4k|ft|feat|prod)\b.*$/, '')
        .trim() || v.videoId;

    const chiavi = new Set();
    const top = [];
    for (const v of pool) {
        const k = chiave(v);
        if (chiavi.has(k)) continue;
        chiavi.add(k);
        top.push(v);
        if (top.length === 5) break;
    }
    return top;
}

async function videoDiCache(uid, id) {
    const trovato = cache.get(uid)?.videos.find((v) => v.videoId === id);
    if (trovato) return trovato;
    try { return await yts({ videoId: id }); } catch { return null; }
}

// Una scheda alla volta: ◀ ▶ scorrono le 5 canzoni in modo circolare
function scheda(uid, indice) {
    const voce = cache.get(uid);
    if (!voce?.videos?.length) return null;
    const { videos, artista } = voce;
    const n = videos.length;
    const idx = ((indice % n) + n) % n;
    const v = videos[idx];

    const embed = new EmbedBuilder()
        .setColor(COLORE)
        .setTitle(clip(`${idx + 1}. ${v.title}`, 250))
        .setURL(v.url || urlVideo(v.videoId))
        .setDescription(`📺 **Canale:** ${v.author?.name || 'Sconosciuto'}\n⏱️ **Durata:** ${v.timestamp || '—'}\n👁️ **Ascolti:** ${visualizzazioni(v)}`)
        .setFooter({ text: 'ZenoKronos • Top' });
    if (/^https?:\/\//.test(miniatura(v) || '')) embed.setImage(miniatura(v));   // solo se è un URL valido

    const navigazione = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tp:nav:${uid}:${idx - 1}`).setLabel('◀️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tp:count').setLabel(`${idx + 1} / ${n}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`tp:nav:${uid}:${idx + 1}`).setLabel('▶️').setStyle(ButtonStyle.Secondary),
    );
    const azioni = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tp:audio:${uid}:${v.videoId}`).setLabel('🎧 Audio').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tp:video:${uid}:${v.videoId}`).setLabel('🎥 Video').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tp:pl:${uid}:${v.videoId}`).setLabel('🎵 Aggiungi a .PL').setStyle(ButtonStyle.Success),
    );
    return {
        content: `🏆 **Top ${n} di ${clip(artista, 60)}**\n_Scorri con le frecce e scegli la canzone:_`,
        embeds: [embed],
        components: [navigazione, azioni],
    };
}

async function inviaAudio(i, uid, id) {
    if (ytdl.isBusy()) return i.reply({ content: '⏳ Sto già scaricando altri brani, riprova tra qualche secondo.', flags: MessageFlags.Ephemeral });
    await i.deferReply();
    const v = await videoDiCache(uid, id);
    const titolo = v?.title || 'Brano';
    let file = null;
    try {
        file = await ytdl.downloadAudio(urlVideo(id), { quality: '128K' });
        if (fs.statSync(file).size > ytdl.MAX_UPLOAD) {
            return await i.editReply('❌ Il file supera il limite di upload di Discord (10 MB).');
        }
        await i.editReply({
            content: `🎧 **${titolo}**`,
            files: [new AttachmentBuilder(file, { name: `${nomeFile(titolo)}.mp3` })],
        });
    } catch (err) {
        console.error('Errore audio tp:', err.stderr || err.message);
        await i.editReply(ytdl.explainDownloadError(err, '❌ Errore audio')).catch(() => {});
    } finally {
        rimuovi(file);
    }
}

async function inviaVideo(i, uid, id) {
    if (ytdl.isBusy()) return i.reply({ content: '⏳ Sto già scaricando altri brani, riprova tra qualche secondo.', flags: MessageFlags.Ephemeral });
    await i.deferReply();
    const v = await videoDiCache(uid, id);
    if (v?.seconds > MAX_VIDEO_SEC) return i.editReply('❌ Max 8 minuti');
    await i.editReply('🎬 Scarico il video...');
    let file = null;
    try {
        file = await ytdl.downloadVideo(urlVideo(id), {
            durationHint: v?.seconds,
            onCompress: () => i.editReply('🎬 Comprimo il video per Discord...').catch(() => {}),
        });
        const titolo = v?.title || 'Video';
        await i.editReply({
            content: `🎬 **${titolo}**`,
            files: [new AttachmentBuilder(file, { name: `${nomeFile(titolo)}.mp4` })],
        });
    } catch (err) {
        console.error('Errore video tp:', err.stderr || err.message);
        await i.editReply(ytdl.explainDownloadError(err, '❌ Errore video')).catch(() => {});
    } finally {
        rimuovi(file);
    }
}

async function aggiungiAPlaylist(i, uid, id) {
    const v = await videoDiCache(uid, id);
    const link = urlVideo(id);
    const db = leggiPlaylist();
    db[uid] = db[uid] || [];
    if (db[uid].some((t) => t.url === link)) {
        return i.reply({ content: '⚠️ Questo brano è già presente nella tua playlist (.PL)!', flags: MessageFlags.Ephemeral });
    }
    db[uid].push({ url: link, title: v?.title || 'Brano', duration: v?.timestamp || '--:--' });
    try {
        scriviPlaylist(db);
    } catch (err) {
        console.error('[TP] Errore salvataggio playlist:', err.message);
        return i.reply({ content: '❌ Non riesco a salvare la playlist, riprova.', flags: MessageFlags.Ephemeral });
    }
    return i.reply({ content: `✅ Aggiunto alla tua playlist (.PL)!\n📌 **${v?.title || 'Brano'}**`, flags: MessageFlags.Ephemeral });
}

module.exports = {
    name: 'tp',
    commands: ['tp'],
    prefix: 'tp',
    desc: 'Le 5 canzoni più ascoltate di un cantante',
    tags: ['musica'],

    async run(message, ctx) {
        const artista = (ctx.rest || '').trim();
        if (!artista) return message.reply('🎧 Scrivi il nome del cantante! (Esempio: `!tp 18K`)');

        const uid = message.author.id;
        message.channel.sendTyping?.().catch(() => {});

        let videos;
        try {
            videos = await cinqueMigliori(artista);
        } catch (err) {
            console.error('Errore ricerca top:', err.message);
            return message.reply('❌ Errore durante la ricerca, riprova tra poco.');
        }
        if (!videos.length) return message.reply(`❌ Nessun risultato per "${clip(artista, 60)}".`);

        const ora = Date.now();
        for (const [k, val] of cache) if (ora - val.ts > CACHE_MS) cache.delete(k);
        cache.set(uid, { ts: ora, artista, videos });

        return message.reply(scheda(uid, 0));
    },

    async onComponent(i) {
        const [, azione, uid, arg] = i.customId.split(':');
        if (azione === 'count') return;

        if (i.user.id !== uid) {
            return i.reply({ content: '⛔ Questi pulsanti non sono tuoi: scrivi `!tp <cantante>` per la tua ricerca.', flags: MessageFlags.Ephemeral });
        }

        if (azione === 'nav') {
            const card = scheda(uid, parseInt(arg, 10) || 0);
            if (!card) return i.reply({ content: '⌛ Ricerca scaduta, scrivi di nuovo `!tp <cantante>`.', flags: MessageFlags.Ephemeral });
            return i.update(card);
        }

        if (!YT_ID.test(arg || '')) {
            return i.reply({ content: '⌛ Pulsante scaduto, scrivi di nuovo `!tp <cantante>`.', flags: MessageFlags.Ephemeral });
        }
        switch (azione) {
            case 'audio': return inviaAudio(i, uid, arg);
            case 'video': return inviaVideo(i, uid, arg);
            case 'pl': return aggiungiAPlaylist(i, uid, arg);
            default: return i.reply({ content: '⌛ Pulsante scaduto, scrivi di nuovo `!tp <cantante>`.', flags: MessageFlags.Ephemeral });
        }
    },

    _test: { cinqueMigliori, scheda, cache },
};
