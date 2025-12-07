import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cloneVoiceHandler from './api/clone-voice.js';
import generateAudioHandler from './api/generate-audio.js';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from server/.env
dotenv.config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: 'http://localhost:5173', // Your Vite dev server
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Theta Create API Server' });
});

// Voice cloning endpoint
app.post('/api/clone-voice', async (req, res) => {
    await cloneVoiceHandler(req, res);
});

// Audio generation endpoint
app.post('/api/generate-audio', async (req, res) => {
    await generateAudioHandler(req, res);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Theta Create API Server running on http://localhost:${PORT}`);
    console.log(`📡 CORS enabled for: http://localhost:5173`);
});
