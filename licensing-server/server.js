const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 3000;

// Database Setup
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database opening error:', err.message);
    console.log(`Connected to SQLite database at ${dbPath}`);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_key TEXT UNIQUE,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS activations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_id INTEGER,
        hwid TEXT,
        activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(license_id) REFERENCES licenses(id)
    )`);
});

// Helper: Key Generation
function generateKey() {
    return 'CF-' + crypto.randomBytes(4).toString('hex').toUpperCase() + 
           '-' + crypto.randomBytes(4).toString('hex').toUpperCase() +
           '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// 1. Stripe Webhook (Uses raw body)
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = await stripe.checkout.sessions.retrieve(
            event.data.object.id,
            { expand: ['line_items'] }
        );

        // 1. Verify payment status
        if (session.payment_status !== 'paid') {
            console.log(`[STRIPE] Session ${session.id} not paid yet.`);
            return res.json({ received: true });
        }

        // 2. Verify Product ID
        const targetProductId = 'prod_UMMyM42VfpzZRZ';
        const hasProduct = session.line_items.data.some(item => item.price.product === targetProductId);

        if (!hasProduct) {
            console.log(`[STRIPE] No matching product found in session ${session.id}`);
            return res.json({ received: true });
        }

        const email = session.customer_details.email;
        const key = generateKey();

        db.run('INSERT INTO licenses (license_key, email) VALUES (?, ?)', [key, email], (err) => {
            if (err) {
                console.error('DB Purchase Error:', err.message);
                return res.status(500).json({ error: 'Internal Database Error' });
            }
            console.log(`[STRIPE] Successfully generated license ${key} for ${email}`);
            
            // Trigger Automated Email
            const { sendLicenseEmail } = require('./mailer');
            sendLicenseEmail(email, key).catch(err => console.error('Email trigger failed:', err));
        });
    }

    res.json({received: true});
});

// 2. Standard API Middlewares
app.use(express.json());

// 3. Activation Endpoint
app.post('/activate', (req, res) => {
    const { key, email, hwid } = req.body;

    if (!key || !hwid || !email) {
        return res.status(400).json({ error: 'Missing required fields (key, email, or hardware ID)' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedKey = key.trim().toUpperCase();

    console.log(`[ACTIVATE] Attempt: ${normalizedKey} for ${normalizedEmail} (HWID: ${hwid})`);

    db.get('SELECT * FROM licenses WHERE license_key = ?', [normalizedKey], (err, license) => {
        if (err) return res.status(500).json({ error: 'Database error during lookup' });
        
        if (!license) {
            console.log(`[ACTIVATE] Key not found: ${normalizedKey}`);
            return res.status(404).json({ error: 'Invalid license key' });
        }

        if (license.email.trim().toLowerCase() !== normalizedEmail) {
            console.log(`[ACTIVATE] Email mismatch: ${license.email} vs ${normalizedEmail}`);
            return res.status(403).json({ error: 'This license key is not registered to this email' });
        }

        db.all('SELECT * FROM activations WHERE license_id = ?', [license.id], (err, activations) => {
            if (err) return res.status(500).json({ error: 'Database error during activations lookup' });

            const existing = activations.find(a => a.hwid === hwid);
            if (existing) {
                console.log(`[ACTIVATE] Re-signing for existing machine: ${hwid}`);
                return signToken(normalizedKey, hwid, res);
            }

            if (activations.length >= 2) {
                console.log(`[ACTIVATE] Limit reached for key ${normalizedKey}`);
                return res.status(403).json({ error: 'Activation limit reached (2 of 2 machines already active)' });
            }

            db.run('INSERT INTO activations (license_id, hwid) VALUES (?, ?)', [license.id, hwid], (err) => {
                if (err) return res.status(500).json({ error: 'Failed to record activation' });
                console.log(`[ACTIVATE] Success: ${normalizedKey} activated on new machine ${hwid}`);
                signToken(normalizedKey, hwid, res);
            });
        });
    });
});

// 4. Token Signing Logic (Ed25519)
function signToken(key, hwid, res) {
    const expires_at = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
    const signed_data = `${key}:${hwid}:${expires_at}`;
    
    try {
        const privateKey = crypto.createPrivateKey({
            key: Buffer.from(process.env.PRIVATE_KEY_B64, 'base64'),
            format: 'der',
            type: 'pkcs8'
        });

        const signature = crypto.sign(null, Buffer.from(signed_data), privateKey);
        
        res.json({
            key: key,
            hwid: hwid,
            expires_at: expires_at,
            signature: signature.toString('base64')
        });
    } catch (err) {
        console.error('Signing error:', err.message);
        res.status(500).json({ error: 'Security module error' });
    }
}

// 5. Utilities & Delivery
app.post('/resend-key', async (req, res) => {
    const { email } = req.body;
    db.all('SELECT license_key FROM licenses WHERE email = ?', [email], async (err, rows) => {
        if (err || !rows || rows.length === 0) {
            return res.status(404).json({ error: 'No license keys found for this email address.' });
        }
        
        const { sendLicenseEmail } = require('./mailer');
        try {
            // If multiple keys exist, we could join them or send multiple emails
            // For now, let's send the latest one or a summary
            const latestKey = rows[rows.length - 1].license_key;
            await sendLicenseEmail(email, latestKey);
            res.json({ message: 'License details have been sent to your email.' });
        } catch (mailErr) {
            console.error('Resend error:', mailErr);
            res.status(500).json({ error: 'Failed to send email. Please contact support.' });
        }
    });
});

app.get('/download', (req, res) => {
    const ua = req.headers['user-agent'];
    if (/windows/i.test(ua)) {
        res.redirect('https://storage.alan-design.com/cineflow/v1/CineFlow_Setup.exe');
    } else if (/macintosh|mac os x/i.test(ua)) {
        res.redirect('https://storage.alan-design.com/cineflow/v1/CineFlow.dmg');
    } else {
        res.status(400).send('Please download from a Desktop computer.');
    }
});

// 6. Admin API (Secured)
const adminAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader === `Bearer ${process.env.ADMIN_SECRET}`) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

app.get('/admin/licenses', adminAuth, (req, res) => {
    db.all(`
        SELECT l.*, 
        (SELECT count(*) FROM activations WHERE license_id = l.id) as activation_count
        FROM licenses l
        ORDER BY l.created_at DESC
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/admin/licenses/:id/activations', adminAuth, (req, res) => {
    db.all('SELECT * FROM activations WHERE license_id = ?', [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/admin/licenses/create', adminAuth, (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    
    const key = generateKey();
    db.run('INSERT INTO licenses (license_key, email) VALUES (?, ?)', [key, email], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const { sendLicenseEmail } = require('./mailer');
        sendLicenseEmail(email, key).catch(console.error);
        
        res.json({ success: true, key });
    });
});

app.post('/admin/licenses/:id/reset', adminAuth, (req, res) => {
    db.run('DELETE FROM activations WHERE license_id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/admin/licenses/:id', adminAuth, (req, res) => {
    db.run('DELETE FROM activations WHERE license_id = ?', [req.params.id], (err) => {
        db.run('DELETE FROM licenses WHERE id = ?', [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

app.listen(port, () => console.log(`CineFlow Licensing Engine active on port ${port}`));
