import yts from 'yt-search';
import fs from 'fs';
import path from 'path';
import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, AttachmentBuilder, MessageFlags,
} from 'discord.js';
import {
  MAX_UPLOAD, watchUrl, downloadAudio, downloadVideo, isBusy, explainDownloadError,
} from '../lib/ytdl.js';

const PLAYLIST_DB = path.resolve('playlist_db.json');
const YT_ID = /^[\w-]{11}$/;

// ---------- Limiti di durata ----------
// Oltre queste durate il file non entrerebbe nel limite di Discord: lo si dice subito,
// senza scaricare per niente. Il video viene ricompresso a 360p, quindi arriva a 8 minuti.
const AUDIO_BYTES_PER_SEC = 12_000;                                   // mp3 a 96 kbps
const MAX_AUDIO_SEC = Math.floor(MAX_UPLOAD / AUDIO_BYTES_PER_SEC);  // circa 14 minuti
const MAX_VIDEO_SEC = 480;                                            // 8 minuti

const readDb = (p) => {
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
};

// Tiene lettere accentate e altri alfabeti, toglie solo i caratteri non adatti a un nome file
const safeName = (t) => t.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 60) || 'zeno';

// "3:12" -> 192, "1:02:03" -> 3723, "N/D" -> 0 (0 = sconosciuta, nessun controllo)
export const toSeconds = (t = '') => {
  const parts = String(t).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

const formatMinutes = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
};

export const data = new SlashCommandBuilder()
  .setName('song')
  .setDescription('Cerca una canzone')
  .addStringOption((o) =>
    o.setName('query').setDescription('Titolo e artista').setRequired(true));

// Funziona sia con /song sia con .song / .play
async function song(ctx, { text } = {}) {
  const isSlash = Boolean(ctx.isChatInputCommand?.());
  const query = (isSlash ? ctx.options.getString('query') : text || '').trim();

  if (!query) return ctx.reply('❌ Inserisci il titolo della canzone! (Esempio: `.song bistia 18K`)');

  if (isSlash) await ctx.deferReply();
  else ctx.channel.sendTyping().catch(() => {});
  const send = (payload) => (isSlash ? ctx.editReply(payload) : ctx.reply(payload));

  let vid;
  try {
    const { videos } = await yts(query);
    vid = videos?.[0];
  } catch (e) {
    console.error('Errore ricerca song:', e.message);
    return send('❌ Errore durante la ricerca, riprova tra poco.');
  }
  if (!vid) return send(`❌ Nessun risultato trovato per: "${query}"`);

  const embed = new EmbedBuilder()
    .setTitle(vid.title)
    .setURL(vid.url)
    .setColor(0x5865f2)
    .setImage(vid.thumbnail || vid.image)
    .addFields(
      { name: '⏱️ Durata', value: vid.timestamp || 'N/D', inline: true },
      { name: '👁️ Visualizzazioni', value: (vid.views ?? 0).toLocaleString('it-IT'), inline: true },
      { name: '📺 Canale', value: vid.author?.name || 'N/D', inline: true },
    )
    .setFooter({ text: '⚡ ZenoKronos - Music Player' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`song:audio:${vid.videoId}`).setLabel('🎵 Audio').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`song:video:${vid.videoId}`).setLabel('🎬 Video MP4').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`song:pl:${vid.videoId}`).setLabel('➕ Aggiungi a .PL').setStyle(ButtonStyle.Success),
  );

  return send({ embeds: [embed], components: [row] });
}

song.command = /^(song|play)$/i;
song.help = ['song'];
song.tags = ['downloader'];
song.desc = 'Cerca una canzone e scaricala';

export default song;

// ---------- Bottoni sotto l'embed ----------
export const prefix = 'song';
export async function onComponent(i) {
  const [, action, id] = i.customId.split(':');
  if (!YT_ID.test(id || '')) {
    return i.reply({ content: '❌ Pulsante non valido.', flags: MessageFlags.Ephemeral });
  }

  const embed = i.message.embeds[0];
  const title = embed?.title || 'Brano';
  const duration = embed?.fields?.find((f) => f.name.includes('Durata'))?.value || '';

  // ➕ Playlist (.PL)
  if (action === 'pl') {
    const url = watchUrl(id);

    const db = readDb(PLAYLIST_DB);
    if (!db[i.user.id]) db[i.user.id] = [];

    if (db[i.user.id].some((t) => t.url === url)) {
      return i.reply({ content: '⚠️ Questo brano è già presente nella tua playlist (.PL)!', flags: MessageFlags.Ephemeral });
    }
    db[i.user.id].push({ url, title, duration });
    global.saveJsonAtomic(PLAYLIST_DB, db);

    return i.reply({ content: `✅ Aggiunto alla tua playlist (.PL)!\n📌 **${title}**`, flags: MessageFlags.Ephemeral });
  }

  // 🎵 Audio / 🎬 Video
  if (action === 'audio' || action === 'video') {
    // Controlli veloci prima di scaricare
    const seconds = toSeconds(duration);
    const maxSec = action === 'audio' ? MAX_AUDIO_SEC : MAX_VIDEO_SEC;
    if (seconds > maxSec) {
      return i.reply({
        content: `❌ Dura ${formatMinutes(seconds)}: oltre ${formatMinutes(maxSec)} non entra nel limite di ${MAX_UPLOAD / 1024 / 1024} MB di Discord.${action === 'video' ? ' Prova con 🎵 Audio.' : ''}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    if (isBusy()) {
      return i.reply({ content: '⏳ Sto già scaricando altri brani, riprova tra qualche secondo.', flags: MessageFlags.Ephemeral });
    }

    let file = null;
    try {
      await i.deferReply();
      file = action === 'audio'
        ? await downloadAudio(watchUrl(id), { quality: '96K' })
        : await downloadVideo(watchUrl(id), {
          durationHint: seconds || undefined,
          onCompress: () => i.editReply('🎬 Comprimo il video per Discord...').catch(() => {}),
        });
      console.log('[song] file pronto, invio a Discord...');

      if (fs.statSync(file).size > MAX_UPLOAD) {
        return await i.editReply(`❌ Il file supera il limite di upload di Discord (${MAX_UPLOAD / 1024 / 1024} MB).`);
      }

      await i.editReply({
        content: `${action === 'audio' ? '🎵' : '🎬'} **${title}**`,
        files: [new AttachmentBuilder(file, { name: `${safeName(title)}${path.extname(file)}` })],
      });
    } catch (e) {
      console.error(`Errore download ${action}:`, e.stderr || e.message);
      await i.editReply(explainDownloadError(e)).catch(() => {});
    } finally {
      if (file) fs.rmSync(file, { force: true });
    }
  }
}
