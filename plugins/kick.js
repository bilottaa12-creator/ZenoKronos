// plugins/kick.js: espelle un utente. !kick @utente [motivo] oppure .kick (rispondendo a un messaggio)
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../lib/owner');

const MENZIONE = /<@!?(\d+)>/;

module.exports = {
    name: 'kick',
    commands: ['kick'],
    desc: 'Espelle un utente dal server',
    tags: ['moderazione'],

    async run(message, ctx) {
        const guild = message.guild;
        if (!guild) return message.reply('❌ Questo comando funziona solo nei server.');

        const senderId = message.author.id;
        const sender = message.member || await guild.members.fetch(senderId).catch(() => null);
        const puoEspellere = sender?.permissions.has(PermissionFlagsBits.KickMembers)
            || sender?.permissions.has(PermissionFlagsBits.Administrator);
        if (!isOwner(senderId) && !puoEspellere) {
            return message.reply('❌ Non hai il permesso **Espelli membri**. Solo admin o owner possono usare questo comando.');
        }

        // Bersaglio: menzione, oppure il messaggio a cui si risponde
        let target = null;
        const menzione = (ctx.rest || '').match(MENZIONE);
        if (menzione) {
            target = await guild.client.users.fetch(menzione[1]).catch(() => null);
        } else if (message.reference?.messageId) {
            const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            target = ref?.author || null;
        }

        if (!target) {
            return message.reply('❌ Devi menzionare un utente **o** rispondere a un suo messaggio.\n📌 Esempi: `!kick @utente spam` oppure rispondi a un messaggio con `.kick spam`');
        }

        if (target.id === guild.ownerId) return message.reply('🧠 Non puoi espellere il **proprietario del server**.');
        if (isOwner(target.id)) return message.reply('🧠 Non puoi espellere il **creatore del bot**.');
        if (target.id === guild.client.user.id) return message.reply('🤖 Non puoi espellere me stesso!');
        if (target.id === senderId) return message.reply('🤔 Non puoi espellere te stesso!');

        const targetMember = await guild.members.fetch(target.id).catch(() => null);
        if (!targetMember) return message.reply('❌ Utente non trovato nel server.');

        if (!isOwner(senderId) && sender && targetMember.roles.highest.position >= sender.roles.highest.position) {
            return message.reply('❌ Non puoi espellere un utente con un ruolo uguale o superiore al tuo.');
        }
        if (!targetMember.kickable) {
            return message.reply('❌ Non posso espellere questo utente (ruolo superiore al mio o permessi insufficienti).');
        }

        // Motivo: tutto il testo dopo la menzione (senza il nome del comando, già tolto dal dispatcher)
        const motivo = (ctx.rest || '').replace(/<@!?\d+>/g, '').trim() || 'Nessun motivo specificato';

        // Avviso in DM prima di espellere; se i DM sono chiusi si va avanti lo stesso
        await target.createDM()
            .then((dm) => dm.send(`🚫 **Sei stato espulso da ${guild.name}**\n📝 Motivo: ${motivo}`))
            .catch(() => {});

        try {
            await targetMember.kick(`${motivo} | Mod: ${senderId}`);
        } catch (err) {
            console.error('[KICK] Errore:', err.message);
            return message.reply('❌ Errore durante l\'espulsione. Controlla che io abbia il permesso **Espelli membri** e un ruolo superiore all\'utente.');
        }

        // Da qui in poi l'espulsione è riuscita: l'embed è solo una conferma, non deve mai dare errore
        const embed = new EmbedBuilder()
            .setColor(0xdc2626)
            .setTitle('🚫 Utente espulso')
            .addFields(
                { name: '👤 Utente', value: `${target} (\`${target.tag}\`)`, inline: false },
                { name: '🆔 ID', value: `\`${target.id}\``, inline: true },
                { name: '📝 Motivo', value: motivo, inline: false },
                { name: '👮 Moderatore', value: `${message.author}`, inline: true },
            )
            .setFooter({ text: 'ZenoKronos • Moderazione' })
            .setTimestamp();
        const avatar = target.displayAvatarURL?.({ extension: 'png', size: 256 });
        if (avatar && avatar.startsWith('http')) embed.setThumbnail(avatar);

        return message.reply({ embeds: [embed] });
    },
};
