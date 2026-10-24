// plugins/like.js: bottone a stella con contatore (toggle). Il customId è "like:<numero>".
// Ogni messaggio tiene la lista di chi ha messo like; per non riempire la memoria ne ricorda al massimo 500.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const MAX_MESSAGGI = 500;
const mi_piace = new Map();   // messageId -> Set(userId)

module.exports = {
    name: 'like',
    prefix: 'like',
    desc: 'Bottone a stella con contatore (toggle)',
    tags: ['utility'],

    async onComponent(i) {
        const messageId = i.message.id;
        if (!mi_piace.has(messageId)) {
            if (mi_piace.size >= MAX_MESSAGGI) mi_piace.delete(mi_piace.keys().next().value);
            mi_piace.set(messageId, new Set());
        }
        const utenti = mi_piace.get(messageId);

        let conteggio = parseInt(i.customId.split(':')[1], 10) || 0;
        const aveva = utenti.has(i.user.id);
        if (aveva) {
            utenti.delete(i.user.id);
            conteggio = Math.max(0, conteggio - 1);
        } else {
            utenti.add(i.user.id);
            conteggio++;
        }

        const riga = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`like:${conteggio}`)
                .setLabel(String(conteggio))
                .setStyle(aveva ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setEmoji('⭐'),
        );
        await i.update({ components: [riga] });
        await i.followUp({
            content: aveva ? '❌ Hai rimosso il "Mi piace" dal brano.' : '⭐ Brano aggiunto ai tuoi preferiti!',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    },
};
