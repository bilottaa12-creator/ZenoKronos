import yts from 'yt-search';
import fs from 'fs';
import path from 'path';
import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, MessageFlags,
} from 'discord.js';
import { MAX_UPLOAD, downloadAudio, downloadVideo, explainDownloadError, isBusy } from '../lib/ytdl.js';

const PLAYLIST_DB = path.resolve('playlist_db.json');
const MAX_VIDEO_SEC = 480;           // max 8 minuti per i video
const YT_ID = /^[\w-]{11}$/;
const COLOR = 0x5865f2;

global.tpCache = global.tpCache || new Map(); // uid -> { ts, artist, videos }

// ───────────── Utility ─────────────
const rm = (p) => { try { if (p && fs.existsSync(p)) fs.rmSync(p, { force: true }); } catch {} };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const safeName = (t) => (t || '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 60) || 'zeno';
const thumb = (v) => v?.thumbnail || v?.image || null;
const views = (v) => (v?.views ?? 0).toLocaleString('it-IT');
const cid = (action, uid, arg) => `tp:${action}:${uid}:${arg}`;
const url = (id) => `https://www.youtube.com/watch?v=${id}`;

const norm = (s) => (s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Titoli da scartare: compilation, cover, remix, dal vivo, ecc.
const BAD = /\b(mix|compilation|karaoke|reaction|cover|remix|slowed|sped up|nightcore|1 hour|playlist|best of|greatest hits|full album|live|tutorial|instrumental)\b/;

const readDb = () => {
  if (!fs.existsSync(PLAYLIST_DB)) return {};
  try { return JSON.parse(fs.readFileSync(PLAYLIST_DB, 'utf8')); } catch { return {}; }
};

// ───────────── Top 5 del cantante ─────────────
// Non esiste una classifica ufficiale accessibile: cerco i brani dell'artista su YouTube,
// scarto compilation/cover/live, tolgo i doppioni e ordino per visualizzazioni.
async function topSongs(artist) {
  const queries = [`${artist} official audio`, `${artist} official video`, artist];
  const results = await Promise.all(
    queries.map((q) => yts(q).then((r) => r.videos || []).catch(() => [])),
  );

  const seen = new Set();
  const all = results.flat().filter((v) => v?.videoId && !seen.has(v.videoId) && seen.add(v.videoId));

  const na = norm(artist);
  const usable = all.filter((v) => v.seconds >= 60 && v.seconds <= 600 && !BAD.test(norm(v.title)));
  const strict = usable.filter((v) => norm(v.title).includes(na) || norm(v.author?.name).includes(na));
  const pool = (strict.length ? strict : usable).sort((a, b) => (b.views || 0) - (a.views || 0));

  const keyOf = (v) => norm(v.title.replace(/[(\[].*?[)\]]/g, ''))
    .replace(na, '')
    .replace(/\b(official|audio|video|lyrics?|hd|4k|ft|feat|prod)\b.*$/, '')
    .trim() || v.videoId;

  const keys = new Set();
  const top = [];
  for (const v of pool) {
    const k = keyOf(v);
    if (keys.has(k)) continue;
    keys.add(k);
    top.push(v);
    if (top.length === 5) break;
  }
  return top;
}

async function getVideo(uid, id) {
  const hit = global.tpCache.get(uid)?.videos.find((v) => v.videoId === id);
  if (hit) return hit;
  try { return await yts({ videoId: id }); } catch { return null; }
}

// ───────────── Scheda scorrevole (carosello) ─────────────
// Una sola scheda per volta: le frecce ◀ ▶ scorrono tra le 5 canzoni (in modo circolare)
function buildCard(uid, index) {
  const entry = global.tpCache.get(uid);
  if (!entry?.videos?.length) return null;

  const { videos, artist } = entry;
  const n = videos.length;
  const idx = ((index % n) + n) % n;
  const v = videos[idx];

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(clip(`${idx + 1}. ${v.title}`, 250))
    .setURL(v.url || url(v.videoId))
    .setDescription(`📺 **Canale:** ${v.author?.name || 'Sconosciuto'}\n⏱️ **Durata:** ${v.timestamp || '—'}\n👁️ **Ascolti:** ${views(v)}`)
    .setFooter({ text: '⚡ Zeno Bot • Top Player' });
  if (thumb(v)) embed.setImage(thumb(v));

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('nav', uid, idx - 1)).setLabel('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tp:count').setLabel(`${idx + 1} / ${n}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(cid('nav', uid, idx + 1)).setLabel('▶️').setStyle(ButtonStyle.Secondary),
  );

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('audio', uid, v.videoId)).setLabel('🎧 Audio').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(cid('video', uid, v.videoId)).setLabel('🎥 Video').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid('pl', uid, v.videoId)).setLabel('🎵 Aggiungi a .PL').setStyle(ButtonStyle.Success),
  );

  return {
    content: `🏆 **Top ${n} di ${clip(artist, 60)}**\n_Scorri con le frecce e scegli la canzone:_`,
    embeds: [embed],
    components: [nav, actions],
  };
}

// ───────────── Azioni dei pulsanti ─────────────
const BUSY = '⏳ Sto già scaricando altri brani, riprova tra qualche secondo.';

async function sendAudio(i, uid, id) {
  if (isBusy()) return i.reply({ content: BUSY, flags: MessageFlags.Ephemeral });
  await i.deferReply();
  const v = await getVideo(uid, id);
  const title = v?.title || 'Brano';
  let file = null;
  try {
    file = await downloadAudio(url(id), { quality: '128K' });
    if (fs.statSync(file).size > MAX_UPLOAD) {
      return await i.editReply('❌ Il file supera il limite di upload di Discord (10 MB).');
    }
    await i.editReply({
      content: `🎧 **${title}**`,
      files: [new AttachmentBuilder(file, { name: `${safeName(title)}.mp3` })],
    });
  } catch (e) {
    console.error('Errore audio:', e.stderr || e.message);
    await i.editReply(explainDownloadError(e, '❌ Errore audio')).catch(() => {});
  } finally {
    rm(file);
  }
}

async function sendVideo(i, uid, id) {
  if (isBusy()) return i.reply({ content: BUSY, flags: MessageFlags.Ephemeral });
  await i.deferReply();
  const v = await getVideo(uid, id);
  if (v?.seconds > MAX_VIDEO_SEC) return i.editReply('❌ Max 8 minuti');

  await i.editReply('🎬 Scarico il video...');
  let file = null;
  try {
    // Se supera i 10 MB il modulo lo ricomprime a 360p con bitrate calcolato sulla durata
    file = await downloadVideo(url(id), {
      durationHint: v?.seconds,
      onCompress: () => i.editReply('🎬 Comprimo il video per Discord...').catch(() => {}),
    });
    const title = v?.title || 'Video';
    await i.editReply({
      content: `🎬 **${title}**`,
      files: [new AttachmentBuilder(file, { name: `${safeName(title)}.mp4` })],
    });
  } catch (e) {
    console.error('Errore video:', e.stderr || e.message);
    await i.editReply(explainDownloadError(e, '❌ Errore video')).catch(() => {});
  } finally {
    rm(file);
  }
}

async function addToPlaylist(i, uid, id) {
  const v = await getVideo(uid, id);
  const link = url(id);
  const db = readDb();
  db[uid] = db[uid] || [];

  if (db[uid].some((t) => t.url === link)) {
    return i.reply({ content: '⚠️ Questo brano è già presente nella tua playlist (.PL)!', flags: MessageFlags.Ephemeral });
  }
  db[uid].push({ url: link, title: v?.title || 'Brano', duration: v?.timestamp || '--:--' });
  global.saveJsonAtomic(PLAYLIST_DB, db);

  return i.reply({ content: `✅ Aggiunto alla tua playlist (.PL)!\n📌 **${v?.title || 'Brano'}**`, flags: MessageFlags.Ephemeral });
}

// ───────────── Comando: /tp cantante  oppure  .tp cantante ─────────────
export const data = new SlashCommandBuilder()
  .setName('tp')
  .setDescription('Le 5 canzoni più ascoltate di un cantante')
  .addStringOption((o) => o.setName('cantante').setDescription('Nome del cantante o del gruppo').setRequired(true));

async function tp(ctx, { text = '' } = {}) {
  const slash = typeof ctx.isChatInputCommand === 'function';
  const artist = (slash ? ctx.options.getString('cantante') : text).trim();
  if (!artist) return ctx.reply('🎧 Scrivi il nome del cantante! (Esempio: `.tp 18K`)');

  const uid = slash ? ctx.user.id : ctx.author.id;
  if (slash) await ctx.deferReply();
  else ctx.channel.sendTyping().catch(() => {});
  const send = (payload) => (slash ? ctx.editReply(payload) : ctx.reply(payload));

  let videos;
  try {
    videos = await topSongs(artist);
  } catch (e) {
    console.error('Errore ricerca top:', e.message);
    return send('❌ Errore durante la ricerca, riprova tra poco.');
  }
  if (!videos.length) return send(`❌ Nessun risultato per "${clip(artist, 60)}".`);

  // Cache dei risultati (1 ora) per scorrere le schede senza rifare la ricerca
  const now = Date.now();
  for (const [k, val] of global.tpCache) if (now - val.ts > 3600_000) global.tpCache.delete(k);
  global.tpCache.set(uid, { ts: now, artist, videos });

  return send(buildCard(uid, 0));
}

tp.command = /^tp$/i;
tp.help = ['tp'];
tp.tags = ['fun'];
tp.desc = 'Le 5 canzoni più ascoltate di un cantante';

export default tp;

// ───────────── Pulsanti ─────────────
export const prefix = 'tp';
export async function onComponent(i) {
  const [, action, uid, arg] = i.customId.split(':');

  if (i.user.id !== uid) {
    return i.reply({ content: '⛔ Questi pulsanti non sono tuoi: usa `/tp` per fare la tua ricerca.', flags: MessageFlags.Ephemeral });
  }

  if (action === 'nav') {
    const card = buildCard(uid, parseInt(arg, 10) || 0);
    if (!card) return i.reply({ content: '⌛ Ricerca scaduta, rifai `/tp`.', flags: MessageFlags.Ephemeral });
    return i.update(card);
  }

  if (!YT_ID.test(arg || '')) {
    return i.reply({ content: '⌛ Pulsante scaduto, rifai `/tp`.', flags: MessageFlags.Ephemeral });
  }

  switch (action) {
    case 'audio': return sendAudio(i, uid, arg);
    case 'video': return sendVideo(i, uid, arg);
    case 'pl': return addToPlaylist(i, uid, arg);
    default: return i.reply({ content: '⌛ Pulsante scaduto, rifai `/tp`.', flags: MessageFlags.Ephemeral });
  }
}
