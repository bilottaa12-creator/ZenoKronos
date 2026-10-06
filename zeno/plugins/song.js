import yts from 'yt-search';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, AttachmentBuilder, MessageFlags,
} from 'discord.js';

const run = promisify(execFile);
const PLAYLIST_DB = path.resolve('playlist_db.json');
const YT_ID = /^[\w-]{11}$/;

// ---------- Limiti ----------
const MAX_UPLOAD = 10 * 1024 * 1024;   // limite upload Discord senza boost
const AUDIO_BYTES_PER_SEC = 12_000;    // mp3 a 96 kbps
const VIDEO_BYTES_PER_SEC = 70_000;    // mp4 circa 360p, audio compreso
// Durata massima oltre la quale il file non entrerebbe nel limite di Discord:
// cosi' lo si dice subito, senza scaricare per niente.
const MAX_AUDIO_SEC = Math.floor(MAX_UPLOAD / AUDIO_BYTES_PER_SEC);
const MAX_VIDEO_SEC = Math.floor(MAX_UPLOAD / VIDEO_BYTES_PER_SEC);
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000;
const MAX_PARALLEL = 2;                // download contemporanei (il server ha poca RAM)
let activeDownloads = 0;

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
    .setFooter({ text: '⚡ Zeno Bot - Music Player' });

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

// ---------- Download con yt-dlp (execFile: nessuna shell, niente injection) ----------
export function buildYtDlpArgs(kind, outTemplate, url) {
  const common = [
    '--no-playlist', '-q', '--no-warnings', '--no-progress',
    '--retries', '2', '--socket-timeout', '20',
    // YouTube ha bisogno di un runtime JavaScript, ma yt-dlp di default cerca solo "deno":
    // qui c'e' Node, quindi lo abilitiamo. Non forziamo piu' i client (android non supporta i cookie).
    '--js-runtimes', 'node',
    // stampa il percorso esatto del file finale
    '--print', 'after_move:filepath',
    '-o', outTemplate,
  ];
  const format = kind === 'audio'
    ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '96K']
    : ['-f', 'b[ext=mp4][height<=480]/bv*[ext=mp4][height<=480]+ba[ext=m4a]/b[height<=480]/b', '--merge-output-format', 'mp4'];
  return [...format, ...common, url];
}

// Suffisso casuale: due persone che scaricano lo stesso brano insieme non devono condividere i file
const tempBase = (id) => path.join(os.tmpdir(), `zeno_${id}_${randomUUID().slice(0, 8)}`);

// Cancella tutto cio' che yt-dlp ha lasciato (anche i file parziali dopo un errore)
function cleanup(base) {
  const prefixName = path.basename(base);
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith(prefixName)) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  }
}

async function download(id, kind, base) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const { stdout } = await run('yt-dlp', buildYtDlpArgs(kind, `${base}.%(ext)s`, url), {
    timeout: DOWNLOAD_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024,
  });

  const printed = stdout.trim().split('\n').pop();
  if (printed && fs.existsSync(printed)) return printed;

  // Se yt-dlp non ha stampato il percorso, si cerca per nome tra i file temporanei
  const ext = kind === 'audio' ? '.mp3' : '.mp4';
  const found = fs.readdirSync(os.tmpdir())
    .find((f) => f.startsWith(path.basename(base)) && f.endsWith(ext));
  return found ? path.join(os.tmpdir(), found) : null;
}

// Messaggio chiaro per chi usa il bot. L'errore completo resta nei log del server.
export function explainDownloadError(e) {
  const log = `${e?.stderr || ''} ${e?.message || ''}`;
  if (e?.code === 'ENOENT') return '❌ Sul server manca yt-dlp: avvisa gli admin del bot.';
  if (e?.killed || e?.signal === 'SIGTERM') return '❌ Il download ha impiegato troppo tempo, riprova.';
  if (/Sign in to confirm you.re not a bot/i.test(log)) {
    return '❌ YouTube sta bloccando i download dal server del bot. Riprova più tardi o avvisa gli admin.';
  }
  if (/ffprobe and ffmpeg not found|ffmpeg not found/i.test(log)) return '❌ Sul server manca ffmpeg: avvisa gli admin del bot.';
  if (/HTTP Error 429|Too Many Requests/i.test(log)) return '❌ Troppe richieste a YouTube, riprova tra qualche minuto.';
  if (/Video unavailable|Private video|This video is (?:not available|private)|has been removed|blocked it/i.test(log)) {
    return '❌ Questo video non è disponibile per il download.';
  }
  if (/confirm your age|age-restricted|age restricted/i.test(log)) return '❌ Questo video ha una restrizione di età e non si può scaricare.';
  if (/Requested format is not available/i.test(log)) return '❌ Formato non disponibile per questo video.';
  return '❌ Errore durante il download.';
}

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
    const url = `https://www.youtube.com/watch?v=${id}`;

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
      const hint = action === 'video' ? ' Prova con 🎵 Audio.' : '';
      return i.reply({
        content: `❌ Dura ${formatMinutes(seconds)}: oltre ${formatMinutes(maxSec)} non entra nel limite di ${MAX_UPLOAD / 1024 / 1024} MB di Discord.${hint}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    if (activeDownloads >= MAX_PARALLEL) {
      return i.reply({ content: '⏳ Sto già scaricando altri brani, riprova tra qualche secondo.', flags: MessageFlags.Ephemeral });
    }

    activeDownloads++;
    const base = tempBase(id);
    try {
      await i.deferReply();
      const file = await download(id, action, base);
      if (!file) throw new Error('file non generato');
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
      activeDownloads--;
      cleanup(base);
    }
  }
}
