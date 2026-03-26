const { google } = require('googleapis');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// CONFIGURATION
// ==========================================
const GOOGLE_SHEET_ID = '1Ufb9zBRhjGjRU5xKdvWkMI_fono1sxHj5cTbEWlQubQ'; 
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwzvypztpxcfmukvkdfq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_XEdtRhnR_PMP4CtXZwJptgZ2qMb2QxHCR';

// Resend Audience Segments
const GENERAL_AUDIENCE_ID = '76bd49ad-9462-4971-9ffa-6eefb60e90b0';
const UNVERIFIED_USERS_ID = '5726ca5a-914c-4bd4-8be4-a3ea611d7e3d';

const resend = new Resend(RESEND_API_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    // Handle Instant Webhook from Google Sheets
    if (req.method === 'POST' && req.body.webhookSecret === 'theta_instant_grant') {
        const { email } = req.body;
        if (email) {
            console.log(`Instant grant request for ${email}...`);
            await grantAccess(email.toLowerCase().trim());
            return res.status(200).json({ success: true, message: `Access granted instantly to ${email}` });
        }
    }

    // Cron Secret Check (for scheduled maintenance)
    if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log("Starting maintenance cycle (scanning sheet/expiring spots)...");

    try {
        // 1. Fetch unverified users who haven't verified yet
        const { data: unverifiedUsers, error: dbError } = await supabase
            .from('unverified_users')
            .select('*')
            .eq('verified', false);

        if (dbError) throw dbError;
        if (!unverifiedUsers || unverifiedUsers.length === 0) {
            return res.status(200).json({ message: 'No unverified users to process.' });
        }

        // 2. Authenticate with Google (using server-side Service Account)
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Fetch form responses from the linked Google Sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Form Responses 1!A:E', // Common range for form data
        });

        const rows = response.data.values || [];
        const verifiedEmails = new Set(
            rows.map(row => row.find(cell => cell.includes('@'))?.toLowerCase().trim())
        );

        // 3. Process each user
        const results = { granted: [], expired: [] };

        for (const user of unverifiedUsers) {
            const email = user.email.toLowerCase().trim();
            const signupDate = new Date(user.created_at);
            const now = new Date();
            const hoursSinceSignup = (now - signupDate) / (1000 * 60 * 60);

            if (verifiedEmails.has(email)) {
                await grantAccess(email);
                results.granted.push(email);
            } else if (hoursSinceSignup > 48) {
                await handleExpiration(email);
                results.expired.push(email);
            }
        }

        return res.status(200).json({ success: true, results });

    } catch (err) {
        console.error("Automation Error:", err);
        return res.status(500).json({ error: err.message });
    }
}

async function grantAccess(email) {
    // A. Whitelist in Supabase
    await supabase.from('allowed_users').upsert({ email });
    await supabase.from('unverified_users').update({ verified: true }).eq('email', email);

    // B. Move in Resend (Remove from Unverified, Add to General)
    // Actually, Resend contacts are single entities; we use Audience IDs.
    // We update the contact and potentially tags.
    
    // C. Send Access Granted Email
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

async function handleExpiration(email) {
    await supabase.from('unverified_users').delete().eq('email', email);
    // Cleanup Resend if desired
}
