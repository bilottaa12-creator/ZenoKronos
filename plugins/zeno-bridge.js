const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const os = require('os');
const { MessageFlags, PermissionFlagsBits, Routes } = require('discord.js');

const ZENO_PLUGINS_DIR = path.join(__dirname, '..', 'zeno', 'plugins');

// Il main.js di Zeno usa process.env.TOKEN, il mio index.js DISCORD_TOKEN: li allineo
// (serve se qualche plugin di Zeno legge process.env.TOKEN)
process.env.TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;

// yt-dlp (usato dai plugin canzone) e' un programma a parte: il Build Command su Render lo
// scarica in bin/. Qui aggiungiamo bin/ al PATH, cosi' i plugin lo trovano anche senza
// toccare lo Start Command.
const BIN_DIR = path.join(__dirname, '..', 'bin');
process.env.PATH = `${BIN_DIR}${path.delimiter}${process.env.PATH || ''}`;

// Controlla all'avvio che i programmi esterni usati dai plugin siano raggiungibili
// (stessa ricerca nel PATH che fanno i plugin con execFile) e lo scrive nei log.
function checkTool(name, args, consequence) {
    execFile(name, args, { timeout: 15000 }, (err, stdout) => {
        if (err) {
            console.warn(`⚠️ [zeno-bridge] ${name} NON trovato (${err.code || err.message}): ${consequence} Controlla che il Build Command lo scarichi in bin/.`);
        } else {
            console.log(`✅ [zeno-bridge] ${name} pronto (${String(stdout).split('\n')[0].trim().slice(0, 40)})`);
        }
    });
}

function checkExternalTools() {
    checkTool('yt-dlp', ['--version'], 'audio e video dei plugin canzone non funzioneranno.');
    checkTool('ffmpeg', ['-version'], 'shazam, sticker e le conversioni audio non funzioneranno.');
}

// Cookie di YouTube (opzionale). Su Render si caricano come Secret File "cookies.txt": al
// runtime stanno in /etc/secrets/cookies.txt, in sola lettura. yt-dlp riscrive il file dei
// cookie a fine lavoro, quindi lo copiamo in una posizione scrivibile e lo indichiamo con un
// yt-dlp.conf accanto al programma: cosi' vale per tutti i plugin, senza modificarli.
const COOKIES_SRC = process.env.YT_COOKIES_FILE || '/etc/secrets/cookies.txt';
const COOKIES_DEST = path.join(os.tmpdir(), 'yt-cookies.txt');
const YTDLP_CONF = path.join(BIN_DIR, 'yt-dlp.conf');
const CONF_MARKER = '# generato da zeno-bridge';

function setupYtDlpCookies() {
    try {
        if (!fs.existsSync(COOKIES_SRC)) {
            // niente cookie: togliamo un'eventuale config lasciata da un avvio precedente
            if (fs.existsSync(YTDLP_CONF) && fs.readFileSync(YTDLP_CONF, 'utf8').startsWith(CONF_MARKER)) {
                fs.rmSync(YTDLP_CONF);
            }
            console.log('ℹ️ [zeno-bridge] Nessun cookies.txt: yt-dlp parte senza cookie di YouTube.');
            return;
        }
        // Formato Linux (LF): con i ritorni a capo di Windows yt-dlp da' "HTTP Error 400"
        const content = fs.readFileSync(COOKIES_SRC, 'utf8').replace(/\r\n/g, '\n');
        const first = content.split('\n')[0].trim();
        if (first !== '# Netscape HTTP Cookie File' && first !== '# HTTP Cookie File') {
            console.warn(`⚠️ [zeno-bridge] ${COOKIES_SRC} ignorato: la prima riga deve essere "# Netscape HTTP Cookie File" (formato Netscape).`);
            return;
        }
        fs.writeFileSync(COOKIES_DEST, content, { mode: 0o600 });
        fs.mkdirSync(BIN_DIR, { recursive: true });
        fs.writeFileSync(YTDLP_CONF, `${CONF_MARKER}\n--cookies ${COOKIES_DEST}\n`);
        console.log('✅ [zeno-bridge] Cookie di YouTube caricati: yt-dlp li userà.');
    } catch (err) {
        console.warn(`⚠️ [zeno-bridge] Impossibile preparare i cookie di YouTube: ${err.message}`);
    }
}

// I comandi di Zeno rispondono solo a questi prefissi. "!" e' riservato ai tuoi plugin:
// cosi' .ping (Zeno) e !ping (tuo) non possono mai scattare insieme.
const DEFAULT_PREFIX = '.';
const RESERVED_PREFIXES = ['!'];

const zenoPlugins = {};        // nomeFile -> funzione del plugin
const zenoModules = {};        // nomeFile -> modulo intero (serve per soloadmin / owner / prefix)
const components = new Map();  // prefisso customId -> modulo (bottoni, menu, modali)
let loaded = false;            // true dopo il primo caricamento dei plugin di Zeno
let listenersAttached = false;

// Alcuni plugin di Zeno la usano (scrittura JSON "atomica": prima un .tmp, poi rename)
global.saveJsonAtomic = function (filePath, data) {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
};

// ============================================
// HELPER DI ZENO (soloadmin, owner, prefix)
// Si leggono dagli stessi moduli caricati come plugin: cosi' lo stato che cambia
// un comando (es. .soloadminon) e' quello che i controlli leggono, anche dopo un reload.
// ============================================
function zenoHelper(file, name, fallback) {
    const fn = zenoModules[file]?.[name];
    return typeof fn === 'function' ? fn : fallback;
}
const helpers = {
    isSoloAdminActive: (guildId) => zenoHelper('soloadmin.js', 'isSoloAdminActive', () => false)(guildId),
    isOwner: (userId) => zenoHelper('owner.js', 'isOwner', () => false)(userId),
    getPrefix: () => zenoHelper('prefix.js', 'getPrefix', () => DEFAULT_PREFIX)(),
};

// ============================================
// CARICAMENTO PLUGIN DI ZENO (hot-reload)
// ============================================
async function loadZenoPlugins() {
    for (const k of Object.keys(zenoPlugins)) delete zenoPlugins[k];
    for (const k of Object.keys(zenoModules)) delete zenoModules[k];
    components.clear();
    global.zenoPluginsList = [];

    if (!fs.existsSync(ZENO_PLUGINS_DIR)) {
        console.warn('⚠️ [zeno-bridge] Cartella zeno/plugins non trovata.');
        return;
    }

    let okCount = 0;
    let failed = 0;

    for (const file of fs.readdirSync(ZENO_PLUGINS_DIR)) {
        if (!file.endsWith('.js')) continue;
        try {
            // ?update=... aggiorna la cache degli import, serve per il reload a caldo
            const mod = await import(`${pathToFileURL(path.join(ZENO_PLUGINS_DIR, file)).href}?update=${Date.now()}`);
            zenoModules[file] = mod; // prima del controllo: gli helper vanno bene anche senza export default

            if (typeof mod.default !== 'function') {
                throw new Error(`export default mancante o non e' una funzione (trovato: ${typeof mod.default})`);
            }

            zenoPlugins[file] = mod.default;
            if (typeof mod.messageHook === 'function') zenoPlugins[file].messageHook = mod.messageHook;
            if (mod.data) zenoPlugins[file].data = mod.data; // slash command
            if (mod.prefix && typeof mod.onComponent === 'function') components.set(mod.prefix, mod);

            let cmdName = mod.data?.name || file;
            if (!mod.data && mod.default.command?.source) {
                const firstAlias = mod.default.command.source.replace(/[\^$()]/g, '').split('|')[0];
                if (firstAlias) cmdName = firstAlias;
            }

            global.zenoPluginsList.push({
                file,
                name: cmdName,
                desc: mod.default.desc || '',
                tags: mod.default.tags || ['altro'],
                help: mod.default.help || [],
            });
            okCount++;
        } catch (err) {
            failed++;
            console.error(`❌ [zeno-bridge] Errore plugin ${file}: ${err.message}`);
        }
    }

    loaded = true;
    console.log(`✅ [zeno-bridge] Plugin di Zeno caricati: ${okCount} (${failed} falliti)`);
}

// ============================================
// SLASH COMMAND
// ============================================
async function registerSlashCommands(client) {
    const body = Object.values(zenoPlugins).filter((p) => p.data).map((p) => p.data.toJSON());
    for (const guild of client.guilds.cache.values()) {
        try {
            await client.rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body });
        } catch (err) {
            console.error(`❌ [zeno-bridge] Registrazione slash fallita in ${guild.name}: ${err.message}`);
        }
    }
}

async function reloadAll(client) {
    await loadZenoPlugins();
    await registerSlashCommands(client);
}

// ============================================
// CONTROLLI
// ============================================
// Modalita' "solo admin" di Zeno (vale per messaggi e slash command)
async function isAllowed(ctx, command) {
    if (!ctx.guildId) return true;
    if (!(await helpers.isSoloAdminActive(ctx.guildId))) return true;
    if (command === 'soloadminon' || command === 'soloadminoff') return true;
    const userId = ctx.user?.id ?? ctx.author?.id;
    if (await helpers.isOwner(userId)) return true;
    return ctx.member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
}

async function activePrefixes() {
    const list = [DEFAULT_PREFIX];
    try {
        const custom = await helpers.getPrefix();
        if (typeof custom === 'string' && custom && !RESERVED_PREFIXES.includes(custom) && !list.includes(custom)) {
            list.push(custom);
        }
    } catch (_) { /* si usa il prefisso di default */ }
    return list.sort((a, b) => b.length - a.length);
}

// ============================================
// SLASH, BOTTONI, MENU
// ============================================
async function handleInteraction(i, client) {
    try {
        if (i.isChatInputCommand()) {
            if (!(await isAllowed(i, i.commandName))) {
                return i.reply({ content: '⛔ Solo admin.', flags: MessageFlags.Ephemeral });
            }
            const plugin = Object.values(zenoPlugins).find((p) => p.data?.name === i.commandName);
            await plugin?.(i, { conn: client, text: '', command: i.commandName });
        } else if (i.isButton() || i.isStringSelectMenu() || i.isModalSubmit()) {
            // Bottone "Mi piace" di Spotify: in main.js era fuori dai plugin, lo teniamo qui
            if (i.isButton() && i.customId === 'like_spotify_song') {
                return i.reply({ content: '⭐ Brano aggiunto ai tuoi preferiti!', flags: MessageFlags.Ephemeral });
            }
            const [prefix] = i.customId.split(':');
            await components.get(prefix)?.onComponent(i, client);
        }
    } catch (err) {
        console.error(`❌ [zeno-bridge] Errore interazione: ${err.message}`);
        const msg = { content: '❌ Errore nel comando.', flags: MessageFlags.Ephemeral };
        if (i.deferred || i.replied) await i.followUp(msg).catch(() => {});
        else await i.reply(msg).catch(() => {});
    }
}

// ============================================
// PLUGIN PER IL MIO MOTORE
// ============================================
module.exports = {
    name: 'zeno-bridge',

    // Il motore chiama onReady a bot connesso: qui carichiamo i plugin di Zeno
    async onReady({ client }) {
        global.zenoConn = client;
        setupYtDlpCookies();
        checkExternalTools();
        globalThis.zeno = { reload: () => reloadAll(client) }; // usato da plugins/reload.js di Zeno
        await reloadAll(client);

        if (!listenersAttached) {
            listenersAttached = true;
            client.on('interactionCreate', (i) => handleInteraction(i, client));
            client.on('guildCreate', () => registerSlashCommands(client));
        }
    },

    // Il motore chiama onMessage per ogni messaggio (non ritorniamo mai true: non blocchiamo gli altri plugin)
    async onMessage(message, { client }) {
        if (!loaded || message.author.bot) return;

        // messageHook: gira su ogni messaggio, come in main.js
        for (const [name, plugin] of Object.entries(zenoPlugins)) {
            if (typeof plugin.messageHook !== 'function') continue;
            try {
                await plugin.messageHook(client, message);
            } catch (err) {
                console.error(`❌ [zeno-bridge] Errore messageHook in ${name}: ${err.message}`);
            }
        }

        const text = message.content?.trim();
        if (!text) return;

        const prefix = (await activePrefixes()).find((p) => text.startsWith(p));
        if (!prefix) return;

        const command = text.slice(prefix.length).trim().split(' ')[0].toLowerCase();
        const textArg = text.slice(prefix.length + command.length).trim();

        if (command === 'reload' && (await helpers.isOwner(message.author.id))) {
            await reloadAll(client);
            await message.reply('🟢 Plugin di Zeno ricaricati a caldo!');
            return;
        }

        if (!(await isAllowed(message, command))) return;

        for (const [name, plugin] of Object.entries(zenoPlugins)) {
            if (!plugin.command || !plugin.command.test(command)) continue;
            try {
                await plugin(message, { conn: client, text: textArg, command });
            } catch (err) {
                console.error(`❌ [zeno-bridge] Errore nel plugin "${name}" (comando "${command}"): ${err.message}`);
            }
        }
    },
};
