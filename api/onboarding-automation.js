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
const UNVERIFIED_AUDIENCE_ID = '5726ca5a-914c-4bd4-8be4-a3ea611d7e3d';

export default async function handler(req, res) {
    console.log("[ONBOARDING] Endpoint hit:", req.method, JSON.stringify(req.query));

    // ── BOOT CHECK: Validate essential env vars ──
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        console.error("[ONBOARDING] FATAL: SUPABASE_SERVICE_ROLE_KEY is not set!");
        return res.status(500).json({ error: 'Server misconfiguration: Missing SUPABASE_SERVICE_ROLE_KEY' });
    }
    if (!RESEND_API_KEY) {
        console.error("[ONBOARDING] FATAL: RESEND_API_KEY is not set!");
        return res.status(500).json({ error: 'Server misconfiguration: Missing RESEND_API_KEY' });
    }

    // Initialize clients INSIDE the handler to prevent boot-crashes
    const resend = new Resend(RESEND_API_KEY);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // AUTO-WHITELIST ADMIN (Recovery safety net)
    try {
        await supabase.from('allowed_users').upsert({ email: 'lubhitmamodia23@gmail.com' });
    } catch (e) { console.error("[ONBOARDING] Admin auto-whitelist failed:", e.message); }

    // ══════════════════════════════════════════
    // MODE 1: MIGRATION — Sync existing Resend General list → Supabase allowed_users
    // Usage: GET /api/onboarding-automation?migrate=true
    // ══════════════════════════════════════════
    if (req.query?.migrate === 'true') {
        console.log("[ONBOARDING] Migration mode triggered...");
        try {
            const { data: contacts, error: fetchErr } = await resend.contacts.list({ audienceId: GENERAL_AUDIENCE_ID });
            if (fetchErr) throw new Error(`Resend list error: ${JSON.stringify(fetchErr)}`);

            if (contacts && contacts.data && contacts.data.length > 0) {
                const whitelistEntries = contacts.data.map(c => ({ email: c.email.toLowerCase().trim() }));
                console.log(`[ONBOARDING] Migrating ${whitelistEntries.length} users to Supabase...`);
                
                const { error: dbError } = await supabase
                    .from('allowed_users')
                    .upsert(whitelistEntries, { onConflict: 'email' });
                if (dbError) throw new Error(`Supabase upsert error: ${JSON.stringify(dbError)}`);

                return res.status(200).json({ 
                    success: true, 
                    message: `Migrated ${whitelistEntries.length} users to Supabase whitelist.`,
                    emails: whitelistEntries.map(e => e.email)
                });
            } else {
                return res.status(200).json({ success: true, message: 'No contacts found in General audience to migrate.' });
            }
        } catch (err) {
            console.error("[ONBOARDING] Migration failed:", err.message);
            return res.status(500).json({ error: `Migration failed: ${err.message}` });
        }
    }

    // ══════════════════════════════════════════
    // MODE 2: INSTANT WEBHOOK — Google Sheets trigger
    // Usage: POST with { webhookSecret: 'theta_instant_grant', email: '...' }
    // ══════════════════════════════════════════
    if (req.method === 'POST' && req.body?.webhookSecret === 'theta_instant_grant') {
        const { email } = req.body;
        console.log(`[ONBOARDING] Webhook received for: ${email}`);
        if (email && email.includes('@')) {
            try {
                await grantAccess(email.toLowerCase().trim(), supabase, resend);
                return res.status(200).json({ success: true, message: `Access granted to ${email}` });
            } catch (err) {
                console.error(`[ONBOARDING] Webhook grant error:`, err.message);
                return res.status(500).json({ error: err.message });
            }
        }
        return res.status(400).json({ error: 'Invalid email in webhook payload' });
    }

    // ══════════════════════════════════════════
    // MODE 3: CRON — Automated maintenance cycle
    // Checks Google Sheets for new form responses and grants access
    // ══════════════════════════════════════════

    // Auth check: Only enforce if CRON_SECRET is configured
    if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        console.warn("[ONBOARDING] Cron auth failed. Expected Bearer token.");
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log("[ONBOARDING] Starting maintenance cycle...");

        // Step 1: Fetch all unverified users from Supabase
        const { data: unverifiedUsers, error: dbError } = await supabase
            .from('unverified_users')
            .select('*')
            .eq('verified', false);

        if (dbError) {
            throw new Error(`Supabase query failed: ${JSON.stringify(dbError)}`);
        }

        if (!unverifiedUsers || unverifiedUsers.length === 0) {
            console.log("[ONBOARDING] No unverified users to process.");
            return res.status(200).json({ success: true, message: 'No unverified users pending.' });
        }

        console.log(`[ONBOARDING] Found ${unverifiedUsers.length} unverified users to check.`);

        // Step 2: Authenticate with Google Sheets
        let verifiedEmails = new Set();
        try {
            if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
                throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON env var is not set');
            }

            const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
            const auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            });
            const sheets = google.sheets({ version: 'v4', auth });
            
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_SHEET_ID,
                range: 'Form Responses 1!A:E',
            });

            const rows = response.data.values || [];
            console.log(`[ONBOARDING] Google Sheets returned ${rows.length} rows.`);

            // Extract all emails found in ANY column of each row
            for (const row of rows) {
                for (const cell of row) {
                    if (cell && typeof cell === 'string' && cell.includes('@')) {
                        verifiedEmails.add(cell.toLowerCase().trim());
                    }
                }
            }
            console.log(`[ONBOARDING] Found ${verifiedEmails.size} unique emails in form responses.`);
        } catch (sheetsErr) {
            console.error("[ONBOARDING] Google Sheets error:", sheetsErr.message);
            return res.status(500).json({ error: `Google Sheets error: ${sheetsErr.message}` });
        }

        // Step 3: Process each unverified user
        let granted = 0;
        let expired = 0;
        const errors = [];

        for (const user of unverifiedUsers) {
            const email = user.email.toLowerCase().trim();
            const signupDate = new Date(user.created_at);
            const hoursSinceSignup = (Date.now() - signupDate.getTime()) / (1000 * 60 * 60);

            if (verifiedEmails.has(email)) {
                // User filled the Google Form — grant access
                try {
                    console.log(`[ONBOARDING] Granting access to: ${email}`);
                    await grantAccess(email, supabase, resend);
                    granted++;
                } catch (err) {
                    console.error(`[ONBOARDING] Failed to grant ${email}:`, err.message);
                    errors.push({ email, error: err.message });
                }
            } else if (hoursSinceSignup > 48) {
                // 48-hour expiration
                try {
                    console.log(`[ONBOARDING] Expiring: ${email} (${Math.round(hoursSinceSignup)}h old)`);
                    await handleExpiration(email, supabase, resend);
                    expired++;
                } catch (err) {
                    console.error(`[ONBOARDING] Failed to expire ${email}:`, err.message);
                    errors.push({ email, error: err.message });
                }
            }
        }

        return res.status(200).json({ 
            success: true,
            processed: unverifiedUsers.length,
            granted,
            expired,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (err) {
        console.error("[ONBOARDING] Cron critical error:", err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ══════════════════════════════════════════
// HELPER: Grant access to a verified user
// ══════════════════════════════════════════
async function grantAccess(email, supabase, resend) {
    console.log(`[ONBOARDING] Granting access to ${email}...`);
    
    // 1. Add to Supabase whitelist
    const { error: whitelistErr } = await supabase.from('allowed_users').upsert({ email });
    if (whitelistErr) {
        throw new Error(`Whitelist upsert failed for ${email}: ${JSON.stringify(whitelistErr)}`);
    }

    // 2. Mark as verified in unverified_users
    await supabase.from('unverified_users').update({ verified: true }).eq('email', email);

    // 3. Move contact in Resend: Add to General, Remove from Unverified
    try {
        // Add to General audience
        await resend.contacts.create({ email, audienceId: GENERAL_AUDIENCE_ID });
    } catch (err) {
        console.warn(`[ONBOARDING] Resend add-to-General warning for ${email}:`, err.message);
    }

    try {
        // Remove from Unverified audience — must find contact ID first
        await removeContactByEmail(resend, email, UNVERIFIED_AUDIENCE_ID);
    } catch (err) {
        console.warn(`[ONBOARDING] Resend remove-from-Unverified warning for ${email}:`, err.message);
    }

    // 4. Send "Access Granted" email
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

    console.log(`[ONBOARDING] ✅ Access granted successfully for ${email}`);
}

// ══════════════════════════════════════════
// HELPER: Expire an unverified user (48h timeout)
// ══════════════════════════════════════════
async function handleExpiration(email, supabase, resend) {
    // Remove from Supabase unverified table
    await supabase.from('unverified_users').delete().eq('email', email);

    // Remove from Resend Unverified audience
    try {
        await removeContactByEmail(resend, email, UNVERIFIED_AUDIENCE_ID);
    } catch (err) {
        console.warn(`[ONBOARDING] Resend cleanup warning for ${email}:`, err.message);
    }

    console.log(`[ONBOARDING] ✅ Expired user removed: ${email}`);
}

// ══════════════════════════════════════════
// HELPER: Remove a Resend contact by email (lookup ID first)
// The Resend SDK requires a contact UUID to remove, not an email address.
// ══════════════════════════════════════════
async function removeContactByEmail(resend, email, audienceId) {
    // 1. List all contacts in the audience
    const { data: contactList, error: listErr } = await resend.contacts.list({ audienceId });
    
    if (listErr) {
        throw new Error(`Failed to list contacts: ${JSON.stringify(listErr)}`);
    }

    if (!contactList?.data || contactList.data.length === 0) {
        console.log(`[ONBOARDING] No contacts found in audience ${audienceId}`);
        return;
    }

    // 2. Find the contact by email
    const contact = contactList.data.find(
        c => c.email.toLowerCase().trim() === email.toLowerCase().trim()
    );

    if (!contact) {
        console.log(`[ONBOARDING] Contact ${email} not found in audience ${audienceId}, skipping removal.`);
        return;
    }

    // 3. Remove by contact ID
    const { error: removeErr } = await resend.contacts.remove({
        id: contact.id,
        audienceId: audienceId,
    });

    if (removeErr) {
        throw new Error(`Failed to remove contact ${email} (id: ${contact.id}): ${JSON.stringify(removeErr)}`);
    }

    console.log(`[ONBOARDING] Removed ${email} (id: ${contact.id}) from audience ${audienceId}`);
}
