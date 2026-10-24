// plugins/help.js: !aiuto (o !comandi, !help, anche con il punto) -> elenco di tutti i comandi.
// Si aggiorna da solo: legge i comandi del bot (registro) e quelli di Zeno ancora caricati
// (global.zenoPluginsList). Quando un comando di Zeno viene convertito, passa da una lista all'altra.
// I plugin con il tag "nascosto" non compaiono.
const { EmbedBuilder } = require('discord.js');

const MAX_DESCRIZIONE = 4000;

function raccogli(registry) {
    const lista = [];
    const visti = new Set();

    // 1) I nostri plugin: una voce per plugin, anche se ha più alias
    for (const plugin of new Set(registry ? registry.values() : [])) {
        const comandi = plugin.commands || [];
        if (!comandi.length || (plugin.tags || []).includes('nascosto')) continue;
        lista.push({ nome: comandi[0], comandi, desc: plugin.desc || 'nessuna descrizione', tags: plugin.tags || [] });
        visti.add(comandi[0]);
    }

    // 2) I plugin di Zeno ancora caricati dal bridge (se ce ne sono)
    for (const p of global.zenoPluginsList || []) {
        if (!p.name || visti.has(p.name) || (p.tags || []).includes('nascosto')) continue;
        lista.push({ nome: p.name, comandi: [p.name], desc: p.desc || 'nessuna descrizione', tags: p.tags || [] });
        visti.add(p.name);
    }

    return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

const maiuscola = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function costruisci(registry) {
    const voci = raccogli(registry);

    // Raggruppa per categoria (primo tag del plugin)
    const gruppi = new Map();
    for (const v of voci) {
        const cat = v.tags[0] ? maiuscola(v.tags[0]) : 'Altro';
        if (!gruppi.has(cat)) gruppi.set(cat, []);
        const alias = v.comandi.slice(1).map((c) => `\`${c}\``).join(', ');
        gruppi.get(cat).push(`\`!${v.nome}\` \`.${v.nome}\` → ${v.desc}${alias ? ` (alias: ${alias})` : ''}`);
    }

    let testo = '';
    for (const [cat, righe] of [...gruppi.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        testo += `**${cat}**\n${righe.join('\n')}\n\n`;
    }
    if (testo.length > MAX_DESCRIZIONE) {
        testo = testo.slice(0, MAX_DESCRIZIONE - 40) + '\n\n…(lista troncata)';
    }
    if (!testo) testo = 'Nessun comando caricato al momento.';

    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📖 Comandi di ZenoKronos')
        .setDescription(testo.trim())
        .setFooter({ text: `${voci.length} comandi · puoi scrivere ! oppure . davanti al nome` });
}

module.exports = {
    name: 'help',
    commands: ['aiuto', 'comandi', 'help'],
    desc: 'Elenco di tutti i comandi, aggiornato da solo',
    tags: ['info'],

    async run(message, ctx) {
        return message.reply({ embeds: [costruisci(ctx.registry)] });
    },

    _test: { raccogli, costruisci },
};
