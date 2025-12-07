import fetch from 'node-fetch';

// Server-side voice cloning endpoint
export default async function handler(req, res) {
    // Set CORS headers for ALL responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { audioUrl, voiceName, languageCode = 'en-US' } = req.body;

        if (!audioUrl || !voiceName) {
            return res.status(400).json({ error: 'Missing required fields: audioUrl, voiceName' });
        }

        // Download audio from Supabase public URL
        console.log('Downloading audio from:', audioUrl);
        const audioResponse = await fetch(audioUrl);

        if (!audioResponse.ok) {
            throw new Error('Failed to download audio from Supabase');
        }

        const audioBuffer = await audioResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        console.log('Voice configuration created');

        // Return voice configuration
        return res.status(200).json({
            success: true,
            voiceId: `chirp3-${Date.now()}`,
            voiceConfig: {
                voiceRefAudioContent: base64Audio,
                languageCode: languageCode,
                gender: 'NEUTRAL',
                style: 'NARRATION',
                voiceName: voiceName
            },
            metadata: {
                audioSize: audioBuffer.byteLength,
                language: languageCode
            }
        });

    } catch (error) {
        console.error('Voice cloning error:', error);
        return res.status(500).json({ error: 'Voice cloning failed', details: error.message });
    }
}
