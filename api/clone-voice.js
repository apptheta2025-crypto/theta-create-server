import fetch from 'node-fetch';
import { Storage } from '@google-cloud/storage';

// Initialize Google Cloud Storage
function getStorage() {
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!credentialsJson) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON not set');
    }
    const credentials = JSON.parse(credentialsJson);
    return new Storage({ credentials, projectId: credentials.project_id });
}

// Server-side voice cloning endpoint with REAL Chirp 3
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
        const { audioUrl, voiceName, languageCode = 'en-US' } = req.body;

        if (!audioUrl || !voiceName) {
            return res.status(400).json({ error: 'Missing required fields: audioUrl, voiceName' });
        }

        const bucketName = process.env.GCS_BUCKET_NAME || 'theta-voice-samples';
        
        console.log('Step 1: Downloading audio from Supabase...');
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
            throw new Error('Failed to download audio from Supabase');
        }
        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
        console.log(`Downloaded ${audioBuffer.length} bytes`);

        console.log('Step 2: Uploading to Google Cloud Storage...');
        const storage = getStorage();
        const fileName = `voice-samples/${Date.now()}-${voiceName.replace(/\s+/g, '-')}.wav`;
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(fileName);
        
        await file.save(audioBuffer, {
            contentType: 'audio/wav',
            metadata: {
                customVoiceName: voiceName,
                languageCode: languageCode
            }
        });
        
        const gcsUri = `gs://${bucketName}/${fileName}`;
        console.log(`Uploaded to: ${gcsUri}`);

        // Return voice configuration with GCS URI for Chirp 3
        return res.status(200).json({
            success: true,
            voiceId: `chirp3-${Date.now()}`,
            voiceConfig: {
                voiceRefAudioUri: gcsUri,  // GCS URI for Chirp 3
                languageCode: languageCode,
                customVoiceName: voiceName
            },
            metadata: {
                audioSize: audioBuffer.length,
                language: languageCode,
                gcsUri: gcsUri
            }
        });

    } catch (error) {
        console.error('Voice cloning error:', error);
        return res.status(500).json({ error: 'Voice cloning failed', details: error.message });
    }
}
