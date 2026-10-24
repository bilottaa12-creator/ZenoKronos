module.exports = {
    name: 'ai-ask',

    async onMessage(message, ctx) {
        if (!message.content.startsWith('!ask ')) return false;

        const domanda = message.content.slice(5).trim();
        if (!domanda) {
            await message.reply('Scrivi una domanda dopo `!ask`, tipo `!ask cos\'è un bot?`');
            return true;
        }

        if (!process.env.GROQ_API_KEY) {
            console.error('[ERRORE AI-ASK]: variabile GROQ_API_KEY non impostata');
            await message.reply('⚠️ Funzione AI non configurata sul bot (manca la chiave API).');
            return true;
        }

        await message.channel.sendTyping();

        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
                },
                body: JSON.stringify({
                    model: 'openai/gpt-oss-120b',
                    messages: [
                        {
                            role: 'system',
                            content: 'Sei l\'assistente AI di questo server Discord. Rispondi sempre in italiano, in modo conciso (massimo 3-4 frasi) e naturale.'
                        },
                        { role: 'user', content: domanda }
                    ],
                    max_tokens: 512,
                    temperature: 0.8
                })
            });

            const data = await res.json();

            if (data.error) {
                console.error('[ERRORE AI-ASK]:', data.error.message);
                await message.reply('⚠️ Errore dall\'AI: ' + data.error.message);
                return true;
            }

            const risposta = data.choices[0].message.content.trim();
            await message.reply(risposta.slice(0, 2000)); // limite messaggi Discord

        } catch (err) {
            console.error('[ERRORE AI-ASK]:', err.message);
            await message.reply('⚠️ Qualcosa è andato storto, riprova tra poco.').catch(() => {});
        }

        return true;
    }
};
