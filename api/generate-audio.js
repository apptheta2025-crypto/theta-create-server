import textToSpeech from '@google-cloud/text-to-speech';

// Get Text-to-Speech client with service account credentials
function getTTSClient() {
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!credentialsJson) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON not set');
    }
    const credentials = JSON.parse(credentialsJson);
    return new textToSpeech.TextToSpeechClient({ credentials });
}

// Server-side audio generation using Vertex AI / Google Cloud TTS
export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
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

        // Clean and prepare text
        let cleanText = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/<\/p>/gi, '. ')
            .replace(/<br\s*\/?>/gi, '. ')
            .replace(/<[^>]*>/g, '')
            .substring(0, 4000);

        // Get TTS client with OAuth2 authentication
        const client = getTTSClient();

        // Determine voice settings
        const languageCode = voiceConfig?.languageCode || 'en-US';
        const voiceName = voiceConfig?.name || getVoiceNameForLanguage(languageCode);

        console.log(`Using Vertex AI TTS with voice: ${voiceName}`);

        // Add natural pauses using SSML
        const ssmlText = `<speak>${cleanText.replace(/\. /g, '.<break time="400ms"/> ')}</speak>`;

        // Build the TTS request
        const request = {
            input: { ssml: ssmlText },
            voice: {
                languageCode: languageCode,
                name: voiceName
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: settings.speed || 1.0,
                pitch: settings.pitch || 0
            }
        };

        // Call Google Cloud TTS API
        const [response] = await client.synthesizeSpeech(request);

        if (!response.audioContent) {
            throw new Error('No audio content received from TTS API');
        }

        // Convert to base64
        const audioContent = Buffer.from(response.audioContent).toString('base64');

        console.log('Audio generated successfully via Vertex AI TTS');

        return res.status(200).json({
            success: true,
            audioContent: audioContent,
            format: 'mp3',
            metadata: { language: languageCode, voice: voiceName, mode: 'vertex-ai' }
        });

    } catch (error) {
        console.error('Audio generation error:', error);
        return res.status(500).json({ error: 'Audio generation failed', details: error.message });
    }
}

// Voice mapping - using high-quality Journey/Studio/Wavenet voices
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
