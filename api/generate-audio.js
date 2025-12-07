import fetch from 'node-fetch';

// Server-side audio generation endpoint using Google Cloud TTS
export default async function handler(req, res) {
    // Set CORS headers for ALL responses (including preflight)
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
        const { text, voiceId, voiceConfig, settings = {} } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Missing required field: text' });
        }

        const googleApiKey = process.env.GOOGLE_CHIRP3_API_KEY;

        if (!googleApiKey) {
            console.error('Google API Key not found');
            return res.status(500).json({ error: 'Google API key not configured on server' });
        }

        console.log('Generating audio...');
        
        // Basic cleanup of input text
        let cleanText = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // Truncate before adding SSML tags
        const SAFE_CHAR_LIMIT = 4000;
        if (cleanText.length > SAFE_CHAR_LIMIT) {
             cleanText = cleanText.substring(0, SAFE_CHAR_LIMIT) + '...';
        }

        // Convert HTML structure to SSML
        let ssmlText = cleanText
            .replace(/<\/p>/gi, '<break time="600ms"/>')
            .replace(/<br\s*\/?>/gi, '<break time="300ms"/>')
            .replace(/<[^>]*>/g, '');

        const finalSsml = `<speak>${ssmlText}</speak>`;

        // Use Google Cloud Text-to-Speech API
        const ttsEndpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleApiKey}`;

        const languageCode = voiceConfig?.languageCode || 'en-US';
        let voiceName = voiceConfig?.name || voiceConfig?.voiceName || getVoiceNameForLanguage(languageCode);

        const ttsResponse = await fetch(ttsEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { ssml: finalSsml },
                voice: { languageCode: languageCode, name: voiceName },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: settings.speed || 1.0,
                    pitch: settings.pitch || 0
                }
            })
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            console.error('Google TTS API error:', errorText);
            throw new Error(`TTS API failed: ${errorText}`);
        }

        const ttsData = await ttsResponse.json();

        if (!ttsData.audioContent) {
            throw new Error('No audio content received');
        }

        console.log('Audio generated successfully');

        return res.status(200).json({
            success: true,
            audioContent: ttsData.audioContent,
            format: 'mp3',
            metadata: { language: languageCode, voice: voiceName }
        });

    } catch (error) {
        console.error('Audio generation error:', error);
        return res.status(500).json({ error: 'Audio generation failed', details: error.message });
    }
}

function getVoiceNameForLanguage(languageCode) {
    const voiceMap = {
        'hi-IN': 'hi-IN-Wavenet-A',
        'en-US': 'en-US-Journey-F',
        'en-GB': 'en-GB-Studio-B',
        'en-IN': 'en-IN-Journey-F'
    };
    return voiceMap[languageCode] || 'en-US-Journey-F';
}
