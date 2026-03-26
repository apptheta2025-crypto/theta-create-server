import { google } from 'googleapis';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

// ==========================================
// CONFIGURATION
// ==========================================
const GOOGLE_SHEET_ID = '1Ufb9zBRhjGjRU5xKdvWkMI_fono1sxHj5cTbEWlQubQ';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwzvypztpxcfmukvkdfq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Resend Audience Segments
const GENERAL_AUDIENCE_ID = '76bd49ad-9462-4971-9ffa-6eefb60e90b0';
const UNVERIFIED_USERS_ID = '5726ca5a-914c-4bd4-8be4-a3ea611d7e3d';

export default async function handler(req, res) {
    console.log("[DEBUG] SERVER HIT: /api/onboarding-automation triggered");

    // Initialize clients INSIDE the handler to prevent boot-crashes
    const resend = new Resend(RESEND_API_KEY);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Handle Instant Webhook from Google Sheets
    if (req.method === 'POST' && req.body?.webhookSecret === 'theta_instant_grant') {
        const { email } = req.body;
        console.log(`[DEBUG] Step 1: Webhook received for: ${email}`);
        if (email && email.includes('@')) {
            try {
                await grantAccess(email.toLowerCase().trim(), supabase, resend);
                return res.status(200).json({ success: true });
            } catch (err) {
                console.error(`[DEBUG] Webhook Error:`, err.message);
                return res.status(500).json({ error: err.message });
            }
        }
    }

    // 2. Cron Logic (Maintenance)
    if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log("[DEBUG] Starting maintenance cycle...");
        const { data: unverifiedUsers, error: dbError } = await supabase
            .from('unverified_users')
            .select('*')
            .eq('verified', false);

        if (dbError) throw dbError;
        
        // Google Auth
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Form Responses 1!A:E',
        });

        const rows = response.data.values || [];
        const verifiedEmails = new Set(rows.map(row => row.find(c => c?.includes('@'))?.toLowerCase().trim()));

        for (const user of unverifiedUsers) {
            const email = user.email.toLowerCase().trim();
            if (verifiedEmails.has(email)) {
                await grantAccess(email, supabase, resend);
            }
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error("[DEBUG] Cron Error:", err.message);
        return res.status(500).json({ error: err.message });
    }
}

async function grantAccess(email, supabase, resend) {
    console.log(`[DEBUG] Granting access to ${email}...`);
    
    // Whitelist in Supabase
    await supabase.from('allowed_users').upsert({ email });
    await supabase.from('unverified_users').update({ verified: true }).eq('email', email);

    // Resend Move
    try {
        await resend.contacts.create({ email, audienceId: GENERAL_AUDIENCE_ID });
        await resend.contacts.remove({ email, audienceId: UNVERIFIED_USERS_ID });
    } catch (err) {
        console.warn(`[DEBUG] Resend Sync Warning:`, err.message);
    }

    // Final Email
    await resend.emails.send({
        from: 'Theta <no-reply@theta.co.in>',
        to: email,
        subject: 'Your spot is ready. Step in.',
        html: `<h1>Welcome to Theta Create</h1><p>Your access is granted.</p>`
    });
}
