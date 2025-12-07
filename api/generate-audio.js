import fetch from 'node-fetch';

// Server-side audio generation with Chirp 3 cloned voice support
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

        const googleApiKey = process.env.GOOGLE_CHIRP3_API_KEY;
        if (!googleApiKey) {
            return res.status(500).json({ error: 'Google API key not configured' });
        }

        // Clean and prepare text
        let cleanText = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/<\/p>/gi, '. ')
            .replace(/<br\s*\/?>/gi, '. ')
            .replace(/<[^>]*>/g, '')
            .substring(0, 4000);

        const languageCode = voiceConfig?.languageCode || 'en-US';
        
        // Check if this is a Chirp 3 cloned voice (has GCS URI)
        const gcsUri = voiceConfig?.voiceRefAudioUri;
        
        let audioContent;
        
        if (gcsUri && gcsUri.startsWith('gs://')) {
            // Use Chirp 3 with cloned voice
            console.log('Using Chirp 3 cloned voice:', gcsUri);
            audioContent = await generateWithChirp3(cleanText, gcsUri, languageCode, googleApiKey, settings);
        } else {
            // Use standard TTS
            const voiceName = voiceConfig?.name || getVoiceNameForLanguage(languageCode);
            console.log('Using standard TTS voice:', voiceName);
            audioContent = await generateWithStandardTTS(cleanText, voiceName, languageCode, googleApiKey, settings);
        }

        console.log('Audio generated successfully');
        return res.status(200).json({
            success: true,
            audioContent: audioContent,
            format: 'mp3',
            metadata: { language: languageCode, mode: gcsUri ? 'chirp3' : 'standard' }
        });

    } catch (error) {
        console.error('Audio generation error:', error);
        return res.status(500).json({ error: 'Audio generation failed', details: error.message });
    }
}

// Generate audio using Chirp 3 with cloned voice (voiceRefAudioUri)
async function generateWithChirp3(text, gcsUri, languageCode, apiKey, settings) {
    const endpoint = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`;
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            input: { text: text },
            voice: {
                languageCode: languageCode,
                voiceCloneConfig: {
                    voiceRefAudioUri: gcsUri
                }
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: settings.speed || 1.0
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Chirp 3 API error:', errorText);
        throw new Error(`Chirp 3 failed: ${errorText}`);
    }

    const data = await response.json();
    return data.audioContent;
}

// Generate audio using standard Google TTS
async function generateWithStandardTTS(text, voiceName, languageCode, apiKey, settings) {
    const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    
    const ssml = `<speak>${text.replace(/\. /g, '.<break time="400ms"/> ')}</speak>`;
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            input: { ssml: ssml },
            voice: { languageCode: languageCode, name: voiceName },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: settings.speed || 1.0
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS failed: ${errorText}`);
    }

    const data = await response.json();
    return data.audioContent;
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
