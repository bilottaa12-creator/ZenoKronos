// plugins/bj.js: blackjack contro il banco. !bj oppure !blackjack
// Una partita per utente; le partite ferme da 15 minuti vengono chiuse da sole.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const partite = new Map();
const SCADENZA_MS = 15 * 60 * 1000;

const SEMI = ['♠', '♥', '♦', '♣'];
const RANGHI = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function mazzoMescolato() {
    const mazzo = [];
    for (const s of SEMI) for (const r of RANGHI) mazzo.push({ rank: r, suit: s });
    for (let i = mazzo.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mazzo[i], mazzo[j]] = [mazzo[j], mazzo[i]];
    }
    return mazzo;
}

function pesca(partita, mano) {
    if (!partita.mazzo.length) partita.mazzo = mazzoMescolato();
    mano.push(partita.mazzo.pop());
}

function punteggio(carte) {
    let totale = 0;
    let assi = 0;
    for (const c of carte) {
        if (c.rank === 'A') { totale += 11; assi++; }
        else if (['K', 'Q', 'J'].includes(c.rank)) totale += 10;
        else totale += parseInt(c.rank, 10);
    }
    while (totale > 21 && assi > 0) { totale -= 10; assi--; }
    return totale;
}

function morbida(carte) {
    let grezzo = 0;
    let asso = false;
    for (const c of carte) {
        if (c.rank === 'A') { grezzo += 11; asso = true; }
        else if (['K', 'Q', 'J'].includes(c.rank)) grezzo += 10;
        else grezzo += parseInt(c.rank, 10);
    }
    return asso && grezzo <= 21;
}

function turnoBanco(partita) {
    while (punteggio(partita.dealer) < 17 || (punteggio(partita.dealer) === 17 && morbida(partita.dealer))) {
        pesca(partita, partita.dealer);
    }
    const p = punteggio(partita.player);
    const d = punteggio(partita.dealer);
    partita.finished = true;
    if (d > 21) partita.esito = 'dealer_bust';
    else if (d > p) partita.esito = 'dealer_win';
    else if (d < p) partita.esito = 'player_win';
    else partita.esito = 'push';
}

function purgaVecchie() {
    const ora = Date.now();
    for (const [id, p] of partite) {
        if (ora - p.creata > SCADENZA_MS) partite.delete(id);
    }
}

function nuovaPartita(playerId, mazzo) {
    purgaVecchie();
    for (const [id, p] of partite) {
        if (p.playerId === playerId) partite.delete(id);
    }
    const partita = {
        id: Math.random().toString(36).slice(2, 8),
        playerId,
        mazzo: mazzo ? mazzo.slice() : mazzoMescolato(),
        player: [], dealer: [],
        finished: false, doubled: false, esito: null,
        creata: Date.now(),
    };
    partite.set(partita.id, partita);

    pesca(partita, partita.player);
    pesca(partita, partita.dealer);
    pesca(partita, partita.player);
    pesca(partita, partita.dealer);

    const bjGiocatore = partita.player.length === 2 && punteggio(partita.player) === 21;
    const bjBanco = partita.dealer.length === 2 && punteggio(partita.dealer) === 21;
    if (bjGiocatore || bjBanco) {
        partita.finished = true;
        partita.esito = bjGiocatore && bjBanco ? 'push_blackjack'
            : bjGiocatore ? 'player_blackjack' : 'dealer_blackjack';
        partite.delete(partita.id);
    }
    return partita;
}

const carta = (c) => `\`${c.rank}${c.suit}\``;
const mano = (carte) => carte.map(carta).join(' ');

const TESTI_ESITO = {
    player_blackjack: '🂡 **Blackjack! Hai vinto!**',
    dealer_blackjack: '😬 Il banco ha fatto Blackjack. Hai perso.',
    push_blackjack: '🤝 Blackjack per entrambi: pareggio.',
    player_bust: (p) => `💥 Hai sballato con **${punteggio(p.player)}**! Hai perso.`,
    dealer_bust: (p) => `🎉 Il banco ha sballato con **${punteggio(p.dealer)}**! Hai vinto!`,
    player_win: '🎉 **Hai vinto!**',
    dealer_win: '😬 Ha vinto il banco.',
    push: '🤝 Pareggio.',
};

function coloreEsito(esito) {
    if (['player_blackjack', 'dealer_bust', 'player_win'].includes(esito)) return 0x2ecc71;
    if (['dealer_blackjack', 'player_bust', 'dealer_win'].includes(esito)) return 0xe74c3c;
    return 0x95a5a6;
}

function testoEsito(p) {
    const t = TESTI_ESITO[p.esito];
    return typeof t === 'function' ? t(p) : (t || '');
}

function payload(p) {
    const pScore = punteggio(p.player);
    const dScore = punteggio(p.dealer);
    const bancoVisibile = p.finished ? mano(p.dealer) : `${carta(p.dealer[0])} \`🂠\``;

    let descrizione = `**Le tue carte:** ${mano(p.player)}  *(${pScore})*\n`
        + `**Carte del banco:** ${bancoVisibile}${p.finished ? `  *(${dScore})*` : ''}`;
    descrizione += p.finished ? `\n\n${testoEsito(p)}` : '\n\nCosa fai?';

    const embed = new EmbedBuilder()
        .setTitle('🂡 Blackjack')
        .setColor(p.finished ? coloreEsito(p.esito) : 0x5865f2)
        .setDescription(descrizione)
        .setFooter({ text: 'ZenoKronos • Blackjack' });

    const righe = [];
    if (!p.finished) {
        const riga = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bj:hit:${p.id}`).setLabel('🃏 Carta').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bj:stand:${p.id}`).setLabel('✋ Stai').setStyle(ButtonStyle.Secondary),
        );
        if (p.player.length === 2 && !p.doubled) {
            riga.addComponents(
                new ButtonBuilder().setCustomId(`bj:double:${p.id}`).setLabel('⏫ Raddoppia').setStyle(ButtonStyle.Success),
            );
        }
        righe.push(riga);
    } else {
        righe.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bj:again:${p.playerId}`).setLabel('🔄 Gioca ancora').setStyle(ButtonStyle.Primary),
        ));
    }
    return { embeds: [embed], components: righe };
}

module.exports = {
    name: 'bj',
    commands: ['bj', 'blackjack'],
    prefix: 'bj',
    desc: 'Gioca a Blackjack contro il banco',
    tags: ['giochi'],

    async run(message) {
        const partita = nuovaPartita(message.author.id);
        return message.reply(payload(partita));
    },

    async onComponent(i) {
        purgaVecchie();
        const [, azione, arg] = i.customId.split(':');

        if (azione === 'again') {
            if (i.user.id !== arg) {
                return i.reply({ content: '⛔ Questa partita non è tua.', flags: MessageFlags.Ephemeral });
            }
            return i.update(payload(nuovaPartita(i.user.id)));
        }

        const partita = partite.get(arg);
        if (!partita || partita.finished) {
            return i.reply({ content: '⌛ Partita non trovata o già conclusa. Scrivi `!bj` per ricominciare.', flags: MessageFlags.Ephemeral });
        }
        if (i.user.id !== partita.playerId) {
            return i.reply({ content: '⛔ Questa partita non è tua.', flags: MessageFlags.Ephemeral });
        }

        if (azione === 'hit') {
            pesca(partita, partita.player);
            const s = punteggio(partita.player);
            if (s > 21) { partita.finished = true; partita.esito = 'player_bust'; }
            else if (s === 21) turnoBanco(partita);
        } else if (azione === 'stand') {
            turnoBanco(partita);
        } else if (azione === 'double') {
            if (partita.player.length !== 2 || partita.doubled) {
                return i.reply({ content: '⛔ Puoi raddoppiare solo alla prima mossa.', flags: MessageFlags.Ephemeral });
            }
            partita.doubled = true;
            pesca(partita, partita.player);
            if (punteggio(partita.player) > 21) { partita.finished = true; partita.esito = 'player_bust'; }
            else turnoBanco(partita);
        }

        if (partita.finished) partite.delete(arg);
        return i.update(payload(partita));
    },
};
