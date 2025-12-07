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

        console.log('Generating audio with SSML...');

        // 1. First, basic cleanup of input text (remove weird chars but keep structure)
        let cleanText = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // 2. Truncate BEFORE adding SSML tags to be safe (Google has 5000 byte limit)
        // We leave room for SSML tags (which add bytes)
        const SAFE_CHAR_LIMIT = 4000;
        if (cleanText.length > SAFE_CHAR_LIMIT) {
            console.log(`Text too long (${cleanText.length} chars), truncating to ${SAFE_CHAR_LIMIT}...`);
            cleanText = cleanText.substring(0, SAFE_CHAR_LIMIT) + '...';
        }

        // 3. Convert HTML structure to SSML
        // - Paragraphs get a nice long pause (600ms)
        // - Line breaks get a medium pause (300ms)
        let ssmlText = cleanText
            .replace(/<\/p>/gi, '<break time="600ms"/>') // Pause at end of paragraphs
            .replace(/<br\s*\/?>/gi, '<break time="300ms"/>') // Pause at line breaks
            .replace(/<[^>]*>/g, ''); // Strip all other remaining HTML tags (like <div>, <span>, opening <p>)

        // 4. Wrap in <speak> tag
        const finalSsml = `<speak>${ssmlText}</speak>`;

        console.log(`SSML length: ${finalSsml.length} chars`);
        console.log(`Voice ID: ${voiceId}`);
        console.log(`Language: ${voiceConfig?.languageCode || 'en-US'}`);

        // Google TTS has a 5000 BYTE limit per request
        const ssmlBytes = Buffer.byteLength(finalSsml, 'utf8');
        console.log(`SSML byte length: ${ssmlBytes} bytes`);

        if (ssmlBytes > 5000) {
            console.warn('Warning: SSML byte length exceeds 5000 bytes even after initial truncation.');
        }

        // Use Google Cloud Text-to-Speech API
        const ttsEndpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleApiKey}`;

        // Determine voice name
        const languageCode = voiceConfig?.languageCode || 'en-US';

        // BUG FIX: Prioritize specific voice name from config
        // Check voiceConfig.name (system voices) or voiceConfig.voiceName (cloned voices)
        // Fallback to getVoiceNameForLanguage only if no specific name is provided
        let voiceName = voiceConfig?.name || voiceConfig?.voiceName;

        if (!voiceName) {
            console.log('No specific voice name provided, using language default');
            voiceName = getVoiceNameForLanguage(languageCode);
        } else {
            console.log(`Using specific voice: ${voiceName}`);
        }

        const ttsResponse = await fetch(ttsEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                input: { ssml: finalSsml },
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
            audioContent: ttsData.audioContent,
            format: 'mp3',
            metadata: {
                textLength: text.length,
                language: languageCode,
                voice: voiceName,
                mode: 'ssml'
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
        'hi-IN': 'hi-IN-Wavenet-A',     // Hindi
        'en-US': 'en-US-Journey-F',      // English US
        'en-GB': 'en-GB-Studio-B',       // British English
        'en-IN': 'en-IN-Journey-F',      // Indian English
        'es-ES': 'es-ES-Studio-F',       // Spanish
        'fr-FR': 'fr-FR-Studio-A',       // French
        'de-DE': 'de-DE-Studio-B',       // German
        'ja-JP': 'ja-JP-Neural2-B',      // Japanese
        'ko-KR': 'ko-KR-Neural2-A'       // Korean
    };

    return voiceMap[languageCode] || 'en-US-Journey-F';
}
