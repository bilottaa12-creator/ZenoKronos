// lib/commands.js
// Dispatcher dei comandi: accetta sia "!" sia "." come prefisso.
// Un plugin dichiara: commands: ['nome', 'alias'], run(message, ctx)
// e per i bottoni: prefix: 'nome' e onComponent(i, client)

const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const PREFIXES = ['!', '.'];

// "!Ping  a b" -> { prefix:'!', name:'ping', args:['a','b'], rest:'a b' }
// Ritorna null se il messaggio non è un comando.
function parse(content) {
    if (typeof content !== 'string') return null;
    const text = content.trim();
    const prefix = text[0];
    if (!PREFIXES.includes(prefix)) return null;

    const body = text.slice(1).trim();
    if (!body) return null;

    const [first, ...args] = body.split(/\s+/);
    const name = first.toLowerCase();
    if (!NAME_RE.test(name)) return null;

    return { prefix, name, args, rest: args.join(' ') };
}

// Mappa nome/alias -> plugin. In caso di nomi doppi tiene il primo e avvisa.
function buildRegistry(plugins) {
    const map = new Map();
    for (const plugin of plugins) {
        if (typeof plugin.run !== 'function' || !Array.isArray(plugin.commands)) continue;
        for (const raw of plugin.commands) {
            const key = String(raw).toLowerCase();
            if (map.has(key)) {
                console.warn(`⚠️ Comando "${key}" già usato da "${map.get(key).name}": ignorato in "${plugin.name}".`);
                continue;
            }
            map.set(key, plugin);
        }
    }
    return map;
}

// Esegue il comando se esiste. Ritorna true se un plugin lo ha gestito.
async function dispatch(message, ctx, registry) {
    const parsed = parse(message.content);
    if (!parsed) return false;

    const plugin = registry.get(parsed.name);
    if (!plugin) return false;

    try {
        await plugin.run(message, { ...ctx, ...parsed, plugin });
    } catch (err) {
        console.error(`❌ Errore nel comando "${parsed.name}" (${plugin.name}): ${err.message}`);
        if (err.stack) console.error(err.stack);
    }
    return true;
}

// Bottoni e menu: il customId è "prefisso:resto", es. "ping:refresh"
async function dispatchComponent(i, ctx, plugins) {
    const key = String(i.customId || '').split(':')[0];
    const plugin = plugins.find((p) => p.prefix === key && typeof p.onComponent === 'function');
    if (!plugin) return false;
    try {
        await plugin.onComponent(i, ctx.client);
    } catch (err) {
        console.error(`❌ Errore nel bottone "${key}" (${plugin.name}): ${err.message}`);
    }
    return true;
}

module.exports = { parse, buildRegistry, dispatch, dispatchComponent, PREFIXES };
