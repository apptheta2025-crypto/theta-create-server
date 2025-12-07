import fetch from 'node-fetch';

// Server-side voice cloning endpoint
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { audioUrl, voiceName, languageCode = 'en-US' } = req.body;

        if (!audioUrl || !voiceName) {
            return res.status(400).json({ error: 'Missing required fields: audioUrl, voiceName' });
        }

        const chirp3ApiKey = process.env.GOOGLE_CHIRP3_API_KEY;
        const projectId = process.env.GOOGLE_PROJECT_ID || 'your-project-id';
        const region = 'us-central1';

        if (!chirp3ApiKey) {
            console.error('API Key not found. Check server/.env file');
            return res.status(500).json({ error: 'Chirp 3 API key not configured' });
        }

        // 1. Download audio from Supabase public URL
        console.log('Downloading audio from:', audioUrl);
        const audioResponse = await fetch(audioUrl);

        if (!audioResponse.ok) {
            throw new Error('Failed to download audio from Supabase');
        }

        const audioBuffer = await audioResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        // 2. Call Vertex AI Chirp 3 API for voice cloning
        const vertexEndpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/generation-1.5-voice:streamGenerateContent?key=${chirp3ApiKey}`;

        console.log('Calling Vertex AI Chirp 3 API...');

        const chirpResponse = await fetch(vertexEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{
                        voiceConfig: {
                            voiceRefAudioContent: base64Audio,
                            languageCode: languageCode,
                            gender: 'NEUTRAL',
                            style: 'NARRATION'
                        },
                        text: 'This is a test of the cloned voice.'
                    }]
                }]
            })
        });

        if (!chirpResponse.ok) {
            const errorText = await chirpResponse.text();
            console.error('Chirp 3 API error:', errorText);
            throw new Error(`Chirp 3 API failed: ${errorText}`);
        }

        const chirpData = await chirpResponse.json();
        console.log('Voice clone created successfully');

        // 3. Return the voice configuration
        res.status(200).json({
            success: true,
            voiceId: `chirp3-${Date.now()}`,
            voiceConfig: {
                voiceRefAudioContent: base64Audio,
                languageCode: languageCode,
                gender: 'NEUTRAL',
                style: 'NARRATION'
            },
            metadata: chirpData
        });

    } catch (error) {
        console.error('Voice cloning error:', error);
        res.status(500).json({
            error: 'Voice cloning failed',
            details: error.message
        });
    }
}
