// lib/owner.js: il creatore del bot, letto dal .env (OWNER_ID) ad ogni controllo
function isOwner(id) {
    const owner = process.env.OWNER_ID;
    return Boolean(owner) && String(id) === String(owner);
}

module.exports = { isOwner };
