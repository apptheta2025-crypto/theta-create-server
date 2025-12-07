import fetch from 'node-fetch';

// Server-side audio generation endpoint using Google Cloud TTS
export default async function handler(req, res) {
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
            console.error('Google API Key not found. Check server/.env file');
            return res.status(500).json({ error: 'Google API key not configured' });
        }

        console.log('Generating audio...');
        console.log(`Text length: ${text.length} characters`);
        console.log(`Voice: ${voiceId}`);
        console.log(`Language: ${voiceConfig?.languageCode || 'en-US'}`);

        // Strip HTML tags from text
        const plainText = text
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        console.log(`Plain text length: ${plainText.length} characters`);

        // Determine voice name based on language
        const languageCode = voiceConfig?.languageCode || 'en-US';

        // Google TTS has a 5000 BYTE limit per request
        // Use Buffer.byteLength for Node.js (TextEncoder is browser-only)
        const MAX_BYTES = 4500;
        let processedText = plainText;

        const textBytes = Buffer.byteLength(plainText, 'utf8');
        console.log(`Text byte length: ${textBytes} bytes`);

        if (textBytes > MAX_BYTES) {
            console.log(`Text too long (${textBytes} bytes), truncating to under ${MAX_BYTES} bytes`);

            // Truncate by reducing characters until under byte limit
            let truncated = plainText;
            while (Buffer.byteLength(truncated, 'utf8') > MAX_BYTES) {
                truncated = truncated.slice(0, -100);
            }
            processedText = truncated + '...';
            console.log(`Truncated to ${Buffer.byteLength(processedText, 'utf8')} bytes`);
        }

        // Use Google Cloud Text-to-Speech API
        const ttsEndpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleApiKey}`;

        // Determine voice name based on language
        const voiceName = getVoiceNameForLanguage(languageCode);

        const ttsResponse = await fetch(ttsEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                input: { text: processedText },
                voice: {
                    languageCode: languageCode,
                    name: voiceName
                },
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

        // Return base64 audio
        res.status(200).json({
            success: true,
            audioContent: ttsData.audioContent, // Base64 encoded audio
            format: 'mp3',
            metadata: {
                textLength: text.length,
                language: languageCode,
                voice: voiceName
            }
        });

    } catch (error) {
        console.error('Audio generation error:', error);
        res.status(500).json({
            error: 'Audio generation failed',
            details: error.message
        });
    }
}

// Helper function to get appropriate voice for language
// Using Journey and Studio voices for more natural, human-like speech
function getVoiceNameForLanguage(languageCode) {
    const voiceMap = {
        'hi-IN': 'hi-IN-Wavenet-A',     // Hindi - Wavenet is most human-like available
        'en-US': 'en-US-Journey-F',      // English US - Journey is very human-like
        'en-GB': 'en-GB-Studio-B',       // British English - Studio
        'en-IN': 'en-IN-Journey-F',      // Indian English
        'es-ES': 'es-ES-Studio-F',       // Spanish
        'fr-FR': 'fr-FR-Studio-A',       // French
        'de-DE': 'de-DE-Studio-B',       // German
        'ja-JP': 'ja-JP-Neural2-B',      // Japanese
        'ko-KR': 'ko-KR-Neural2-A'       // Korean
    };

    return voiceMap[languageCode] || 'en-US-Journey-F';
}
