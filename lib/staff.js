// lib/staff.js: chi può usare i comandi di moderazione.
// Sì: creatore del bot (OWNER_ID nel .env), oppure chi ha Modera membri / Amministratore / Gestisci messaggi.
// NON si decide più dal nome dei ruoli: prima bastava un ruolo con "mod" nel nome.
const { PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('./owner');

function isStaff(message) {
    if (!message) return false;
    if (isOwner(message.author?.id)) return true;
    const m = message.member;
    if (!m) return false;
    return m.permissions.has(PermissionFlagsBits.ModerateMembers)
        || m.permissions.has(PermissionFlagsBits.Administrator)
        || m.permissions.has(PermissionFlagsBits.ManageMessages);
}

module.exports = { isStaff };
