// plugins/sp.js: mostra il brano Spotify che un utente sta ascoltando. !sp oppure !sp @utente
// Richiede l'intent GuildPresences nel bot e il permesso "Presence Intent" nel Developer Portal.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');

const MENZIONE = /<@!?(\d+)>/;

// 185000 ms -> "3:05"
function formatta(ms) {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

module.exports = {
    _test: { formatta },
    name: 'sp',
    commands: ['sp'],
    desc: 'Mostra il brano Spotify in ascolto (tuo o di un utente)',
    tags: ['musica'],

    async run(message, ctx) {
        const guild = message.guild;
        if (!guild) return message.reply('❌ Questo comando funziona solo nei server.');

        let utenteId = message.author.id;
        const menzione = (ctx.rest || '').match(MENZIONE);
        if (menzione) utenteId = menzione[1];

        const membro = await guild.members.fetch({ user: utenteId, force: true }).catch(() => null);
        if (!membro) return message.reply('❌ Utente non trovato.');

        const attivita = membro.presence?.activities || [];
        const spotify = attivita.find((a) => a.type === ActivityType.Listening && (a.name === 'Spotify' || a.details));
        if (!spotify) {
            return message.reply(`⚠️ **${membro.user.username}** non sta ascoltando Spotify in questo momento (o la presenza non è condivisa).`);
        }

        let copertina = null;
        if (spotify.assets?.largeImage) {
            const id = spotify.assets.largeImage.replace('spotify:', '');
            copertina = `https://i.scdn.co/image/${id}`;
        }

        // Barra di avanzamento come nella card: usa i timestamp che Spotify manda (inizio e fine)
        const inizio = spotify.timestamps?.start;
        const fine = spotify.timestamps?.end;
        let avanzamento = '';
        if (inizio && fine && fine > inizio) {
            const totale = fine - inizio;
            const trascorso = Math.min(Math.max(Date.now() - inizio, 0), totale);
            const pieni = Math.round((trascorso / totale) * 14);
            avanzamento = `\n\n\`${formatta(trascorso)}\` ${'▰'.repeat(pieni)}${'▱'.repeat(14 - pieni)} \`${formatta(totale)}\``;
        }

        const embed = new EmbedBuilder()
            .setColor(0x1db954)
            .setAuthor({ name: `🎧 IN ASCOLTO ADESSO • ${membro.user.username}`, iconURL: membro.user.displayAvatarURL({ extension: 'png' }) })
            .setTitle(spotify.details || 'Brano sconosciuto')
            .setDescription(`🎤 **Artista:** ${spotify.state || 'Artista sconosciuto'}\n💿 **Album:** ${spotify.assets?.largeText || 'Album sconosciuto'}${avanzamento}`)
            .setFooter({ text: 'ZenoKronos • Spotify' })
            .setTimestamp();
        if (copertina) embed.setThumbnail(copertina);

        const riga = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('like:0').setLabel('0').setStyle(ButtonStyle.Secondary).setEmoji('⭐'),
        );
        return message.reply({ embeds: [embed], components: [riga] });
    },
};
