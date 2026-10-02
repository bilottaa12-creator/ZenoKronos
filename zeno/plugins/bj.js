import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} from 'discord.js';

global.bjGames = global.bjGames || new Map(); // gameId -> stato partita

const isInteraction = (ctx) => typeof ctx.isChatInputCommand === 'function';
const genId = () => Math.random().toString(36).slice(2, 8);

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function buildShuffledDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard(game, hand) {
  if (!game.deck.length) game.deck = buildShuffledDeck(); // non dovrebbe mai servire con un solo mazzo
  hand.push(game.deck.pop());
}

function scoreOf(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { total += 11; aces++; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') total += 10;
    else total += parseInt(c.rank, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// "Soft" = c'è ancora un asso contato come 11 (il banco pesca anche sul 17 soft)
function isSoft(cards) {
  let raw = 0;
  let hasAce = false;
  for (const c of cards) {
    if (c.rank === 'A') { raw += 11; hasAce = true; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J') raw += 10;
    else raw += parseInt(c.rank, 10);
  }
  return hasAce && raw <= 21;
}

const cardStr = (c) => `\`${c.rank}${c.suit}\``;
const handStr = (cards) => cards.map(cardStr).join(' ');

function dealerPlay(game) {
  while (scoreOf(game.dealer) < 17 || (scoreOf(game.dealer) === 17 && isSoft(game.dealer))) {
    drawCard(game, game.dealer);
  }
  const pScore = scoreOf(game.player);
  const dScore = scoreOf(game.dealer);
  game.finished = true;
  if (dScore > 21) game.result = 'dealer_bust';
  else if (dScore > pScore) game.result = 'dealer_win';
  else if (dScore < pScore) game.result = 'player_win';
  else game.result = 'push';
}

// Nuova partita: mazzo, carte iniziali, controllo blackjack immediato
function freshGame(playerId) {
  const id = genId();
  const game = {
    id, playerId, deck: buildShuffledDeck(), player: [], dealer: [], finished: false, doubled: false,
  };
  global.bjGames.set(id, game);

  drawCard(game, game.player); drawCard(game, game.dealer);
  drawCard(game, game.player); drawCard(game, game.dealer);

  const pBJ = game.player.length === 2 && scoreOf(game.player) === 21;
  const dBJ = game.dealer.length === 2 && scoreOf(game.dealer) === 21;
  if (pBJ || dBJ) {
    game.finished = true;
    game.result = pBJ && dBJ ? 'push_blackjack' : pBJ ? 'player_blackjack' : 'dealer_blackjack';
    global.bjGames.delete(id);
  }
  return game;
}

function resultLine(game) {
  switch (game.result) {
    case 'player_blackjack': return '🂡 **Blackjack! Hai vinto!**';
    case 'dealer_blackjack': return '😬 Il banco ha fatto Blackjack. Hai perso.';
    case 'push_blackjack': return '🤝 Blackjack per entrambi: pareggio.';
    case 'player_bust': return `💥 Hai sballato con **${scoreOf(game.player)}**! Hai perso.`;
    case 'dealer_bust': return `🎉 Il banco ha sballato con **${scoreOf(game.dealer)}**! Hai vinto!`;
    case 'player_win': return '🎉 **Hai vinto!**';
    case 'dealer_win': return '😬 Ha vinto il banco.';
    case 'push': return '🤝 Pareggio.';
    default: return '';
  }
}

const resultColor = (r) => (
  ['player_blackjack', 'dealer_bust', 'player_win'].includes(r) ? 0x2ecc71
    : ['dealer_blackjack', 'player_bust', 'dealer_win'].includes(r) ? 0xe74c3c
      : 0x95a5a6
);

function buildPayload(game) {
  const pScore = scoreOf(game.player);
  const dScore = scoreOf(game.dealer);
  const dealerStr = game.finished ? handStr(game.dealer) : `${cardStr(game.dealer[0])} \`🂠\``;

  let desc = `**Le tue carte:** ${handStr(game.player)}  *(${pScore})*\n`
    + `**Carte del banco:** ${dealerStr}${game.finished ? `  *(${dScore})*` : ''}`;
  desc += game.finished ? `\n\n${resultLine(game)}` : '\n\nCosa fai?';

  const embed = new EmbedBuilder()
    .setTitle('🂡 Blackjack')
    .setColor(game.finished ? resultColor(game.result) : 0x5865f2)
    .setDescription(desc)
    .setFooter({ text: 'Zeno Bot • Blackjack' });

  const components = [];
  if (!game.finished) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj:hit:${game.id}`).setLabel('🃏 Carta').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj:stand:${game.id}`).setLabel('✋ Stai').setStyle(ButtonStyle.Secondary),
    );
    if (game.player.length === 2 && !game.doubled) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`bj:double:${game.id}`).setLabel('⏫ Raddoppia').setStyle(ButtonStyle.Success),
      );
    }
    components.push(row);
  } else {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj:again:${game.playerId}`).setLabel('🔄 Gioca ancora').setStyle(ButtonStyle.Primary),
    ));
  }

  return { content: '', embeds: [embed], components };
}

// ───────────── Comando: /bj  oppure  .bj ─────────────
export const data = new SlashCommandBuilder()
  .setName('bj')
  .setDescription('Gioca a Blackjack contro il banco');

async function bj(ctx) {
  const slash = isInteraction(ctx);
  const playerId = slash ? ctx.user.id : ctx.author.id;
  const game = freshGame(playerId);
  return ctx.reply(buildPayload(game));
}

bj.command = /^(bj|blackjack)$/i;
bj.help = ['bj'];
bj.tags = ['fun'];
bj.desc = 'Gioca a Blackjack contro il banco';

export default bj;

// ───────────── Pulsanti ─────────────
export const prefix = 'bj';
export async function onComponent(i) {
  const [, action, arg] = i.customId.split(':');

  if (action === 'again') {
    if (i.user.id !== arg) {
      return i.reply({ content: '⛔ Questa partita non è tua.', flags: MessageFlags.Ephemeral });
    }
    const game = freshGame(i.user.id);
    return i.update(buildPayload(game));
  }

  const game = global.bjGames.get(arg);
  if (!game || game.finished) {
    return i.reply({ content: '⌛ Partita non trovata o già conclusa. Usa `/bj` per ricominciare.', flags: MessageFlags.Ephemeral });
  }
  if (i.user.id !== game.playerId) {
    return i.reply({ content: '⛔ Questa partita non è tua.', flags: MessageFlags.Ephemeral });
  }

  if (action === 'hit') {
    drawCard(game, game.player);
    const score = scoreOf(game.player);
    if (score > 21) { game.finished = true; game.result = 'player_bust'; }
    else if (score === 21) dealerPlay(game); // 21 = stai automaticamente
  } else if (action === 'stand') {
    dealerPlay(game);
  } else if (action === 'double') {
    if (game.player.length !== 2 || game.doubled) {
      return i.reply({ content: '⛔ Puoi raddoppiare solo alla prima mossa.', flags: MessageFlags.Ephemeral });
    }
    game.doubled = true;
    drawCard(game, game.player);
    const score = scoreOf(game.player);
    if (score > 21) { game.finished = true; game.result = 'player_bust'; }
    else dealerPlay(game);
  }

  if (game.finished) global.bjGames.delete(arg);
  return i.update(buildPayload(game));
}
