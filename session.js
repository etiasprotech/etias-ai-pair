// =======================================================
//  ETIAS-AI - session.js
//  Generates SESSION_ID after pairing (QR or Pair Code)
//  Sends: 1) Welcome Message  2) SESSION_ID  3) creds.json
// =======================================================

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const P = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');

const AUTH_DIR = path.join(__dirname, 'auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// pairingId -> session
const sessions = new Map();
let totalUsers = 0;

// =======================================================
//  HELPERS
// =======================================================

function getAuthPath(id) {
    const p = path.join(AUTH_DIR, id);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
}

// Generate SESSION_ID from creds.json
function generateSessionId(authPath) {
    const credsPath = path.join(authPath, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;

    const creds = fs.readFileSync(credsPath, 'utf-8');
    const b64 = Buffer.from(creds).toString('base64');

    // This is the SESSION_ID user pastes in Render ENV
    return `ETIAS-AI~${b64}`;
}

// =======================================================
//  SEND SESSION TO USER - 3 STEPS
//  1) Welcome message
//  2) SESSION_ID message
//  3) creds.json file (backup)
// =======================================================

async function sendSessionToUser(sock, sessionId, authPath) {
    try {
        await delay(1200);
        const me = sock.user?.id;
        if (!me) {
            console.log('[SESSION] No user id, cannot send SESSION_ID');
            return false;
        }

        // ── STEP 1: WELCOME MESSAGE ──
        const welcome = `╭━━━━━━━━━━━━━━━━━━━━━━╮
┃  🤖 *ETIAS-AI*
┃  ✅ *CONNECTED!*
╰━━━━━━━━━━━━━━━━━━━━━━╯

Hello! 👋

Your WhatsApp has been successfully linked to *ETIAS-AI*.

I'm sending you:
1️⃣ Your *SESSION_ID* in next message
2️⃣ Your *creds.json* file as backup

━━━━━━━━━━━━━━━━━━━━━
*HOW TO DEPLOY:*

1. Copy SESSION_ID from next message
2. Go to Render / Panel
3. Add ENV Variable:
   *SESSION_ID* = (paste it)
4. Save + Deploy

Your bot will come online automatically.

━━━━━━━━━━━━━━━━━━━━━
⚠️ *KEEP IT PRIVATE*
Don't share it in groups or GitHub.

> *POWERED BY ETIAS-TECH*`;

        await sock.sendMessage(me, { text: welcome });
        console.log(`[SESSION] Step 1 - Welcome sent to ${me}`);
        await delay(1500);

        // ── STEP 2: SESSION_ID MESSAGE ──
        const sessionMsg = `╭━━━━━━━━━━━━━━━━━━━━━━╮
┃  🔑 *YOUR SESSION_ID*
╰━━━━━━━━━━━━━━━━━━━━━━╯

Copy the full SESSION_ID below:

\`\`\`${sessionId}\`\`\`


> *POWERED BY ETIAS-TECH*`;

        await sock.sendMessage(me, { text: sessionMsg });
        console.log(`[SESSION] Step 2 - SESSION_ID sent to ${me}`);
        await delay(1500);

        // ── STEP 3: creds.json FILE (in case) ──
        try {
            const credsPath = path.join(authPath, 'creds.json');
            if (fs.existsSync(credsPath)) {
                const credsBuffer = fs.readFileSync(credsPath);

                await sock.sendMessage(me, {
                    document: credsBuffer,
                    fileName: 'creds.json',
                    mimetype: 'application/json',
                    caption: `╭━━━━━━━━━━━━━━━━━━━━━━╮
┃  📄 *creds.json BACKUP*
╰━━━━━━━━━━━━━━━━━━━━━━╯

This is your backup file.

*IF SESSION_ID FAILS:*
1. Create folder \`session\` in your bot
2. Put this file inside as \`session/creds.json\`
3. Start bot without SESSION_ID

*OR* use SESSION_ID from previous message - it's easier.

⚠️ Keep this file private!

> *ETIAS-AI | ETIAS-TECH*`
                });
                console.log(`[SESSION] Step 3 - creds.json sent to ${me}`);
            } else {
                console.log('[SESSION] creds.json not found, skipping file send');
            }
        } catch (fileErr) {
            console.error('[SESSION] Failed to send creds.json:', fileErr.message);
            // Don't fail - SESSION_ID already sent
        }

        return true;

    } catch (e) {
        console.error('[SESSION] Send failed:', e.message);
        return false;
    }
}

// =======================================================
//  CREATE SESSION
//  number = null => QR mode
//  number = "263..." => Pair Code mode
// =======================================================

async function createSession(number = null) {
    const pairingId = uuidv4();
    const authPath = getAuthPath(pairingId);

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
    });

    const session = {
        pairingId,
        id: pairingId,
        authPath,
        sock,
        number: number ? number.replace(/[^0-9]/g, '') : null,
        status: 'starting',
        qr: null,
        qrImage: null,
        pairingCode: null,
        code: null,
        sessionId: null,
        sessionString: null,
        connected: false,
        sent: false,
        createdAt: Date.now(),
        error: null
    };

    sessions.set(pairingId, session);
    sock.ev.on('creds.update', saveCreds);

    // ===================================================
    //  CONNECTION EVENTS
    // ===================================================
    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;

        // 1. QR RECEIVED
        if (qr) {
            try {
                const qrImage = await QRCode.toDataURL(qr);
                session.qr = qrImage;
                session.qrImage = qrImage;
                session.status = 'qr';
                console.log(`[${pairingId}] QR generated`);
            } catch (e) { console.error(e); }
        }

        // 2. CONNECTED -> GENERATE SESSION_ID
        if (connection === 'open') {
            console.log(`[${pairingId}] WhatsApp connected, generating SESSION_ID...`);
            session.status = 'connected';
            session.connected = true;
            totalUsers++;

            // Wait for creds.json to be fully written
            await delay(3000);

            // Try 5 times - creds.json sometimes takes a second
            let sessionId = null;
            for (let i = 0; i < 5; i++) {
                sessionId = generateSessionId(authPath);
                if (sessionId) break;
                await delay(1000);
            }

            if (sessionId) {
                session.sessionId = sessionId;
                session.sessionString = sessionId;
                session.status = 'connected';
                console.log(`[${pairingId}] SESSION_ID generated: ${sessionId.slice(0, 30)}...`);

                // Send: 1) Welcome  2) SESSION_ID  3) creds.json
                const sent = await sendSessionToUser(sock, sessionId, authPath);
                session.sent = sent;

                // Keep socket alive 20s so messages deliver, then close to save RAM
                setTimeout(() => { try { sock.end(); } catch {} }, 20000);
            } else {
                console.error(`[${pairingId}] Failed to generate SESSION_ID - creds.json missing`);
                session.status = 'error';
                session.error = 'Failed to generate SESSION_ID. Try again.';
            }
        }

        // 3. CLOSED
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                session.status = 'error';
                session.error = 'Logged out. Try again.';
            } else if (!session.connected && session.status !== 'qr') {
                // Baileys will auto-reconnect, don't mark error yet
            }
        }
    });

    // ===================================================
    //  PAIR CODE MODE
    // ===================================================
    if (session.number) {
        try {
            await delay(2000);
            if (!sock.authState.creds.registered) {
                const code = await sock.requestPairingCode(session.number);
                // Format: XXXX-XXXX
                const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                session.pairingCode = formatted;
                session.code = formatted;
                session.status = 'pairing_code';
                console.log(`[${pairingId}] Pair code for ${session.number}: ${formatted}`);
            }
        } catch (e) {
            console.error(`[${pairingId}] Pair code error:`, e.message);
            session.status = 'error';
            session.error = e.message || 'Failed to get pair code';
        }
    } else {
        // QR MODE - wait for QR via connection.update
        session.status = 'waiting_qr';
    }

    // Auto-cleanup after 5 min if not connected
    setTimeout(() => {
        if (!session.connected) {
            try { sock.end(); } catch {}
            setTimeout(() => {
                try { fs.rmSync(authPath, { recursive: true, force: true }); } catch {}
                sessions.delete(pairingId);
            }, 1000 * 60 * 5);
        }
    }, 1000 * 60 * 5);

    return session;
}

// =======================================================
//  GETTERS
// =======================================================

function getSession(pairingId) {
    return sessions.get(pairingId) || null;
}

function getStats() {
    let online = 0;
    for (const s of sessions.values()) {
        if (s.connected) online++;
    }
    return {
        total: totalUsers,
        totalUsers,
        online,
        onlineUsers: online,
        active: sessions.size
    };
}

// Cleanup old sessions every 2 min
setInterval(() => {
    for (const [id, s] of sessions) {
        if (Date.now() - s.createdAt > 1000 * 60 * 10 && !s.connected) {
            try { s.sock.end(); } catch {}
            try { fs.rmSync(s.authPath, { recursive: true, force: true }); } catch {}
            sessions.delete(id);
        }
    }
}, 1000 * 60 * 2);

module.exports = {
    createSession,
    getSession,
    getStats,
    generateSessionId,
    sessions,
    AUTH_DIR
};
