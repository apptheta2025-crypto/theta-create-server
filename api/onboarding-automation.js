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

    // AUTO-WHITELIST ADMIN (Recovery)
    try {
        await supabase.from('allowed_users').upsert({ email: 'lubhitmamodia23@gmail.com' });
    } catch (e) { console.error("Admin auto-whitelist failed:", e.message); }

    // [MIGRATION MODE] - Sync existing General list to Supabase
    if (req.query?.migrate === 'true') {
        console.log("[DEBUG] Legacy Migration Triggered...");
        try {
            const { data: contacts, error: fetchErr } = await resend.contacts.list({ audienceId: GENERAL_AUDIENCE_ID });
            if (fetchErr) throw fetchErr;

            if (contacts && contacts.data) {
                const whitelistEntries = contacts.data.map(c => ({ email: c.email.toLowerCase().trim() }));
                console.log(`[DEBUG] Batch-migrating ${whitelistEntries.length} users to Supabase...`);
                
                // BATCH UPSERT: Much faster for Hobby Tier 10s timeout
                const { error: dbError } = await supabase.from('allowed_users').upsert(whitelistEntries, { onConflict: 'email' });
                if (dbError) throw dbError;

                return res.status(200).json({ 
                    success: true, 
                    message: `Successfully migrated ${whitelistEntries.length} users to the Supabase Whitelist.` 
                });
            }
        } catch (err) {
            console.error("[DEBUG] Migration Failed:", err.message);
            return res.status(500).json({ error: `Migration Failed: ${err.message}` });
        }
    }

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
        html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap');
              body { background-color: #000000; color: #ffffff; font-family: 'DM Sans', sans-serif; padding: 48px 20px; -webkit-font-smoothing: antialiased; }
              .container { max-width: 600px; margin: 0 auto; background-color: #09090b; border: 1px solid #27272a; border-radius: 24px; padding: 48px; }
              .accent { color: #BC46EA; }
              .btn { display: inline-block; background-color: #ffffff; color: #000000; padding: 16px 36px; border-radius: 100px; text-decoration: none; font-weight: bold; margin: 32px 0; }
              p { color: #a1a1aa; line-height: 1.6; font-size: 16px; }
              .footer { border-top: 1px solid #27272a; margin-top: 48px; padding-top: 24px; color: #52525b; font-size: 12px; }
          </style>
        </head>
        <body>
            <div class="container">
                <h1 style="color: #ffffff; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 24px;">Your spot is ready. <span class="accent">Step in.</span></h1>
                <p>Welcome to the future of storytelling. Your account has been verified, and the Theta Create Alpha is now open for you.</p>
                <p>We've prepared your creative workspace. You can now draft manuscripts, clone your voice, and publish professional audiobooks in one unified flow.</p>
                
                <a href="https://create.theta.co.in" class="btn">Enter the Studio</a>
                
                <p style="color: #ffffff; font-weight: 500;">Write the story. Voice the world.</p>
                
                <div class="footer">
                    © 2026 Theta. All rights reserved. <br/>
                    You received this because your alpha access was approved.
                </div>
            </div>
        </body>
        </html>
        `
    });
}
