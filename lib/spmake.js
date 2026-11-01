// lib/spmake.js: crea la card di Spotify come immagine PNG.
// Versione statica: lo sfondo animato (GIF) non c'è ancora. Se @napi-rs/canvas manca, ritorna null.
const { renderCard, hasCanvas } = require('./spcard');

async function makeCard(params) {
    if (!hasCanvas) return null;
    const s = await renderCard(params).catch((err) => {
        console.error('[SP] Errore card:', err.message);
        return null;
    });
    return s ? { buffer: s.buffer, color: s.color, ext: 'png' } : null;
}

module.exports = { makeCard };
