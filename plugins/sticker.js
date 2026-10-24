// plugins/sticker.js: trasforma una foto, GIF o breve video in uno sticker quadrato.
//   !s            con un allegato nello stesso messaggio, oppure rispondendo a un messaggio con allegato
//   !s <nome>     dà il nome allo sticker (2-30 caratteri)
// Lo sticker viene salvato nel server (serve il permesso Gestisci espressioni); se non si può, arriva il file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { AttachmentBuilder } = require('discord.js');

const run = promisify(execFile);
const MAX_INPUT = 25 * 1024 * 1024;   // file di partenza
const MAX_STICKER = 500 * 1024;       // limite Discord per gli sticker: 512 KB

// Ritaglio quadrato centrato, come gli sticker di Discord
const quadrato = (misura) =>
    `scale=${misura}:${misura}:force_original_aspect_ratio=increase:flags=lanczos,crop=${misura}:${misura}`;

const tmp = (nome) => path.join(os.tmpdir(), nome);
const rimuovi = (p) => { try { if (p && fs.existsSync(p)) fs.rmSync(p, { force: true }); } catch {} };

async function convertiStatico(input, out) {
    for (const misura of [320, 256]) {
        await run('ffmpeg', ['-y', '-i', input, '-frames:v', '1', '-vf', quadrato(misura), '-compression_level', '9', out], { timeout: 60 * 1000 });
        if (fs.statSync(out).size <= MAX_STICKER) return;
    }
    throw new Error('immagine troppo pesante');
}

async function convertiAnimato(input, out) {
    const tentativi = [
        { fps: 12, colori: 64, t: 3 },
        { fps: 10, colori: 48, t: 3 },
        { fps: 8, colori: 32, t: 2.5 },
        { fps: 8, colori: 24, t: 2 },
    ];
    for (const a of tentativi) {
        await run('ffmpeg', [
            '-y', '-t', String(a.t), '-i', input,
            '-vf', `fps=${a.fps},${quadrato(320)},split[a][b];[a]palettegen=max_colors=${a.colori}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
            '-loop', '0', out,
        ], { timeout: 2 * 60 * 1000 });
        if (fs.statSync(out).size <= MAX_STICKER) return;
    }
    throw new Error('animazione troppo pesante');
}

// Allegato nel messaggio, oppure in quello a cui si risponde
async function trovaAllegato(message) {
    let allegato = message.attachments?.first?.();
    if (!allegato && message.reference?.messageId) {
        const riferito = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        allegato = riferito?.attachments?.first?.();
    }
    return allegato || null;
}

module.exports = {
    name: 'sticker',
    commands: ['s', 'sticker'],
    desc: 'Trasforma foto, GIF o video in uno sticker del server',
    tags: ['media'],

    async run(message, ctx) {
        const allegato = await trovaAllegato(message);
        if (!allegato) {
            return message.reply('❌ *Istruzioni:* invia una foto, GIF o video con `!s` nel commento, oppure rispondi a un messaggio con un allegato e scrivi `!s`.');
        }

        const tipo = allegato.contentType || '';
        const animato = tipo.includes('gif') || tipo.startsWith('video');
        if (!animato && !tipo.startsWith('image')) {
            return message.reply('❌ Puoi convertire solo foto, GIF o brevi video!');
        }
        if (allegato.size > MAX_INPUT) return message.reply('❌ File troppo grande (max 25 MB).');

        await message.react('⏳').catch(() => {});
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const input = tmp(`zeno_st_in_${id}`);
        const estensione = animato ? 'gif' : 'png';
        const out = tmp(`zeno_st_out_${id}.${estensione}`);

        try {
            const risposta = await fetch(allegato.url);
            if (!risposta.ok) throw new Error(`download allegato: ${risposta.status}`);
            fs.writeFileSync(input, Buffer.from(await risposta.arrayBuffer()));

            if (animato) await convertiAnimato(input, out);
            else await convertiStatico(input, out);

            let nome = (ctx.rest || '').replace(/[^\w ]/g, '').trim().slice(0, 30);
            if (nome.length < 2) nome = `zeno_${Date.now().toString().slice(-5)}`;

            let creato = null;
            let motivo = '';
            if (message.guild) {
                try {
                    creato = await message.guild.stickers.create({
                        file: new AttachmentBuilder(out, { name: `sticker.${estensione}` }),
                        name: nome,
                        tags: 'zeno',
                        description: 'Creato da ZenoKronos',
                        reason: `Sticker creato da ${message.author.username}`,
                    });
                } catch (err) {
                    console.error('Errore creazione sticker:', err.message);
                    if (err.code === 30039) motivo = 'gli slot sticker del server sono pieni';
                    else if (err.code === 50013 || err.code === 50001) motivo = 'mi manca il permesso "Gestisci espressioni"';
                    else motivo = 'non sono riuscito a crearlo nel server';
                }
            }

            if (creato) {
                await message.channel.send({ stickers: [creato.id] });
                await message.reply(`✅ Sticker **${creato.name}** creato!`);
            } else {
                await message.reply({
                    content: motivo ? `⚠️ Sticker non salvato nel server: ${motivo}. Ecco il file quadrato:` : '✅ Ecco il tuo sticker!',
                    files: [new AttachmentBuilder(out, { name: `zeno_sticker.${estensione}` })],
                });
            }
            await message.react('✅').catch(() => {});
        } catch (err) {
            console.error('Errore sticker:', err.stderr || err.message);
            await message.react('❌').catch(() => {});
        } finally {
            await message.reactions?.cache?.get('⏳')?.users?.remove(message.client.user.id).catch(() => {});
            rimuovi(input);
            rimuovi(out);
        }
    },
};
