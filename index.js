// ============================================
// SERVER HTTP PER RENDER
// ============================================
const http = require('http');
http.createServer((req, res) => res.end('Scudo Anti-Raid Online!')).listen(process.env.PORT || 10000);

// ============================================
// IMPORTAZIONI
// ============================================
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { connectDB } = require('./db');
const logger = require('./utils');
const { buildRegistry, dispatch, dispatchComponent } = require('./lib/commands');

// ============================================
// CONFIGURAZIONE
// ============================================
const TOKEN = process.env.DISCORD_TOKEN;
const PLUGINS_DIR = path.join(__dirname, 'plugins');

// ============================================
// VALIDAZIONE INIZIALE
// ============================================
if (!TOKEN) {
    console.error('❌ Variabile DISCORD_TOKEN non trovata. Verificare le impostazioni su Render.');
    process.exit(1);
}

// ============================================
// CONNESSIONE DATABASE
// ============================================
connectDB();

// ============================================
// CREAZIONE CLIENT DISCORD
// ============================================
const client = new Client({
    allowedMentions: { parse: [], repliedUser: false },
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences   // stato Spotify: serve a !sp (vedi Presence Intent nel portale)
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

// ============================================
// STATO CONDIVISO
// ============================================
const store = {};

// ============================================
// CARICAMENTO PLUGIN
// ============================================
function loadPlugins() {
    const plugins = [];
    
    if (!fs.existsSync(PLUGINS_DIR)) {
        console.warn('⚠️ Cartella plugins non trovata. Creazione...');
        fs.mkdirSync(PLUGINS_DIR, { recursive: true });
        return plugins;
    }

    const pluginFiles = fs.readdirSync(PLUGINS_DIR)
        .filter(file => file.endsWith('.js'));

    if (pluginFiles.length === 0) {
        console.warn('⚠️ Nessun plugin trovato nella cartella plugins/.');
        return plugins;
    }

    for (const file of pluginFiles) {
        const pluginPath = path.join(PLUGINS_DIR, file);
        const startTime = Date.now();

        try {
            const plugin = require(pluginPath);

            // Validazione struttura plugin
            if (!plugin || typeof plugin !== 'object') {
                console.warn(`⚠️ Plugin ${file} ignorato: export non valido.`);
                continue;
            }

            if (!plugin.name) {
                console.warn(`⚠️ Plugin ${file} ignorato: manca la proprietà "name".`);
                continue;
            }

            // Verifica che abbia almeno una funzione handler
            const hasHandler = ['onMessage', 'onAuditLogEntry', 'onMemberAdd', 'onReady']
                .some(method => typeof plugin[method] === 'function')
                || (Array.isArray(plugin.commands) && typeof plugin.run === 'function')
                || (typeof plugin.prefix === 'string' && typeof plugin.onComponent === 'function');

            if (!hasHandler) {
                console.warn(`⚠️ Plugin ${file} ignorato: nessun handler valido trovato.`);
                continue;
            }

            plugins.push(plugin);
            
            const loadTime = Date.now() - startTime;
            console.log(`✅ Plugin "${plugin.name}" caricato (${loadTime}ms)`);

        } catch (err) {
            console.error(`❌ Errore caricamento plugin ${file}: ${err.message}`);
            if (err.stack) {
                console.error(err.stack);
            }
        }
    }

    return plugins;
}

const plugins = loadPlugins();
const commandRegistry = buildRegistry(plugins);
console.log(`✅ Totale plugin caricati: ${plugins.length}`);

// ============================================
// HELPER PER ESECUZIONE SICURA DEI PLUGIN
// ============================================
async function executePluginMethod(plugins, methodName, args) {
    for (const plugin of plugins) {
        if (typeof plugin[methodName] !== 'function') continue;

        try {
            const result = await plugin[methodName](...args);
            
            // Se il plugin ritorna true, interrompe l'esecuzione degli altri
            if (result === true) {
                console.log(`🔍 Plugin "${plugin.name}" ha interrotto la catena.`);
                return true;
            }
        } catch (err) {
            console.error(`❌ Errore nel plugin "${plugin.name}" (${methodName}): ${err.message}`);
            if (err.stack) {
                console.error(err.stack);
            }
        }
    }
    return false;
}

// ============================================
// GESTIONE EVENTI
// ============================================

// Event: messageCreate
client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;
    const fermato = await executePluginMethod(plugins, 'onMessage', [message, { store, client }]);
    if (fermato) return;   // es. link bloccato dall'antilink: il messaggio non esegue comandi
    await dispatch(message, { store, client }, commandRegistry);
});

// Event: interactionCreate (bottoni e menu dei plugin)
client.on('interactionCreate', async (i) => {
    if (!(i.isButton?.() || i.isStringSelectMenu?.() || i.isModalSubmit?.())) return;
    await dispatchComponent(i, { store, client }, plugins);
});

// Event: guildAuditLogEntryCreate
client.on('guildAuditLogEntryCreate', async (entry, guild) => {
    await executePluginMethod(plugins, 'onAuditLogEntry', [entry, guild, { store, client }]);
});

// Event: guildMemberAdd
client.on('guildMemberAdd', async (member) => {
    await executePluginMethod(plugins, 'onMemberAdd', [member, { store, client }]);
});

// Event: ready
client.on('ready', () => {
    console.log(`✅ Bot online come ${client.user.tag}`);
    console.log(`✅ Server serviti: ${client.guilds.cache.size}`);
    console.log(`✅ Plugin attivi: ${plugins.length}`);
    
    // Esegue eventuali handler onReady nei plugin
    executePluginMethod(plugins, 'onReady', [{ store, client }]);
});

// ============================================
// GESTIONE ERRORI GLOBALE
// ============================================
client.on('debug', (info) => console.log(`🔍 ${info}`));
client.on('warn', (warning) => console.warn(`⚠️ ${warning}`));
client.on('error', (err) => console.error(`❌ Errore client Discord: ${err.message}`));

process.on('unhandledRejection', (reason, promise) => {
    console.error(`❌ Promise non gestita: ${reason}`);
    if (reason && reason.stack) {
        console.error(reason.stack);
    }
});

process.on('uncaughtException', (err) => {
    console.error(`❌ Eccezione non catturata: ${err.message}`);
    if (err.stack) {
        console.error(err.stack);
    }
    // Non uscire dal processo per evitare downtime su Render
});

// ============================================
// AVVIO DEL BOT
// ============================================
console.log('✅ Tentativo di connessione a Discord...');

client.login(TOKEN).catch(err => {
    console.error(`❌ Errore critico durante il login: ${err.message}`);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('✅ Ricevuto SIGTERM, chiusura in corso...');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('✅ Ricevuto SIGINT, chiusura in corso...');
    client.destroy();
    process.exit(0);
});
