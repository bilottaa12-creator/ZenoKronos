// ============================================
// ZENO BRIDGE
// Ponte tra il tuo motore (index.js) e i plugin di ZenoBot (cartella zeno/plugins/).
// I plugin di Zeno restano IDENTICI: questo file parla il loro "linguaggio"
// (comando con regex, messageHook, slash command, bottoni) e si presenta al tuo
// motore come un plugin normale (name + onMessage + onReady).
// ============================================
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { MessageFlags, PermissionFlagsBits, Routes } = require('discord.js');

const ZENO_PLUGINS_DIR = path.join(__dirname, '..', 'zeno', 'plugins');

// Il main.js di Zeno usa process.env.TOKEN, il tuo index.js DISCORD_TOKEN: li allineo
// (serve se qualche plugin di Zeno legge process.env.TOKEN)
process.env.TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;

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
// PLUGIN PER IL TUO MOTORE
// ============================================
module.exports = {
    name: 'zeno-bridge',

    // Il motore chiama onReady a bot connesso: qui carichiamo i plugin di Zeno
    async onReady({ client }) {
        global.zenoConn = client;
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
