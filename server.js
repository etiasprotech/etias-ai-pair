// =======================================================
//  ETIAS-AI - server.js
//  Pair Site Backend for Render
//  Sends: 1) Welcome  2) SESSION_ID  3) creds.json
// =======================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const { createSession, getSession, getStats } = require('./session');

const app = express();
const PORT = process.env.PORT || 3000;

// =======================================================
//  MIDDLEWARE
// =======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Disable caching for API
app.use((req, res, next) => {
    if (req.path.startsWith('/code') || req.path.startsWith('/status') || req.path.startsWith('/qr-image') || req.path.startsWith('/total-users') || req.path.startsWith('/deploy-stats')) {
        res.set('Cache-Control', 'no-store');
    }
    next();
});

// Static files - public folder
app.use(express.static(path.join(__dirname, 'public')));

// =======================================================
//  HTML PAGES
// =======================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/pair.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

app.get('/qr.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

app.get('/owner', (req, res) => {
    res.redirect('https://wa.me/263778810589?text=Hi%20Owner,%20I%20need%20help%20with%20ETIAS-AI');
});

// =======================================================
//  BOT IMAGE
//  Used by index.html, pair.html, qr.html -> src="/bot-image"
// =======================================================

app.get('/bot-image', (req, res) => {
    const candidates = [
        path.join(__dirname, 'public', 'bot.jpg'),
        path.join(__dirname, 'public', 'bot.jpeg'),
        path.join(__dirname, 'public', 'bot.png'),
        path.join(__dirname, 'public', 'bot.webp'),
        path.join(__dirname, 'media', 'bot.jpg'),
        path.join(__dirname, 'media', 'bot.jpeg'),
        path.join(__dirname, 'media', 'bot.png'),
        path.join(__dirname, 'media', 'bot_image.png'),
        path.join(__dirname, 'media', 'bot.webp'),
    ];

    for (const file of candidates) {
        if (fs.existsSync(file)) {
            return res.sendFile(file);
        }
    }

    // No image found - return 404, frontend will hide it
    res.status(404).send('No bot image');
});

// =======================================================
//  API: /code?number=263...
//  Used by BOTH pair.html and qr.html
//  - If number provided -> Pair Code mode
//  - If no number -> QR mode (qr.html will poll for QR)
// =======================================================

app.get('/code', async (req, res) => {
    try {
        let number = (req.query.number || '').replace(/[^0-9]/g, '').replace(/^00/, '');

        if (number && number.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Enter a valid WhatsApp number with country code. Example: 263771234567'
            });
        }

        // Create session - number = null means QR mode
        const session = await createSession(number || null);

        console.log(`[SERVER] New session: ${session.pairingId} | Number: ${number || 'QR'} | Status: ${session.status}`);

        return res.json({
            success: true,
            pairingId: session.pairingId,
            id: session.pairingId,
            existingPairingId: session.pairingId,
            pairingCode: session.pairingCode,
            code: session.code,
            qr: session.qrImage,
            qrImage: session.qrImage,
            status: session.status
        });

    } catch (e) {
        console.error('[SERVER] /code error:', e);
        return res.status(500).json({
            success: false,
            error: e.message || 'Unable to start pairing. Try again.'
        });
    }
});

// Alias for QR - same as /code but explicit
app.get('/code-qr', async (req, res) => {
    try {
        let number = (req.query.number || '').replace(/[^0-9]/g, '').replace(/^00/, '');
        const session = await createSession(number || null);
        return res.json({
            success: true,
            pairingId: session.pairingId,
            id: session.pairingId,
            status: session.status
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// =======================================================
//  API: /status/:pairingId
//  Polled by pair.html and qr.html every 1-1.5s
// =======================================================

app.get('/status/:id', (req, res) => {
    const s = getSession(req.params.id);

    if (!s) {
        return res.status(404).json({
            error: 'Session expired. Refresh page and try again.',
            status: 'expired'
        });
    }

    return res.json({
        pairingId: s.pairingId,
        id: s.pairingId,
        status: s.status,
        connected: s.connected,
        pairingCode: s.pairingCode,
        code: s.code,
        qr: s.qrImage,
        qrImage: s.qrImage,
        sessionId: s.sessionId,
        sessionString: s.sessionString,
        error: s.error
    });
});

// =======================================================
//  API: /qr-image?id=...
//  Used by qr.html -> loadCurrentQR()
// =======================================================

app.get('/qr-image', (req, res) => {
    const s = getSession(req.query.id);

    if (!s) {
        return res.status(404).json({ error: 'Session expired' });
    }

    if (!s.qrImage) {
        return res.json({ error: 'QR not ready yet', status: s.status });
    }

    return res.json({
        qr: s.qrImage,
        qrImage: s.qrImage,
        status: s.status,
        pairingId: s.pairingId
    });
});

// =======================================================
//  API: STATS
//  Used by index.html, pair.html, qr.html
// =======================================================

app.get('/total-users', (req, res) => {
    const st = getStats();
    return res.json({
        total: st.total,
        totalUsers: st.total,
        online: st.online,
        onlineUsers: st.online,
        count: st.total,
        users: st.total
    });
});

app.get('/deploy-stats', (req, res) => {
    const st = getStats();
    return res.json({
        online: st.online,
        onlineUsers: st.online,
        active: st.active,
        activeUsers: st.active,
        connected: st.online,
        total: st.total,
        totalUsers: st.total,
        stats: {
            online: st.online,
            onlineUsers: st.online,
            total: st.total,
            totalUsers: st.total
        }
    });
});

// =======================================================
//  HEALTH CHECK - Render uses this
// =======================================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'ETIAS-AI Pair Site' });
});

app.get('/ping', (req, res) => {
    res.send('pong');
});

// =======================================================
//  404 - Fallback to index
// =======================================================

app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/code') || req.path.startsWith('/status') || req.path.startsWith('/qr-image')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =======================================================
//  START SERVER
// =======================================================

app.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`  ETIAS-AI Pair Site`);
    console.log(`  Running on http://localhost:${PORT}`);
    console.log(`  Pages: /  /pair  /qr`);
    console.log(`  API: /code  /status/:id  /qr-image`);
    console.log(`  Flow: Welcome -> SESSION_ID -> creds.json`);
    console.log(`========================================`);
});
