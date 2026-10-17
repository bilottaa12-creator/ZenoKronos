// plugins/ping.js: stato del bot. !ping e .ping (anche !stats, !status)
const os = require('os');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const MB = 1024 * 1024;

function formatUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d)}:${p(h)}:${p(m)}:${p(s)}`;
}

function buildPanel(client, latency) {
    const mem = process.memoryUsage();
    const embed = new EmbedBuilder()
        .setTitle('ZenoKronos System Monitor')
        .setColor(0x5865f2)
        .setDescription(
            `🌐 **Attività:** ${formatUptime(process.uptime())}\n`
            + `⚡ **Latenza:** ${latency} ms\n`
            + `📡 **Gateway:** ${Math.round(client.ws.ping)} ms\n\n`
            + `💾 **RAM server:** ${((os.totalmem() - os.freemem()) / MB).toFixed(0)} MB / ${(os.totalmem() / MB).toFixed(0)} MB\n`
            + `📊 **Processo:** ${(mem.rss / MB).toFixed(1)} MB`
        )
        .setFooter({ text: 'ZenoKronos • Pannello di controllo' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ping:refresh').setLabel('🔄 Aggiorna stato').setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [row] };
}

module.exports = {
    name: 'ping',
    commands: ['ping', 'stats', 'status'],
    prefix: 'ping',
    desc: 'Stato e risorse del bot',
    tags: ['info'],

    async run(message, ctx) {
        const latency = Math.max(0, Date.now() - message.createdTimestamp);
        return message.reply(buildPanel(ctx.client, latency));
    },

    async onComponent(i, client) {
        const latency = Math.max(0, Date.now() - i.createdTimestamp);
        return i.update(buildPanel(client, latency));
    },
};
