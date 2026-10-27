// plugins/help.js: !aiuto (o !comandi, !help, anche con il punto) -> elenco di tutti i comandi.
// Si aggiorna da solo: legge i comandi del bot (registro) e quelli di Zeno ancora caricati
// (global.zenoPluginsList). Quando un comando di Zeno viene convertito, passa da una lista all'altra.
// I plugin con il tag "nascosto" non compaiono.
const { EmbedBuilder } = require('discord.js');

const MAX_DESCRIZIONE = 4000;
const VIDEO = 'https://raw.githubusercontent.com/bilottaa12-creator/bot-sicurezza/main/assets/help-banner.mp4';

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
        if (!p.name || !p.desc || p.name.includes('.') || visti.has(p.name) || (p.tags || []).includes('nascosto')) continue;
        lista.push({ nome: p.name, comandi: [p.name], desc: p.desc || 'nessuna descrizione', tags: p.tags || [] });
        visti.add(p.name);
    }

    return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

// Comandi dei plugin non ancora convertiti: non dichiarano il proprio elenco, quindi li scriviamo qui.
// Quando un plugin viene convertito, togli la sua riga da questo testo: comparirà da solo nell'elenco sopra.
const ALTRI_TESTO = `**🔒 Sicurezza**
\`!scudo-lock\` / \`!scudo-unlock\` → blocca / ripristina tutti i canali
\`!purge <numero>\` → cancella in blocco gli ultimi messaggi (max 100)
\`!warn @utente <motivo>\` → richiamo (al 3° timeout automatico)
\`!warnings @utente\`, \`!unwarn @utente\`, \`!clearwarn @utente\` → gestione richiami
\`!antilink-on\` / \`!antilink-off\` → blocca link sospetti

**🎉 Divertimento**
\`!tux-on\` / \`!tux-off\` → modalità Tux (immagine ad ogni messaggio)
\`!parla\` / \`!parla-off\` → frasi assurde generate dall'AI
\`!duello @utente\` → sfida assurda, vince a caso
\`!palla <domanda>\` → palla magica (alias \`!8ball\`)
\`!quiz\` / \`!quizrank\` → quiz di cultura generale (30s per rispondere)
\`!ctf\` / \`!ctfrank\` → decifra la parola nascosta

**🤖 Intelligenza artificiale**
\`!ask <domanda>\` → domanda all'AI del bot

**ℹ️ Utility**
\`!server\` → statistiche del server (alias \`!serverinfo\`)
\`!top\` / \`!rank [@utente]\` → classifica dei membri più attivi
\`!afk [motivo]\` → ti segna come assente, risponde per te
\`!sondaggio [durata] <domanda> [| opzione1 | opzione2...]\` → sondaggio con reazioni`;

function altriComandi() {
    return new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle('📜 Altri comandi')
        .setDescription(ALTRI_TESTO)
        .setFooter({ text: 'Questi si sposteranno nell\'elenco sopra quando saranno convertiti' });
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
        // Come prima: il video di presentazione, poi l'elenco. Se il video non parte, va avanti lo stesso.
        await message.reply({ files: [VIDEO] }).catch((err) => console.error('[AIUTO] video:', err.message));
        await message.channel.send({ embeds: [costruisci(ctx.registry)] });
        return message.channel.send({ embeds: [altriComandi()] });
    },

    _test: { raccogli, costruisci, altriComandi },
};
