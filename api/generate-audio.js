import fetch from 'node-fetch';

// CORS headers for Vercel serverless
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

// Server-side audio generation endpoint using Google Cloud TTS
export default async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).set(corsHeaders).end();
        return;
    }

    // Set CORS headers for all responses
    Object.entries(corsHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
    });

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
            return res.status(500).json({ error: 'Google API key not configured' });
        }

        console.log('Generating audio with SSML...');
        
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
             console.log(`Text too long, truncating to ${SAFE_CHAR_LIMIT}...`);
             cleanText = cleanText.substring(0, SAFE_CHAR_LIMIT) + '...';
        }

        // Convert HTML structure to SSML
        let ssmlText = cleanText
            .replace(/<\/p>/gi, '<break time="600ms"/>')
            .replace(/<br\s*\/?>/gi, '<break time="300ms"/>')
            .replace(/<[^>]*>/g, '');

        const finalSsml = `<speak>${ssmlText}</speak>`;

        console.log(`SSML length: ${finalSsml.length} chars`);

        // Use Google Cloud Text-to-Speech API
        const ttsEndpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleApiKey}`;

        const languageCode = voiceConfig?.languageCode || 'en-US';
        let voiceName = voiceConfig?.name || voiceConfig?.voiceName;
        
        if (!voiceName) {
            voiceName = getVoiceNameForLanguage(languageCode);
        }
        
        console.log(`Using voice: ${voiceName}`);

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
            throw new Error('No audio content received from TTS API');
        }

        console.log('Audio generated successfully');

        res.status(200).json({
            success: true,
            audioContent: ttsData.audioContent,
            format: 'mp3',
            metadata: { language: languageCode, voice: voiceName, mode: 'ssml' }
        });

    } catch (error) {
        console.error('Audio generation error:', error);
        res.status(500).json({ error: 'Audio generation failed', details: error.message });
    }
}

function getVoiceNameForLanguage(languageCode) {
    const voiceMap = {
        'hi-IN': 'hi-IN-Wavenet-A',
        'en-US': 'en-US-Journey-F',
        'en-GB': 'en-GB-Studio-B',
        'en-IN': 'en-IN-Journey-F',
        'es-ES': 'es-ES-Studio-F',
        'fr-FR': 'fr-FR-Studio-A',
        'de-DE': 'de-DE-Studio-B',
        'ja-JP': 'ja-JP-Neural2-B',
        'ko-KR': 'ko-KR-Neural2-A'
    };
    return voiceMap[languageCode] || 'en-US-Journey-F';
}
