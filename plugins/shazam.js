// plugins/shazam.js: riconosce una canzone da un audio o un video.
//   !shazam   con un audio/video allegato nello stesso messaggio, oppure rispondendo a un messaggio con allegato
// Bottoni sotto il risultato: Riproduci (mp3) e Aggiungi a .PL. Solo chi ha fatto il comando può usare i bottoni.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const ytsModulo = require('yt-search');
const ytdl = require('../lib/ytdl');

const run = promisify(execFile);
const yts = ytsModulo.default || ytsModulo;
const PLAYLIST_DB = path.resolve('playlist_db.json');
const YT_ID = /^[\w-]{11}$/;

// shazamio-api è un modulo ESM: si carica in modo asincrono, una volta sola
let riconoscitore = null;
async function getShazam() {
    if (!riconoscitore) {
        const modulo = await import('shazamio-api');
        riconoscitore = modulo.default || modulo;
    }
    return riconoscitore;
}

const tmp = (nome) => path.join(os.tmpdir(), nome);
const rimuovi = (p) => { try { if (p && fs.existsSync(p)) fs.rmSync(p, { force: true }); } catch {} };
const urlVideo = (id) => `https://www.youtube.com/watch?v=${id}`;

// Ultimo riconoscimento di ciascun utente, per i bottoni (in memoria, max 200 utenti)
const ultimi = new Map();
function ricordaUltimo(utenteId, dati) {
    if (ultimi.size >= 200) ultimi.delete(ultimi.keys().next().value);
    ultimi.set(utenteId, dati);
}

function leggiPlaylist() {
    if (!fs.existsSync(PLAYLIST_DB)) return {};
    try { return JSON.parse(fs.readFileSync(PLAYLIST_DB, 'utf8')); } catch { return {}; }
}
function scriviPlaylist(dati) {
    const tmpFile = `${PLAYLIST_DB}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(dati, null, 2), 'utf8');
    fs.renameSync(tmpFile, PLAYLIST_DB);
}

async function trovaAllegato(message) {
    let allegato = message.attachments?.first?.();
    if (!allegato && message.reference?.messageId) {
        const riferito = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        allegato = riferito?.attachments?.first?.();
    }
    return allegato || null;
}

module.exports = {
    name: 'shazam',
    commands: ['shazam'],
    prefix: 'shz',
    desc: 'Riconosce una canzone da un audio o video',
    tags: ['musica'],

    async run(message) {
        const allegato = await trovaAllegato(message);
        if (!allegato) {
            return message.reply('🎧 **Shazam**\n❌ Allega un audio o video con `!shazam`, oppure rispondi a un messaggio con audio o video e scrivi `!shazam`.');
        }
        const tipo = allegato.contentType || '';
        if (!tipo.startsWith('audio') && !tipo.startsWith('video')) {
            return message.reply('❌ Devi allegare (o citare) un audio o un video.');
        }

        await message.react('🔎').catch(() => {});
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const ext = tipo.startsWith('video') ? 'mp4' : path.extname(allegato.name || '.ogg') || '.ogg';
        const input = tmp(`zeno_shz_in_${id}${ext}`);
        const clip = tmp(`zeno_shz_clip_${id}.mp3`);

        try {
            const risposta = await fetch(allegato.url);
            if (!risposta.ok) throw new Error(`download allegato: ${risposta.status}`);
            fs.writeFileSync(input, Buffer.from(await risposta.arrayBuffer()));

            // Estrae 15 secondi di audio per il riconoscimento
            const args = ['-y', '-i', input, '-t', '15', '-ar', '44100', '-ac', '1'];
            if (tipo.startsWith('video')) args.push('-vn');
            args.push(clip);
            await run('ffmpeg', args, { timeout: 60 * 1000 });
            if (!fs.existsSync(clip)) throw new Error('estrazione audio fallita');

            const shazam = await getShazam();
            const risultato = await shazam.recognize(clip);
            const brano = risultato?.track;
            if (!brano) {
                await message.react('❌').catch(() => {});
                return message.reply('❌ Non sono riuscito a riconoscere questa canzone.');
            }

            const titolo = brano.title || 'Sconosciuto';
            const artista = brano.subtitle || 'Sconosciuto';
            const album = brano.sections?.find((s) => s.metadata)?.metadata?.find((md) => md.title === 'Album')?.text;
            const copertina = brano.images?.coverart;

            const embed = new EmbedBuilder()
                .setTitle('🎧 Shazam')
                .setColor(0x5865f2)
                .addFields({ name: '🎵 Titolo', value: titolo }, { name: '🎤 Artista', value: artista });
            if (album) embed.addFields({ name: '💿 Album', value: album });
            if (copertina) embed.setThumbnail(copertina);

            let riga = null;
            try {
                const cerca = await yts(`${artista} ${titolo}`);
                const video = cerca?.videos?.[0];
                if (video) {
                    ricordaUltimo(message.author.id, {
                        titolo: `${artista} - ${titolo}`,
                        url: video.url,
                        durata: video.timestamp || '--:--',
                    });
                    riga = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`shz:play:${message.author.id}`).setLabel('🎧 Riproduci').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(`shz:pl:${message.author.id}`).setLabel('➕ Aggiungi a .PL').setStyle(ButtonStyle.Success),
                    );
                }
            } catch (err) {
                console.error('Errore ricerca YouTube per shazam:', err.message);
            }

            await message.react('🎵').catch(() => {});
            return message.reply({ embeds: [embed], components: riga ? [riga] : [] });
        } catch (err) {
            console.error('Errore shazam:', err.message);
            await message.react('❌').catch(() => {});
            return message.reply('❌ Errore durante il riconoscimento della canzone.');
        } finally {
            rimuovi(input);
            rimuovi(clip);
        }
    },

    // Bottoni: Riproduci e Aggiungi a .PL
    async onComponent(i) {
        const [, azione, utenteId] = i.customId.split(':');
        if (i.user.id !== utenteId) {
            return i.reply({ content: '⛔ Questi pulsanti non sono tuoi: scrivi `!shazam` per fare il tuo riconoscimento.', flags: MessageFlags.Ephemeral });
        }
        const brano = ultimi.get(utenteId);
        if (!brano?.url) {
            return i.reply({ content: '❌ Brano non trovato o sessione scaduta. Scrivi di nuovo `!shazam`.', flags: MessageFlags.Ephemeral });
        }
        const trovato = brano.url.match(/[?&]v=([\w-]{11})/);
        if (!trovato || !YT_ID.test(trovato[1])) {
            return i.reply({ content: '❌ Link non valido.', flags: MessageFlags.Ephemeral });
        }

        if (azione === 'pl') {
            const db = leggiPlaylist();
            db[utenteId] = db[utenteId] || [];
            if (db[utenteId].some((t) => t.url === brano.url)) {
                return i.reply({ content: '⚠️ Questo brano è già presente nella tua playlist (.PL)!', flags: MessageFlags.Ephemeral });
            }
            db[utenteId].push(brano);
            try {
                scriviPlaylist(db);
            } catch (err) {
                console.error('[SHAZAM] Errore salvataggio playlist:', err.message);
                return i.reply({ content: '❌ Non riesco a salvare la playlist, riprova.', flags: MessageFlags.Ephemeral });
            }
            return i.reply({ content: `✅ Aggiunto alla tua playlist (.PL)!\n🎵 **${brano.titolo}**`, flags: MessageFlags.Ephemeral });
        }

        if (azione === 'play') {
            await i.deferReply();
            let file = null;
            try {
                file = await ytdl.downloadAudio(urlVideo(trovato[1]), { quality: '128K' });
                if (fs.statSync(file).size > ytdl.MAX_UPLOAD) {
                    return await i.editReply('❌ Il file supera il limite di upload di Discord (10 MB).');
                }
                await i.editReply({
                    content: `🎧 **${brano.titolo}**`,
                    files: [new AttachmentBuilder(file, { name: 'shazam.mp3' })],
                });
            } catch (err) {
                console.error('Errore download shazam:', err.stderr || err.message);
                await i.editReply(ytdl.explainDownloadError(err)).catch(() => {});
            } finally {
                rimuovi(file);
            }
        }
    },

    _test: { setRiconoscitore: (r) => { riconoscitore = r; }, ricordaUltimo },
};
