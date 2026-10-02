import {
  SlashCommandBuilder, EmbedBuilder, ActivityType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('sp')
  .setDescription('Mostra le informazioni Spotify del brano in ascolto')
  .addUserOption(option => 
    option.setName('utente').setDescription('Utente di cui vuoi vedere la canzone (opzionale)').setRequired(false)
  );

async function sp(ctx, { text = '' } = {}) {
  const isSlash = typeof ctx.isChatInputCommand === 'function';
  const guild = ctx.guild;
  
  if (!guild) return ctx.reply('❌ Questo comando funziona solo nei server.');

  let targetUser = isSlash ? ctx.options.getUser('utente') : null;
  if (!targetUser && !isSlash) {
    const mentionMatch = text.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      targetUser = await guild.client.users.fetch(mentionMatch[1]).catch(() => null);
    }
  }

  const memberId = targetUser ? targetUser.id : (isSlash ? ctx.user.id : ctx.author.id);
  const member = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);

  if (!member) {
    return ctx.reply({ content: '❌ Utente non trovato.', ephemeral: true });
  }

  const activities = member.presence?.activities || [];
  const spotifyActivity = activities.find(
    act => act.type === ActivityType.Listening && (act.name === 'Spotify' || act.details)
  );

  if (!spotifyActivity) {
    const nome = member.user.username;
    return ctx.reply({ content: `⚠ **${nome}** non sta ascoltando Spotify in questo momento (o la presenza non è condivisa/pubblica).`, ephemeral: true });
  }

  const songTitle = spotifyActivity.details || 'Brano sconosciuto';
  const artistName = spotifyActivity.state || 'Artista sconosciuto';
  const albumName = spotifyActivity.assets?.largeText || 'Album sconosciuto';
  
  let albumImageUrl = null;
  if (spotifyActivity.assets && spotifyActivity.assets.largeImage) {
    let imageId = spotifyActivity.assets.largeImage;
    if (imageId.startsWith('spotify:')) {
      imageId = imageId.replace('spotify:', '');
    }
    albumImageUrl = `https://i.scdn.co/image/${imageId}`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setAuthor({ 
      name: `${member.user.username} sta ascoltando Spotify`, 
      iconURL: member.user.displayAvatarURL({ extension: 'png' }) 
    })
    .setTitle(songTitle)
    .setDescription(`🎤 **Artista:** ${artistName}\n💿 **Album:** ${albumName}`)
    .setThumbnail(albumImageUrl)
    .setFooter({ text: 'Zeno Music ✦ 18K Bot', iconURL: guild.client.user.displayAvatarURL() })
    .setTimestamp();

  // Bottone con contatore stile TikTok (parte da 0)
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('like_sp_0')
        .setLabel('0')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⭐')
    );

  if (isSlash) {
    await ctx.reply({ embeds: [embed], components: [row] });
  } else {
    await ctx.channel.send({ embeds: [embed], components: [row] });
  }
}

sp.command = /^sp$/i;
sp.help = ['sp'];
sp.tags = ['utils', 'music'];
sp.desc = 'Mostra una card embed del brano Spotify in ascolto';

export default sp;
