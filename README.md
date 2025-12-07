# Theta Create Voice Cloning Server

This server handles server-side voice cloning using Google's Vertex AI Chirp 3 API.

## Setup Instructions

### 1. Install Server Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the `/server` directory:

```bash
cd server
cat > .env << 'EOF'
GOOGLE_CHIRP3_API_KEY=AIzaSyC--LMAZlddDV_f_hianU-40kOX-QQua_g
GOOGLE_PROJECT_ID=your-actual-google-project-id
PORT=3001
EOF
```

**Important**: The server uses **non-VITE prefixed** environment variables. Don't use `VITE_` prefix in the server `.env` file.

### 3. Run the Server

From the `server` directory:

```bash
npm run dev
```

The server will start on `http://localhost:3001`

### 4. Run Your Main App

In a separate terminal, from the main `theta-create` directory:

```bash
npm run dev
```

Your Vite app will run on `http://localhost:5173`

## How It Works

1. **Frontend** (`VoiceCloningPanel`):
   - User records or uploads audio
   - Audio is uploaded to Supabase storage
   - Frontend calls `/api/clone-voice` on localhost:3001

2. **Backend** (`server/api/clone-voice.js`):
   - Downloads audio from Supabase public URL
   - Converts to base64
   - Calls Vertex AI Chirp 3 API
   - Returns voice configuration

3. **Database**:
   - Voice record is stored with `voice_config` JSON
   - Can be used later for audio generation

## API Endpoint

### POST /api/clone-voice

**Request:**
```json
{
  "audioUrl": "https://your-supabase-url.com/audio.webm",
  "voiceName": "My Voice",
  "languageCode": "hi-IN"
}
```

**Response:**
```json
{
  "success": true,
  "voiceId": "chirp3-1234567890",
  "voiceConfig": {
    "voiceRefAudioContent": "base64...",
    "languageCode": "hi-IN",
    "gender": "NEUTRAL",
    "style": "NARRATION"
  }
}
```

## Supported Languages

- `en-US` - English (US)
- `hi-IN` - Hindi (India)
- `en-GB` - English (UK)
- Add more as needed

## Troubleshooting

- **CORS errors**: Make sure the server is running on port 3001
- **API errors**: Check your `VITE_GOOGLE_CHIRP3_API_KEY` is valid
- **Audio download fails**: Ensure Supabase storage bucket is public
