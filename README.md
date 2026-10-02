<div align="center">

# ⚡ ZenoKronos

**Bot Discord per Moderazione, Sicurezza, AI e Intrattenimento**

![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![NodeJS](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)
![Groq](https://img.shields.io/badge/Groq_AI-f34f29?style=for-the-badge&logo=fastapi&logoColor=white)

[![Invita ZenoKronos](https://img.shields.io/badge/🚀_Invita_il_Bot-0080FF?style=for-the-badge)](https://discord.com/oauth2/authorize?client_id=1536121062599688222&permissions=8&integration_type=0&scope=bot)
[![Top.gg](https://img.shields.io/badge/Top.gg-FF3366?style=for-the-badge&logo=top.gg&logoColor=white)](https://top.gg)

*Un solo bot, un solo token e un unico motore (`index.js`). Unisce le funzionalità di **SicurezzaBot** e i plugin di **ZenoBot**.*

</div>

---

## 📌 Indice
- [🚀 Informazioni sul Progetto](#-informazioni-sul-progetto)
- [⚡ Funzionalità Principali](#-funzionalità-principali)
  - [🛡️ Sicurezza & Moderazione (`!`)](#️-sicurezza--moderazione-)
  - [🤖 Intelligenza Artificiale (`!`)](#-intelligenza-artificiale-)
  - [🎉 Intrattenimento & Utility (`!`)](#-intrattenimento--utility-)
  - [🎵 ZenoBot Plugins (`.`)](#-zenobot-plugins-)
- [🧱 Architettura & Bridge](#-architettura--bridge)
- [🛠️ Configurazione & Deploy](#️️-configurazione--deploy)
- [🔌 Sviluppare Nuovi Plugin](#-sviluppare-nuovi-plugin)
- [🔒 Permessi Richiesti](#-permessi-richiesti)
- [👥 Autori](#-autori)

---

## 🚀 Informazioni sul Progetto

**ZenoKronos** nasce dall'unione di due progetti:
* **SicurezzaBot**: Sistema avanzato per sicurezza, moderazione automatica, AI e intrattenimento.
* **ZenoBot**: Collezione di oltre 60 plugin gestiti da Yervinboss.

Il bot gestisce due famiglie di comandi simultaneamente:
* **`!`** — Comandi nativi di sicurezza, AI e utility.
* **`.`** — Comandi gestiti dai plugin di ZenoBot.

---

## ⚡ Funzionalità Principali

### 🛡️ Sicurezza & Moderazione (`!`)

| Comando / Sistema | Descrizione |
| :--- | :--- |
| **Anti-Spam** | Rileva automaticamente raffiche di messaggi o spam da utenti/bot, rimuove i messaggi ed applica un timeout. |
| **Anti-Nuke** | Monitora l'Audit Log e revoca i ruoli a chi effettua troppe azioni distruttive (ban/kick di massa, eliminazione canali o ruoli). |
| `!antilink-on` / `off` | Attiva/disattiva il blocco automatico di link di phishing, IP-grabber e accorciatori URL. |
| `!antilink-test <link>` | Analizza un link sospetto senza doverlo inviare direttamente in chat. |
| `!scudo-lock` / `unlock` | Blocco d'emergenza: disabilita/ripristina la scrittura in tutti i canali salvando lo stato precedente. |
| `!timeout` / `!untimeout` | Applica o rimuove il timeout temporaneo a un utente (Alias: `!muta`, `!mute`, `!blocca`, `!smuta`, `!sblocca`). |
| `!warn` / `!warnings` | Sistema di richiami permanenti su database. Al 3° warn scatta un timeout automatico di 10 minuti. |
| `!purge <numero>` | Rimuove fino a 100 messaggi recenti dal canale (rispettando il limite di 14 giorni di Discord). |
| **Log di Sicurezza** | Registra automaticamente ogni azione di sicurezza e moderazione nel canale `log-sicurezza`. |

---

### 🤖 Intelligenza Artificiale (`!`)

> Modello AI integrato tramite **Groq API**

* **`!ask <domanda>`** — Risponde a domande di ogni tipo.
* **`!parla` / `!parla-off`** — Il bot risponde a ogni messaggio con frasi dinamiche generate dall'AI.
* **`!duello @utente`** — Genera un racconto fantasy di uno scontro tra due utenti (esito bilanciato 50/50).
* **`!quiz` & `!quizrank`** — Quiz di cultura generale multilivello generato dall'AI con punteggi e classifica salvati su DB.

---

### 🎉 Intrattenimento & Utility (`!`)

* **`!top` / `!rank`** — Classifica permanente degli utenti più attivi in base ai messaggi inviati (salvata su MongoDB).
* **`!afk [motivo]`** — Imposta lo stato AFK notificando automaticamente chi ti menziona.
* **`!welcome-on` / `off`** — Attiva/disattiva un messaggio ed embed di benvenuto per i nuovi membri.
* **`!tux-on` / `off`** — Risponde ai messaggi inviando immagini casuali di Tux.
* **`!palla <domanda>`** — Palla magica risposte 8-Ball.
* **`!server`** — Mostra le statistiche dettagliate del server (membri, boost, proprietario, canali).

---

### 🎵 ZenoBot Plugins (`.`)

Gli oltre 60 plugin di ZenoBot rispondono al prefisso `.` e, dove previsto, supportano gli **Slash Command (`/`)**.

* **`.ping` / `/ping`** — Visualizza latenza, uptime, memoria RAM utilizzata e comandi di pulizia (Alias: `.stats`, `.status`, `.clean`, `.pulisci`).
* **`.soloadminon` / `off`** — Restringe l'uso dei comandi ZenoBot ai soli amministratori e proprietari del server.
* **`.reload`** *(Solo Owner)* — Ricarica a caldo tutti i plugin di ZenoBot senza riavviare l'istanza.
* **Musica & Tools** — Integrazioni per servizi musicali (`song`, `shazam`) e strumenti di utilità.

---

## 🧱 Architettura & Bridge

L'applicazione segue una struttura modulare basata su plugin:

```text
├── index.js                  # Motore principale ed event handler
├── db.js                     # Connessione MongoDB e schemi dati
├── utils.js                  # Utility condivise (permessi, log)
├── assets/                   # Risorse grafiche e media
├── plugins/                  # Plugin nativi (CommonJS - Prefisso !)
│   ├── zeno-bridge.js        # Ponte di integrazione per i plugin ZenoBot
│   ├── antinuke.js           # Monitoraggio audit log
│   ├── antispam.js           # Rilevamento spam
│   └── ...                   # Altri moduli nativi
└── zeno/                     # Moduli ZenoBot (ESM - Prefisso .)
    ├── package.json          # {"type": "module"}
    └── plugins/              # Plugin originali ZenoBot
