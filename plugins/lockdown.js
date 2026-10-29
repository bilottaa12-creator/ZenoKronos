const { PermissionFlagsBits } = require('discord.js');
const { inviaLogSicurezza } = require('../utils');
const { isStaff } = require('../lib/staff');

function getGuildStore(store, guildId) {
    if (!store[guildId]) store[guildId] = {};
    return store[guildId];
}

async function salvaSnapshotEBlocca(guild, guildStore) {
    try {
        const channels = await guild.channels.fetch();
        guildStore.lockedChannels = []; // Canali effettivamente modificati
        guildStore.modOverridesAggiunti = []; // {channelId, roleId} aggiunti solo per i mod

        // Ruoli che contengono "mod" nel nome (stessa logica di eModeratoreOAdmin)
        // Ruoli con poteri di moderazione (per permessi, non per nome)
        const ruoliMod = guild.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.ModerateMembers) || r.permissions.has(PermissionFlagsBits.ManageMessages) || r.permissions.has(PermissionFlagsBits.Administrator));

        for (const [channelId, channel] of channels) {
            if (channel && channel.isTextBased() && !channel.isThread()) {
                const override = channel.permissionOverwrites.resolve(guild.roles.everyone);
                const puoVedere = !override?.deny.has('ViewChannel');
                const puoInviare = !override?.deny.has('SendMessages');

                if (puoVedere && puoInviare) {
                    guildStore.lockedChannels.push(channelId);

                    try {
                        await channel.permissionOverwrites.edit(guild.roles.everyone, {
                            SendMessages: false,
                            SendMessagesInThreads: false,
                            AddReactions: false
                        });
                    } catch (err) {
                        console.error(`[ERRORE PERMESSI] Canale ${channel.name}:`, err.message);
                    }

                    // Per ogni ruolo "mod" senza già un override esplicito su questo canale,
                    // aggiungiamo un permesso esplicito così restano sempre in grado di scrivere,
                    // anche senza il permesso Amministratore reale su Discord.
                    for (const [, ruolo] of ruoliMod) {
                        const overrideEsistente = channel.permissionOverwrites.resolve(ruolo.id);
                        if (!overrideEsistente) {
                            try {
                                await channel.permissionOverwrites.edit(ruolo, {
                                    SendMessages: true,
                                    SendMessagesInThreads: true,
                                    AddReactions: true
                                });
                                guildStore.modOverridesAggiunti.push({ channelId, roleId: ruolo.id });
                            } catch (err) {
                                console.error(`[ERRORE PERMESSI MOD] Canale ${channel.name}, ruolo ${ruolo.name}:`, err.message);
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('[ERRORE LOCKDOWN]:', error);
    }
}

async function ripristinareDaSnapshot(guild, guildStore) {
    if (!guildStore.lockedChannels || guildStore.lockedChannels.length === 0) return;

    try {
        for (const channelId of guildStore.lockedChannels) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) {
                try {
                    await channel.permissionOverwrites.edit(guild.roles.everyone, {
                        SendMessages: null,
                        SendMessagesInThreads: null,
                        AddReactions: null
                    });
                } catch (err) {
                    console.error(`[ERRORE RIPRISTINO] Canale ${channel.name}:`, err.message);
                }
            }
        }

        // Rimuove SOLO i permessi mod che avevamo aggiunto noi durante il lock
        if (guildStore.modOverridesAggiunti) {
            for (const { channelId, roleId } of guildStore.modOverridesAggiunti) {
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    try {
                        await channel.permissionOverwrites.edit(roleId, {
                            SendMessages: null,
                            SendMessagesInThreads: null,
                            AddReactions: null
                        });
                    } catch (err) {
                        console.error(`[ERRORE RIPRISTINO MOD] Canale ${channel.name}:`, err.message);
                    }
                }
            }
        }

        guildStore.lockedChannels = [];
        guildStore.modOverridesAggiunti = [];
    } catch (error) {
        console.error('[ERRORE RIPRISTINO]:', error);
    }
}

module.exports = {
    name: 'lockdown',

    async onMessage(message, ctx) {
        const guildStore = getGuildStore(ctx.store, message.guildId);
        if (guildStore.serverBloccato === undefined) guildStore.serverBloccato = false;

        if (message.content.trim() === '!scudo-lock') {
            if (!(await isStaff(message))) {
                await message.reply('❌ Solo i Moderatori e gli Amministratori possono usare questo comando.');
                return true;
            }
            guildStore.serverBloccato = true;
            await message.reply('🔒 **ATTIVAZIONE LOCKDOWN IN CORSO...**');
            await salvaSnapshotEBlocca(message.guild, guildStore);
            await message.channel.send('🚨 **SERVER BLINDATO!** La scrittura nei canali pubblici è stata disattivata.');
            await inviaLogSicurezza(message.guild,
                `🔒 **Lockdown attivato** da <@${message.author.id}> (${message.author.tag})`
            );
            return true;
        }

        if (message.content.trim() === '!scudo-unlock') {
            if (!(await isStaff(message))) {
                await message.reply('❌ Solo i Moderatori e gli Amministratori possono usare questo comando.');
                return true;
            }
            guildStore.serverBloccato = false;
            await message.reply('🔓 **DISATTIVAZIONE LOCKDOWN IN CORSO...**');
            await ripristinareDaSnapshot(message.guild, guildStore);
            await message.channel.send('✅ **LOCKDOWN DISATTIVATO!** I canali sono stati ripristinati.');
            await inviaLogSicurezza(message.guild,
                `🔓 **Lockdown disattivato** da <@${message.author.id}> (${message.author.tag})`
            );
            return true;
        }

        if (guildStore.serverBloccato) {
            if (!(await isStaff(message))) {
                try {
                    await message.delete();
                } catch (err) {
                    console.error("Errore nell'eliminare il messaggio:", err.message);
                }
                return true;
            }
        }

        return false;
    }
};
