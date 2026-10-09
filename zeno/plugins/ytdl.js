// Download da YouTube condivisi da song.js, tp.js e pl.js.
// Tutto cio' che riguarda yt-dlp sta qui, cosi' un problema si sistema in un posto solo.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';

const run = promisify(execFile);

export const MAX_UPLOAD = 10 * 1024 * 1024;   // limite upload Discord senza boost
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000;
const COMPRESS_TIMEOUT = 10 * 60 * 1000;
// Download contemporanei. Sul piano free di Render la RAM e' 512 MB per TUTTO (bot + yt-dlp + ffmpeg):
// con 1 solo download alla volta il picco resta basso. Su un server con piu' RAM: YTDL_MAX_PARALLEL=2.
const MAX_PARALLEL = Math.max(1, Number(process.env.YTDL_MAX_PARALLEL) || 1);
const MAX_WAITING = 4;                        // oltre questa coda, i pulsanti rispondono "riprova"

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// ---------- Limite di download in parallelo (condiviso da tutti i plugin) ----------
let active = 0;
const waiters = [];

const acquire = () => new Promise((resolve) => {
  if (active < MAX_PARALLEL) { active++; resolve(); } else waiters.push(resolve);
});
const release = () => {
  const next = waiters.shift();
  if (next) next(); else active--;   // se c'e' chi aspetta, lo slot passa a lui
};

// true se c'e' gia' troppa gente in coda: i pulsanti rispondono subito invece di accodare altro
export const isBusy = () => waiters.length >= MAX_WAITING;

// ---------- File temporanei ----------
// Suffisso casuale: due download dello stesso brano insieme non devono condividere i file
const tempBase = (tag) => path.join(os.tmpdir(), `zeno_${tag}_${randomUUID().slice(0, 8)}`);

// Cancella tutto cio' che yt-dlp ha lasciato (anche i file parziali dopo un errore), tranne `keep`
function cleanup(base, keep = null) {
  const prefix = path.basename(base);
  for (const f of fs.readdirSync(os.tmpdir())) {
    const full = path.join(os.tmpdir(), f);
    if (f.startsWith(prefix) && full !== keep) fs.rmSync(full, { force: true });
  }
}

// yt-dlp stampa il percorso finale; se non lo fa si cerca per nome tra i file temporanei
function findOutput(stdout, base, ext) {
  const printed = stdout.trim().split('\n').pop();
  if (printed && fs.existsSync(printed)) return printed;
  const found = fs.readdirSync(os.tmpdir())
    .find((f) => f.startsWith(path.basename(base)) && f.endsWith(ext));
  return found ? path.join(os.tmpdir(), found) : null;
}

// ---------- Opzioni di yt-dlp (execFile: nessuna shell, niente injection) ----------
const VIDEO_FORMAT = 'bestvideo[vcodec^=avc1][height<=480]+bestaudio[acodec^=mp4a]/best[vcodec^=avc1][height<=480]/best[height<=480]/best';

export function buildYtDlpArgs(kind, output, url, { quality = '96K', ppArgs } = {}) {
  const common = [
    // Niente --no-warnings: gli avvisi di yt-dlp (per esempio "cookie non piu' validi") finiscono
    // nel log dell'errore, e senza di loro non si capisce perche' YouTube rifiuta.
    '--no-playlist', '-q', '--no-progress',
    '--retries', '2', '--socket-timeout', '20',
    // YouTube ha bisogno di un runtime JavaScript, ma yt-dlp di default cerca solo "deno":
    // qui c'e' Node, quindi lo abilitiamo. Non forziamo i client (android non supporta i cookie).
    '--js-runtimes', 'node',
    // stampa il percorso esatto del file finale
    '--print', 'after_move:filepath',
    '-o', output,
  ];
  const format = kind === 'audio'
    ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', quality,
      ...(ppArgs ? ['--postprocessor-args', ppArgs] : [])]
    : ['-f', VIDEO_FORMAT, '--merge-output-format', 'mp4', '--no-part'];
  return [...format, ...common, url];
}

// ---------- Audio ----------
// Ritorna il percorso dell'mp3. Chi chiama lo cancella dopo l'invio.
export async function downloadAudio(url, opts = {}) {
  await acquire();
  const base = tempBase('a');
  try {
    const { stdout } = await run('yt-dlp', buildYtDlpArgs('audio', `${base}.%(ext)s`, url, opts), {
      timeout: DOWNLOAD_TIMEOUT, maxBuffer: 10 * 1024 * 1024,
    });
    const file = findOutput(stdout, base, '.mp3');
    if (!file) throw new Error('file non generato');
    cleanup(base, file);
    return file;
  } catch (e) {
    cleanup(base);
    throw e;
  } finally {
    release();
  }
}

// ---------- Video ----------
// Se il file supera il limite lo ricomprime a 360p con un bitrate calcolato sulla durata.
async function probeDuration(file) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

async function fitVideo(raw, out, durationHint, onCompress) {
  if (fs.statSync(raw).size <= MAX_UPLOAD) return raw;

  const dur = (await probeDuration(raw)) || durationHint || 240;
  const videoKbps = Math.floor((MAX_UPLOAD * 0.9 * 8) / dur / 1000) - 64;
  if (videoKbps < 120) throw new Error('VIDEO_TOO_BIG');

  await onCompress?.();
  await run('ffmpeg', [
    '-y', '-threads', '1', '-i', raw,   // un thread solo: meno RAM, e il server ha poca CPU comunque
    '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '1',
    '-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`, '-bufsize', `${videoKbps * 2}k`,
    '-vf', 'scale=-2:360',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out,
  ], { timeout: COMPRESS_TIMEOUT, maxBuffer: 10 * 1024 * 1024 });

  if (fs.statSync(out).size > MAX_UPLOAD) throw new Error('VIDEO_TOO_BIG');
  return out;
}

// Ritorna il percorso dell'mp4 (gia' sotto i 10 MB). Chi chiama lo cancella dopo l'invio.
export async function downloadVideo(url, { durationHint, onCompress } = {}) {
  await acquire();
  const base = tempBase('v');
  const raw = `${base}_raw.mp4`;
  try {
    const { stdout } = await run('yt-dlp', buildYtDlpArgs('video', raw, url), {
      timeout: DOWNLOAD_TIMEOUT, maxBuffer: 10 * 1024 * 1024,
    });
    const rawFile = findOutput(stdout, base, '.mp4');
    if (!rawFile) throw new Error('file non generato');
    const final = await fitVideo(rawFile, `${base}_out.mp4`, durationHint, onCompress);
    cleanup(base, final);
    return final;
  } catch (e) {
    cleanup(base);
    throw e;
  } finally {
    release();
  }
}

// ---------- Messaggi d'errore ----------
// Messaggio chiaro per chi usa il bot. L'errore completo resta nei log del server.
// `fallback` e' il messaggio da usare quando la causa non e' riconosciuta.
export function explainDownloadError(e, fallback = '❌ Errore durante il download.') {
  const log = `${e?.stderr || ''} ${e?.message || ''}`;
  if (e?.message === 'VIDEO_TOO_BIG') return '❌ Video troppo pesante per il limite di Discord (10 MB).';
  if (e?.code === 'ENOENT') return '❌ Sul server manca un programma necessario (yt-dlp o ffmpeg): avvisa gli admin del bot.';
  if (e?.killed || e?.signal === 'SIGTERM') return '❌ Il download ha impiegato troppo tempo, riprova.';
  if (/cookies are no longer valid/i.test(log)) {
    return '❌ I cookie di YouTube del bot sono scaduti: avvisa gli admin, vanno esportati di nuovo.';
  }
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
  return fallback;
}
