// plugins/song.js: cerca una canzone su YouTube e la scarica. !song <titolo> oppure !play <titolo>
// Bottoni: Audio (mp3), Video MP4 (ricompresso se serve), Aggiungi a .PL.
const fs = require('fs');
const path = require('path');
const ytsModulo = require('yt-search');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const ytdl = require('../lib/ytdl');

const yts = ytsModulo.default || ytsModulo;
const PLAYLIST_DB = path.resolve('playlist_db.json');
const YT_ID = /^[\w-]{11}$/;

// Limiti di durata: oltre questi il file non entrerebbe nei 10 MB di Discord
const AUDIO_BYTES_PER_SEC = 12000;                                          // mp3 a 96 kbps
const MAX_AUDIO_SEC = Math.floor(ytdl.MAX_UPLOAD / AUDIO_BYTES_PER_SEC);   // circa 14 minuti
const MAX_VIDEO_SEC = 480;                                                 // 8 minuti

// "3:12" -> 192, "1:02:03" -> 3723, "N/D" -> 0 (sconosciuta: nessun controllo)
function toSeconds(t = '') {
    const parti = String(t).split(':').map(Number);
    if (parti.some((n) => !Number.isFinite(n))) return 0;
    return parti.reduce((acc, n) => acc * 60 + n, 0);
}

function formatMinuti(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m} min ${s} s` : `${m} min`;
}

const nomeFile = (t) => t.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 60) || 'zeno';

// Lettura e scrittura della playlist: scrittura atomica (file temporaneo + rinomina)
function leggiPlaylist() {
    if (!fs.existsSync(PLAYLIST_DB)) return {};
    try { return JSON.parse(fs.readFileSync(PLAYLIST_DB, 'utf8')); } catch { return {}; }
}
function scriviPlaylist(dati) {
    const tmp = `${PLAYLIST_DB}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dati, null, 2), 'utf8');
    fs.renameSync(tmp, PLAYLIST_DB);
}

module.exports = {
    name: 'song',
    commands: ['song', 'play'],
    prefix: 'song',
    desc: 'Cerca una canzone e scaricala (audio o video)',
    tags: ['musica'],

    async run(message, ctx) {
        const query = (ctx.rest || '').trim();
        if (!query) {
            return message.reply('❌ Inserisci il titolo della canzone! (Esempio: `!song bistia 18K`)');
        }
        message.channel.sendTyping?.().catch(() => {});

        let video;
        try {
            const risultato = await yts(query);
            video = risultato.videos?.[0];
        } catch (err) {
            console.error('Errore ricerca song:', err.message);
            return message.reply('❌ Errore durante la ricerca, riprova tra poco.');
        }
        if (!video) return message.reply(`❌ Nessun risultato trovato per: "${query}"`);

        const embed = new EmbedBuilder()
            .setTitle(video.title)
            .setURL(video.url)
            .setColor(0x5865f2)
            .setImage(video.thumbnail || video.image)
            .addFields(
                { name: '⏱️ Durata', value: video.timestamp || 'N/D', inline: true },
                { name: '👁️ Visualizzazioni', value: (video.views ?? 0).toLocaleString('it-IT'), inline: true },
                { name: '📺 Canale', value: video.author?.name || 'N/D', inline: true },
            )
            .setFooter({ text: '⚡ ZenoKronos • Music Player' });

        const riga = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`song:audio:${video.videoId}`).setLabel('🎵 Audio').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`song:video:${video.videoId}`).setLabel('🎬 Video MP4').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`song:pl:${video.videoId}`).setLabel('➕ Aggiungi a .PL').setStyle(ButtonStyle.Success),
        );
        return message.reply({ embeds: [embed], components: [riga] });
    },

    async onComponent(i) {
        const [, azione, id] = i.customId.split(':');
        if (!YT_ID.test(id || '')) {
            return i.reply({ content: '❌ Pulsante non valido.', flags: MessageFlags.Ephemeral });
        }

        const embed = i.message.embeds[0];
        const titolo = embed?.title || 'Brano';
        const durata = embed?.fields?.find((f) => f.name.includes('Durata'))?.value || '';

        // ➕ Playlist (.PL)
        if (azione === 'pl') {
            const url = ytdl.watchUrl(id);
            const db = leggiPlaylist();
            if (!db[i.user.id]) db[i.user.id] = [];
            if (db[i.user.id].some((t) => t.url === url)) {
                return i.reply({ content: '⚠️ Questo brano è già presente nella tua playlist (.PL)!', flags: MessageFlags.Ephemeral });
            }
            db[i.user.id].push({ url, title: titolo, duration: durata });
            try {
                scriviPlaylist(db);
            } catch (err) {
                console.error('[SONG] Errore salvataggio playlist:', err.message);
                return i.reply({ content: '❌ Non riesco a salvare la playlist, riprova.', flags: MessageFlags.Ephemeral });
            }
            return i.reply({ content: `✅ Aggiunto alla tua playlist (.PL)!\n📌 **${titolo}**`, flags: MessageFlags.Ephemeral });
        }

        // 🎵 Audio / 🎬 Video
        if (azione === 'audio' || azione === 'video') {
            const secondi = toSeconds(durata);
            const maxSec = azione === 'audio' ? MAX_AUDIO_SEC : MAX_VIDEO_SEC;
            if (secondi > maxSec) {
                return i.reply({
                    content: `❌ Dura ${formatMinuti(secondi)}: oltre ${formatMinuti(maxSec)} non entra nel limite di ${ytdl.MAX_UPLOAD / 1024 / 1024} MB di Discord.${azione === 'video' ? ' Prova con 🎵 Audio.' : ''}`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            if (ytdl.isBusy()) {
                return i.reply({ content: '⏳ Sto già scaricando altri brani, riprova tra qualche secondo.', flags: MessageFlags.Ephemeral });
            }

            let file = null;
            try {
                await i.deferReply();
                file = azione === 'audio'
                    ? await ytdl.downloadAudio(ytdl.watchUrl(id), { quality: '96K' })
                    : await ytdl.downloadVideo(ytdl.watchUrl(id), {
                        durationHint: secondi || undefined,
                        onCompress: () => i.editReply('🎬 Comprimo il video per Discord...').catch(() => {}),
                    });

                if (fs.statSync(file).size > ytdl.MAX_UPLOAD) {
                    return await i.editReply(`❌ Il file supera il limite di upload di Discord (${ytdl.MAX_UPLOAD / 1024 / 1024} MB).`);
                }
                await i.editReply({
                    content: `${azione === 'audio' ? '🎵' : '🎬'} **${titolo}**`,
                    files: [new AttachmentBuilder(file, { name: `${nomeFile(titolo)}${path.extname(file)}` })],
                });
            } catch (err) {
                console.error(`Errore download ${azione}:`, err.stderr || err.message);
                await i.editReply(ytdl.explainDownloadError(err)).catch(() => {});
            } finally {
                if (file) fs.rmSync(file, { force: true });
            }
        }
    },

    _test: { toSeconds, nomeFile },
};
