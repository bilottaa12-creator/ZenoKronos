const { inviaLogSicurezza } = require('../utils');
const { isStaff } = require('../lib/staff');
const { Warning } = require('../db');

const SOGLIA_ESCALATION = 3;
const DURATA_TIMEOUT_MS = 10 * 60 * 1000; // 10 minuti

module.exports = {
    name: 'warn',

    async onMessage(message, ctx) {
        const content = message.content.trim();

        // !warn @utente <motivo>
        if (content.startsWith('!warn ') || content === '!warn') {
            if (!(await isStaff(message))) {
                await message.reply('❌ Solo mod/admin');
                return true;
            }

            const target = message.mentions.members?.first();
            if (!target) {
                await message.reply('Usa `!warn @utente <motivo>` per aggiungere un richiamo.');
                return true;
            }

            const motivo = content
                .replace('!warn', '')
                .replace(/<@!?\d+>/, '')
                .trim() || 'Nessun motivo specificato';

            let numeroRichiami;
            try {
                await Warning.create({
                    guildId: message.guildId,
                    userId: target.id,
                    motivo,
                    moderatore: message.author.tag
                });
                numeroRichiami = await Warning.countDocuments({ guildId: message.guildId, userId: target.id });
            } catch (err) {
                console.error('[ERRORE WARN - salvataggio]:', err.message);
                await message.reply('⚠️ Errore nel salvare il richiamo sul database. Riprova tra poco.');
                return true;
            }

            await message.reply(
                `⚠️ **${target.displayName}** ha ricevuto un richiamo (${numeroRichiami}/${SOGLIA_ESCALATION}).\n` +
                `Motivo: ${motivo}`
            );

            await inviaLogSicurezza(
                message.guild,
                `⚠️ **WARN**: ${target.displayName} richiamato da ${message.author.tag}. ` +
                `Motivo: ${motivo}. Totale richiami: ${numeroRichiami}.`
            );

            // Escalation al terzo richiamo
            if (numeroRichiami >= SOGLIA_ESCALATION) {
                try {
                    await target.timeout(DURATA_TIMEOUT_MS, `Escalation automatica: ${SOGLIA_ESCALATION} richiami raggiunti`);
                    await message.channel.send(
                        `🚨 **${target.displayName}** ha raggiunto ${SOGLIA_ESCALATION} richiami: timeout automatico di 10 minuti applicato.`
                    );
                    await inviaLogSicurezza(
                        message.guild,
                        `🚨 **ESCALATION AUTOMATICA**: ${target.displayName} messo in timeout (10 min) per aver raggiunto ${SOGLIA_ESCALATION} richiami.`
                    );
                } catch (err) {
                    console.error('[ERRORE WARN - escalation]:', err.message);
                    await inviaLogSicurezza(
                        message.guild,
                        `⚠️ Escalation fallita per ${target.displayName}: ${err.message}`
                    );
                }
            }

            return true;
        }

        // !warnings @utente (alias !avvisi)
        if (content.startsWith('!warnings') || content.startsWith('!avvisi')) {
            const target = message.mentions.members?.first() || message.member;

            let warnings;
            try {
                warnings = await Warning.find({ guildId: message.guildId, userId: target.id }).sort({ data: 1 });
            } catch (err) {
                console.error('[ERRORE WARN - lettura]:', err.message);
                await message.reply('⚠️ Errore nel recuperare i richiami. Riprova tra poco.');
                return true;
            }

            if (warnings.length === 0) {
                await message.reply(`✅ **${target.displayName}** non ha nessun richiamo.`);
                return true;
            }

            const lista = warnings
                .map((w, i) => `**${i + 1}.** ${w.motivo} — da ${w.moderatore}`)
                .join('\n');

            await message.reply(
                `⚠️ **Richiami di ${target.displayName}** (${warnings.length}/${SOGLIA_ESCALATION})\n\n${lista}`
            );
            return true;
        }

        // !unwarn @utente [numero] — solo mod/admin. Senza numero toglie l'ultimo richiamo.
        if (content.startsWith('!unwarn')) {
            if (!(await isStaff(message))) {
                await message.reply('❌ Solo mod/admin');
                return true;
            }

            const target = message.mentions.members?.first();
            if (!target) {
                await message.reply('Usa `!unwarn @utente [numero]` per togliere un richiamo (senza numero, toglie l\'ultimo).');
                return true;
            }

            let warnings;
            try {
                warnings = await Warning.find({ guildId: message.guildId, userId: target.id }).sort({ data: 1 });
            } catch (err) {
                console.error('[ERRORE UNWARN - lettura]:', err.message);
                await message.reply('⚠️ Errore nel recuperare i richiami. Riprova tra poco.');
                return true;
            }

            if (warnings.length === 0) {
                await message.reply(`✅ **${target.displayName}** non ha richiami da togliere.`);
                return true;
            }

            const numeroMatch = content.match(/\s(\d+)\s*$/);
            const indice = numeroMatch ? parseInt(numeroMatch[1], 10) - 1 : warnings.length - 1;

            if (indice < 0 || indice >= warnings.length) {
                await message.reply(`⚠️ Numero non valido. **${target.displayName}** ha ${warnings.length} richiami (usa un numero da 1 a ${warnings.length}).`);
                return true;
            }

            const rimosso = warnings[indice];
            try {
                await Warning.deleteOne({ _id: rimosso._id });
            } catch (err) {
                console.error('[ERRORE UNWARN - cancellazione]:', err.message);
                await message.reply('⚠️ Errore nel rimuovere il richiamo. Riprova tra poco.');
                return true;
            }

            await message.reply(
                `✅ Rimosso richiamo **${indice + 1}** di **${target.displayName}** ("${rimosso.motivo}"). ` +
                `Richiami rimanenti: ${warnings.length - 1}/${SOGLIA_ESCALATION}.`
            );
            await inviaLogSicurezza(
                message.guild,
                `🧹 Richiamo rimosso da ${target.displayName} ("${rimosso.motivo}") da parte di ${message.author.tag}.`
            );
            return true;
        }

        // !clearwarn @utente — solo mod/admin
        if (content.startsWith('!clearwarn')) {
            if (!(await isStaff(message))) {
                await message.reply('❌ Solo mod/admin');
                return true;
            }

            const target = message.mentions.members?.first();
            if (!target) {
                await message.reply('Usa `!clearwarn @utente` per azzerare i suoi richiami.');
                return true;
            }

            try {
                await Warning.deleteMany({ guildId: message.guildId, userId: target.id });
            } catch (err) {
                console.error('[ERRORE CLEARWARN]:', err.message);
                await message.reply('⚠️ Errore nell\'azzerare i richiami. Riprova tra poco.');
                return true;
            }

            await message.reply(`✅ Richiami di **${target.displayName}** azzerati.`);
            await inviaLogSicurezza(
                message.guild,
                `🧹 Richiami di ${target.displayName} azzerati da ${message.author.tag}.`
            );
            return true;
        }

        return false;
    }
};
