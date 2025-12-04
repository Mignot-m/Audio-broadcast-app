const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const http = require('http');
const WebSocket = require('ws');
const session = require('express-session');

const app = express();
require('dotenv').config();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// ==================== SESSION & PASSWORD AUTH ====================
const SESSION_SECRET = process.env.SESSION_SECRET;
const CONTROL_PASSWORD = process.env.CONTROL_PASSWORD // Change this to your desired password

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24h session, set secure: true for HTTPS
}));

// Middleware to protect only the control panel
function requireAuth(req, res, next) {
    if (req.path === '/' || req.path.startsWith('/static')) {
        if (req.session.authenticated) {
            return next();
        } else {
            return res.redirect('/login');
        }
    }
    next(); // All other routes (APIs, /display, /stream-video, etc.) remain public
}

app.use(requireAuth);

// ==================== LOGIN PAGE ====================
app.get('/login', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Broadcast Control Login</title>
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #1a237e, #311b92); color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .login-box { background: rgba(255,255,255,0.1); padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); width: 320px; text-align: center; }
            input, button { width: 100%; padding: 12px; margin: 10px 0; border: none; border-radius: 6px; font-size: 16px; }
            input { background: #fff; color: #333; }
            button { background: #28a745; color: white; cursor: pointer; }
            button:hover { background: #218838; }
            h2 { margin-bottom: 20px; }
            p.error { color: #f44336; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="login-box">
            <h2>Broadcast Control Panel</h2>
            <form method="POST" action="/login">
                <input type="password" name="password" placeholder="Enter password" required autofocus>
                <button type="submit">Login</button>
            </form>
        </div>
    </body>
    </html>
    `);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    if (req.body.password === CONTROL_PASSWORD) {
        req.session.authenticated = true;
        return res.redirect('/');
    } else {
        return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Broadcast Control Login</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #1a237e, #311b92); color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .login-box { background: rgba(255,255,255,0.1); padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); width: 320px; text-align: center; }
                input, button { width: 100%; padding: 12px; margin: 10px 0; border: none; border-radius: 6px; font-size: 16px; }
                input { background: #fff; color: #333; }
                button { background: #28a745; color: white; cursor: pointer; }
                button:hover { background: #218838; }
                h2 { margin-bottom: 20px; }
                p.error { color: #f44336; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h2>Broadcast Control Panel</h2>
                <p class="error">Incorrect password, please try again.</p>
                <form method="POST" action="/login">
                    <input type="password" name="password" placeholder="Enter password" required autofocus>
                    <button type="submit">Login</button>
                </form>
            </div>
        </body>
        </html>
        `);
    }
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/');
        }
        res.redirect('/login');
    });
});

// ==================== WEB SOCKET FOR REAL-TIME SYNC ====================
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`📱 Client connected. Total: ${clients.size}`);
    
    ws.send(JSON.stringify({
        type: 'status',
        broadcast: CONFIG.broadcast
    }));
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`📱 Client disconnected. Total: ${clients.size}`);
    });
});

function broadcastToClients(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    console.log(`📢 Broadcasted: ${data.type} to ${clients.size} clients`);
}

// ==================== STATIC FILE SERVING ====================
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'media')));

// ==================== CONFIGURATION ====================
const CONFIG = {
    broadcast: {
        currentAudio: '',
        currentVideo: '',
        currentMessage: 'Welcome to Broadcast System',
        isPlaying: false,
        mode: 'audio',
        timestamp: Date.now(),
        playlist: [],
        currentIndex: 0
    }
};

// ==================== AUTO-CREATE FOLDERS ====================
function initializeServer() {
    const folders = ['media/audio', 'media/video', 'config'];
    folders.forEach(folder => {
        const dir = path.join(__dirname, folder);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created folder: ${folder}`);
        }
    });
    
    console.log('🚀 Broadcast Server Initialized');
}

// ==================== FILE UPLOAD CONFIG ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folder = file.mimetype.startsWith('audio/') ? 'audio' : 'video';
        const dir = path.join(__dirname, 'media', folder);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const fileExt = path.extname(file.originalname);
        const fileName = path.basename(file.originalname, fileExt);
        const folder = file.mimetype.startsWith('audio/') ? 'audio' : 'video';
        const filePath = path.join(__dirname, 'media', folder, file.originalname);
        
        if (fs.existsSync(filePath)) {
            const newFileName = `${fileName}_${Date.now()}${fileExt}`;
            console.log(`⚠️ File ${file.originalname} exists, saving as: ${newFileName}`);
            cb(null, newFileName);
        } else {
            cb(null, file.originalname);
        }
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedAudioTypes = ['.mp3', '.wav', '.m4a', '.ogg'];
        const allowedVideoTypes = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
        const fileExt = path.extname(file.originalname).toLowerCase();
        
        const isAudio = file.mimetype.startsWith('audio/') || allowedAudioTypes.includes(fileExt);
        const isVideo = file.mimetype.startsWith('video/') || allowedVideoTypes.includes(fileExt);
        
        if (isAudio || isVideo) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type: ${fileExt}. Allowed: ${[...allowedAudioTypes, ...allowedVideoTypes].join(', ')}`), false);
        }
    }
});

// ==================== VIDEO STREAMING ====================
app.get('/stream-video/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'media', 'video', filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Video file not found' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
    }
});

// ==================== FILE VALIDATION ====================
function validateAudioFile(filename) {
    if (!filename) return { valid: true, exists: false };
    
    const audioPath = path.join(__dirname, 'media', 'audio', filename);
    const exists = fs.existsSync(audioPath);
    
    return {
        valid: exists,
        exists: exists,
        path: audioPath,
        message: exists ? 'Audio file exists' : `Audio file not found: ${filename}`
    };
}

function validateVideoFile(filename) {
    if (!filename) return { valid: true, exists: false };
    
    const videoPath = path.join(__dirname, 'media', 'video', filename);
    const exists = fs.existsSync(videoPath);
    
    return {
        valid: exists,
        exists: exists,
        path: videoPath,
        message: exists ? 'Video file exists' : `Video file not found: ${filename}`
    };
}

function playNextTrack() {
    if (CONFIG.broadcast.playlist.length === 0 || CONFIG.broadcast.mode !== 'audio') {
        return;
    }
    
    CONFIG.broadcast.currentIndex++;
    
    if (CONFIG.broadcast.currentIndex >= CONFIG.broadcast.playlist.length) {
        CONFIG.broadcast.isPlaying = false;
        CONFIG.broadcast.currentAudio = '';
        CONFIG.broadcast.playlist = [];
        CONFIG.broadcast.currentIndex = 0;
        
        broadcastToClients({
            type: 'stop',
            broadcast: CONFIG.broadcast
        });
        
        console.log('🎵 Playlist completed');
        return;
    }
    
    const nextAudio = CONFIG.broadcast.playlist[CONFIG.broadcast.currentIndex];
    const audioValidation = validateAudioFile(nextAudio);
    
    if (audioValidation.valid) {
        CONFIG.broadcast.currentAudio = nextAudio;
        CONFIG.broadcast.isPlaying = true;
        CONFIG.broadcast.timestamp = Date.now();
        
        console.log(`🎵 Playing next track: ${nextAudio} (${CONFIG.broadcast.currentIndex + 1}/${CONFIG.broadcast.playlist.length})`);
        
        broadcastToClients({
            type: 'play',
            broadcast: CONFIG.broadcast
        });
    } else {
        console.log(`❌ Audio file not found: ${nextAudio}, skipping...`);
        setTimeout(playNextTrack, 100);
    }
}

// ==================== FILE MANAGEMENT ENDPOINTS ====================
app.delete('/files/delete/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    
    if (!['audio', 'video'].includes(type) || filename.includes('..')) {
        return res.status(400).json({ error: 'Invalid file path' });
    }
    
    const filePath = path.join(__dirname, 'media', type, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ File deleted: ${type}/${filename}`);
        
        if (type === 'audio' && CONFIG.broadcast.currentAudio === filename) {
            CONFIG.broadcast.currentAudio = '';
            CONFIG.broadcast.isPlaying = false;
            broadcastToClients({
                type: 'stop',
                broadcast: CONFIG.broadcast
            });
            
            if (CONFIG.broadcast.playlist.length > 0) {
                setTimeout(playNextTrack, 100);
            }
        }
        if (type === 'video' && CONFIG.broadcast.currentVideo === filename) {
            CONFIG.broadcast.currentVideo = '';
            CONFIG.broadcast.isPlaying = false;
            broadcastToClients({
                type: 'stop',
                broadcast: CONFIG.broadcast
            });
        }
        
        res.json({ 
            status: 'success', 
            message: `File ${filename} deleted successfully` 
        });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== BROADCAST CONTROL ENDPOINTS ====================
app.get('/api/broadcast-status', (req, res) => {
    res.json(CONFIG.broadcast);
});

app.post('/api/change-mode', express.json(), (req, res) => {
    const { mode } = req.body;
    
    if (!['audio', 'video'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode. Must be audio or video' });
    }
    
    CONFIG.broadcast.mode = mode;
    if (mode === 'video') {
        CONFIG.broadcast.playlist = [];
        CONFIG.broadcast.currentIndex = 0;
    }
    console.log(`🔄 Broadcast mode changed to: ${mode}`);
    
    res.json({ 
        status: 'success', 
        message: `Mode changed to ${mode} broadcast`,
        broadcast: CONFIG.broadcast 
    });
});

app.post('/api/start-broadcast', express.json(), (req, res) => {
    const { audio, video, mode, playlist = [] } = req.body;
    
    const isPlaylistMode = Array.isArray(playlist) && playlist.length > 0;
    
    if (mode === 'audio') {
        if (isPlaylistMode) {
            const invalidFiles = [];
            playlist.forEach(filename => {
                const audioValidation = validateAudioFile(filename);
                if (!audioValidation.valid) {
                    invalidFiles.push(filename);
                }
            });
            
            if (invalidFiles.length > 0) {
                return res.status(404).json({ 
                    error: `Some audio files not found: ${invalidFiles.join(', ')}` 
                });
            }
            
            CONFIG.broadcast.playlist = playlist;
            CONFIG.broadcast.currentIndex = 0;
            CONFIG.broadcast.currentAudio = playlist[0];
            CONFIG.broadcast.currentVideo = '';
            
            console.log(`🎵 Starting playlist with ${playlist.length} tracks`);
            
        } else if (audio) {
            const audioValidation = validateAudioFile(audio);
            if (!audioValidation.valid) {
                return res.status(404).json({ error: `Audio file not found: ${audio}` });
            }
            CONFIG.broadcast.currentAudio = audio;
            CONFIG.broadcast.currentVideo = '';
            CONFIG.broadcast.playlist = [];
            CONFIG.broadcast.currentIndex = 0;
            console.log(`🎵 Setting audio broadcast: ${audio}`);
        } else {
            return res.status(400).json({ error: 'No audio file or playlist selected for broadcast' });
        }
    } else if (mode === 'video' && video) {
        const videoValidation = validateVideoFile(video);
        if (!videoValidation.valid) {
            return res.status(404).json({ error: `Video file not found: ${video}` });
        }
        CONFIG.broadcast.currentVideo = video;
        CONFIG.broadcast.currentAudio = '';
        CONFIG.broadcast.playlist = [];
        CONFIG.broadcast.currentIndex = 0;
        console.log(`🎥 Setting video broadcast: ${video}`);
    } else {
        return res.status(400).json({ error: 'No file selected for broadcast' });
    }
    
    CONFIG.broadcast.mode = mode;
    CONFIG.broadcast.isPlaying = true;
    CONFIG.broadcast.timestamp = Date.now();
    
    console.log(`🎬 STARTING BROADCAST: ${mode} - ${CONFIG.broadcast.currentAudio || CONFIG.broadcast.currentVideo}`);
    if (isPlaylistMode) {
        console.log(`📋 Playlist: ${playlist.join(', ')}`);
    }
    
    broadcastToClients({
        type: 'play',
        broadcast: CONFIG.broadcast
    });
    
    res.json({ 
        status: 'success', 
        message: isPlaylistMode ? `Playlist started with ${playlist.length} tracks` : 'Broadcast started successfully!',
        broadcast: CONFIG.broadcast
    });
});

app.post('/api/stop-broadcast', express.json(), (req, res) => {
    CONFIG.broadcast.isPlaying = false;
    CONFIG.broadcast.currentAudio = '';
    CONFIG.broadcast.currentVideo = '';
    CONFIG.broadcast.playlist = [];
    CONFIG.broadcast.currentIndex = 0;
    
    console.log('⏹️ STOPPING BROADCAST');
    
    broadcastToClients({
        type: 'stop',
        broadcast: CONFIG.broadcast
    });
    
    res.json({ 
        status: 'success', 
        message: 'Broadcast stopped successfully!',
        broadcast: CONFIG.broadcast 
    });
});

app.post('/api/track-ended', express.json(), (req, res) => {
    if (CONFIG.broadcast.mode === 'audio' && CONFIG.broadcast.playlist.length > 0) {
        console.log(`🎵 Track ended: ${CONFIG.broadcast.currentAudio}`);
        playNextTrack();
    }
    
    res.json({ 
        status: 'success', 
        message: 'Track end notification received'
    });
});

// ==================== FILE MANAGEMENT ====================
app.post('/upload', upload.single('mediaFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log(`📁 File uploaded: ${req.file.originalname} (saved as: ${req.file.filename})`);
    
    res.json({ 
        status: 'success', 
        message: 'File uploaded successfully!',
        file: req.file.filename,
        originalName: req.file.originalname,
        type: req.file.mimetype.startsWith('audio/') ? 'audio' : 'video',
        size: req.file.size,
        sizeFormatted: formatFileSize(req.file.size)
    });
}, (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 100MB.' });
        }
    }
    res.status(400).json({ error: error.message });
});

app.get('/files/audio', (req, res) => {
    try {
        const audioDir = path.join(__dirname, 'media', 'audio');
        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
            return res.json([]);
        }
        
        const files = fs.readdirSync(audioDir)
            .filter(f => f.match(/\.(mp3|wav|m4a|ogg)$/i))
            .map(file => {
                const filePath = path.join(audioDir, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    size: stats.size,
                    sizeFormatted: formatFileSize(stats.size),
                    modified: stats.mtime,
                    isCurrentBroadcast: CONFIG.broadcast.currentAudio === file
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
            
        res.json(files);
    } catch (error) {
        console.error('Error loading audio files:', error);
        res.json([]);
    }
});

app.get('/files/video', (req, res) => {
    try {
        const videoDir = path.join(__dirname, 'media', 'video');
        if (!fs.existsSync(videoDir)) {
            fs.mkdirSync(videoDir, { recursive: true });
            return res.json([]);
        }
        
        const files = fs.readdirSync(videoDir)
            .filter(f => f.match(/\.(mp4|avi|mov|mkv|webm)$/i))
            .map(file => {
                const filePath = path.join(videoDir, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    size: stats.size,
                    sizeFormatted: formatFileSize(stats.size),
                    modified: stats.mtime,
                    isCurrentBroadcast: CONFIG.broadcast.currentVideo === file
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
            
        res.json(files);
    } catch (error) {
        console.error('Error loading video files:', error);
        res.json([]);
    }
});

// ==================== CONTROL PANEL ====================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Broadcast Control Panel</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: #f5f5f5;
                color: #333;
                line-height: 1.6;
            }
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
            .header { 
                background: linear-gradient(135deg, #1a237e, #311b92);
                color: white;
                padding: 30px;
                border-radius: 15px;
                margin-bottom: 30px;
                text-align: center;
                position: relative;
            }
            .logout-btn {
                position: absolute;
                top: 20px;
                right: 20px;
                background: #dc3545;
                color: white;
                padding: 10px 20px;
                border-radius: 6px;
                text-decoration: none;
                font-size: 14px;
            }
            .logout-btn:hover { background: #c82333; }
            .card {
                background: white;
                padding: 25px;
                margin: 20px 0;
                border-radius: 12px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                border-left: 5px solid #1a237e;
            }
            .button {
                background: #1a237e;
                color: white;
                border: none;
                padding: 12px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                margin: 5px;
                transition: all 0.3s ease;
            }
            .button:hover { background: #311b92; transform: translateY(-2px); }
            .button-success {
                background: #28a745;
            }
            .button-success:hover {
                background: #218838;
            }
            .button-danger {
                background: #dc3545;
            }
            .button-danger:hover {
                background: #c82333;
            }
            .file-list { max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 15px; }
            .status-indicator { 
                display: inline-block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                margin-right: 8px;
            }
            .status-live { background: #4caf50; }
            .status-offline { background: #f44336; }
            select, input {
                width: 100%;
                padding: 12px;
                margin: 8px 0;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-size: 16px;
            }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
            .file-item {
                padding: 10px;
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .file-item:last-child { border-bottom: none; }
            .file-info { flex-grow: 1; }
            .file-name { font-weight: bold; margin-bottom: 5px; }
            .file-details { font-size: 12px; color: #666; }
            .file-actions { display: flex; gap: 5px; flex-wrap: wrap; }
            .current-broadcast { background: #e8f5e8; border-left: 3px solid #4caf50; }
            .mode-selector {
                display: flex;
                gap: 10px;
                margin: 15px 0;
            }
            .mode-button {
                flex: 1;
                padding: 15px;
                text-align: center;
                border: 2px solid #ddd;
                border-radius: 8px;
                cursor: pointer;
                background: white;
                transition: all 0.3s ease;
            }
            .mode-button.active {
                border-color: #1a237e;
                background: #1a237e;
                color: white;
            }
            .now-playing {
                background: #e3f2fd;
                padding: 15px;
                border-radius: 8px;
                margin: 15px 0;
                border-left: 4px solid #1a237e;
            }
            .broadcast-status {
                background: #fff3cd;
                padding: 15px;
                border-radius: 8px;
                margin: 15px 0;
                border-left: 4px solid #ffc107;
            }
            .upload-area {
                border: 2px dashed #1a237e;
                border-radius: 10px;
                padding: 20px;
                text-align: center;
                background: #f8f9fa;
                margin: 10px 0;
            }
            .file-types {
                font-size: 12px;
                color: #666;
                margin-top: 5px;
            }
            .control-buttons {
                display: flex;
                gap: 10px;
                margin: 15px 0;
            }
            .control-buttons .button {
                flex: 1;
                text-align: center;
            }
            .playlist-info {
                font-size: 14px;
                color: #28a745;
                margin-top: 5px;
            }
            .local-player {
                background: #f8f9fa;
                border: 2px solid #1a237e;
                border-radius: 10px;
                padding: 15px;
                margin: 15px 0;
                display: none;
            }
            .local-player.active {
                display: block;
            }
            .player-controls {
                display: flex;
                gap: 10px;
                margin-top: 10px;
            }
            .player-info {
                font-weight: bold;
                color: #1a237e;
                margin-bottom: 10px;
            }
            .modal {
                display: none;
                position: fixed;
                z-index: 1000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0,0,0,0.9);
            }
            .modal-content {
                position: relative;
                margin: 2% auto;
                padding: 20px;
                width: 90%;
                max-width: 800px;
                background: #1a1a1a;
                border-radius: 10px;
            }
            .close {
                color: white;
                position: absolute;
                top: 10px;
                right: 25px;
                font-size: 35px;
                font-weight: bold;
                cursor: pointer;
                z-index: 1001;
            }
            .close:hover {
                color: #ccc;
            }
            #videoPreview {
                width: 100%;
                height: auto;
                border-radius: 8px;
            }
            .modal-title {
                color: white;
                text-align: center;
                margin-bottom: 15px;
                font-size: 18px;
            }
            .multi-select-info {
                font-size: 12px;
                color: #666;
                margin: 5px 0;
                font-style: italic;
            }
        </style>
    </head>
    <body>
        <div id="videoModal" class="modal">
            <div class="modal-content">
                <span class="close" onclick="closeVideoModal()">&times;</span>
                <div class="modal-title" id="videoModalTitle">Playing Video</div>
                <video id="videoPreview" controls autoplay>
                    Your browser does not support the video tag.
                </video>
            </div>
        </div>

        <div class="container">
            <div class="header">
                <h1>🎛️ BROADCAST CONTROL PANEL</h1>
                <p>Control all connected displays in real-time</p>
                <a href="/logout" class="logout-btn">Logout</a>
            </div>
            
            <div class="card">
                <h2>📊 Broadcast Status</h2>
                <div class="broadcast-status">
                    <span class="status-indicator" id="statusIndicator"></span>
                    <strong id="broadcastStatusText">No broadcast active</strong>
                    <div style="margin-top: 10px;">
                        <strong>Connected Clients:</strong> <span id="clientCount">0</span>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>🎵 Local Player (Testing)</h2>
                <div class="local-player" id="localPlayer">
                    <div class="player-info" id="localPlayerInfo">No file selected</div>
                    <div class="player-controls">
                        <button class="button" onclick="localPlay()">▶️ Play</button>
                        <button class="button" onclick="localStop()">⏹️ Stop</button>
                        <button class="button button-danger" onclick="closeLocalPlayer()">❌ Close</button>
                    </div>
                    <audio id="localAudioElement" style="width: 100%; margin-top: 10px;" controls>
                        Your browser does not support the audio element.
                    </audio>
                </div>
                <p style="color: #666; font-size: 14px; margin-top: 10px;">
                    <em>Use this to test audio files locally before broadcasting</em>
                </p>
            </div>

            <div class="card">
                <h2>🎛️ Broadcast Control</h2>
                <div class="mode-selector">
                    <div class="mode-button active" id="audioModeButton" onclick="setBroadcastMode('audio')">
                        🎵 Audio Broadcast
                    </div>
                    <div class="mode-button" id="videoModeButton" onclick="setBroadcastMode('video')">
                        🎥 Video Broadcast
                    </div>
                </div>
                <div id="audioSelection">
                    <label><strong>🎵 Select Audio File(s):</strong></label>
                    <div class="multi-select-info">Hold Ctrl (or Cmd on Mac) to select multiple files for continuous playback</div>
                    <select id="audioSelect" multiple size="5">
                        <option value="">Select Audio File...</option>
                    </select>
                </div>
                <div id="videoSelection" style="display: none;">
                    <label><strong>🎥 Select Video File:</strong></label>
                    <select id="videoSelect">
                        <option value="">Select Video File...</option>
                    </select>
                </div>
                <div class="control-buttons">
                    <button class="button button-success" onclick="startBroadcast()" id="startButton">
                        🎬 Start Broadcast
                    </button>
                    <button class="button button-danger" onclick="stopBroadcast()" id="stopButton" disabled>
                        ⏹️ Stop Broadcast
                    </button>
                </div>
                <div class="now-playing">
                    <strong>Now Broadcasting:</strong> <span id="nowPlaying">Nothing</span><br>
                    <strong>Mode:</strong> <span id="currentMode">Audio</span><br>
                    <strong>Status:</strong> <span id="playbackStatus">Stopped</span>
                    <div id="playlistInfo" class="playlist-info" style="display: none;"></div>
                </div>
            </div>
            
            <div class="grid">
                <div class="card">
                    <h2>📁 Upload Media</h2>
                    <div class="upload-area">
                        <form id="uploadForm" enctype="multipart/form-data">
                            <input type="file" name="mediaFile" id="fileInput" accept=".mp3,.wav,.m4a,.mp4,.avi,.mov,.mkv,.webm" required>
                            <div class="file-types">
                                Supported: MP3, WAV, M4A, MP4, AVI, MOV, MKV, WEBM (Max: 100MB)
                            </div>
                            <button type="submit" class="button" style="margin-top: 10px;">Upload File</button>
                        </form>
                    </div>
                    <div id="uploadResult" style="margin-top: 10px;"></div>
                </div>
                <div class="card">
                    <h3>🎵 Audio Files <span id="audioCount"></span></h3>
                    <div class="file-list" id="audioFiles">Loading audio files...</div>
                </div>
                <div class="card">
                    <h3>🎥 Video Files <span id="videoCount"></span></h3>
                    <div class="file-list" id="videoFiles">Loading video files...</div>
                </div>
            </div>
        </div>

        <script>
            let currentBroadcastMode = 'audio';
            let ws = null;
            let connectedClients = 0;
            let localAudioElement = null;
            
            function connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = \`\${protocol}//\${window.location.host}\`;
                
                ws = new WebSocket(wsUrl);
                
                ws.onopen = () => {
                    console.log('🔗 Connected to server');
                };
                
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    console.log('📨 Received:', data.type);
                    
                    if (data.type === 'status') {
                        updateBroadcastStatus(data.broadcast, false);
                    } else if (data.type === 'play' || data.type === 'stop') {
                        updateBroadcastStatus(data.broadcast, false);
                    }
                };
                
                ws.onclose = () => {
                    console.log('🔌 Disconnected from server');
                    setTimeout(connectWebSocket, 3000);
                };
            }
            
            document.addEventListener('DOMContentLoaded', function() {
                connectWebSocket();
                loadMediaFiles();
                updateBroadcastStatusFromServer();
                
                localAudioElement = document.getElementById('localAudioElement');
                
                document.getElementById('fileInput').addEventListener('change', function(e) {
                    const file = e.target.files[0];
                    if (file && file.size > 100 * 1024 * 1024) {
                        alert('File too large! Maximum size is 100MB.');
                        e.target.value = '';
                    }
                });
            });
            
            async function setBroadcastMode(mode) {
                currentBroadcastMode = mode;
                
                document.getElementById('audioModeButton').classList.toggle('active', mode === 'audio');
                document.getElementById('videoModeButton').classList.toggle('active', mode === 'video');
                document.getElementById('audioSelection').style.display = mode === 'audio' ? 'block' : 'none';
                document.getElementById('videoSelection').style.display = mode === 'video' ? 'block' : 'none';
                document.getElementById('currentMode').textContent = mode === 'audio' ? 'Audio' : 'Video';
                
                document.getElementById('audioSelect').selectedIndex = -1;
                document.getElementById('videoSelect').value = '';
                
                try {
                    const response = await fetch('/api/change-mode', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: mode })
                    });
                    
                    const result = await response.json();
                    if (result.status === 'success') {
                        console.log('✅ Mode changed to:', mode);
                    } else {
                        console.error('Failed to change mode:', result.error);
                        alert('Failed to change mode: ' + result.error);
                    }
                } catch (error) {
                    console.error('Error changing mode:', error);
                    alert('Failed to change mode: ' + error.message);
                }
            }
            
            function playLocalFile(filename, type) {
                if (type === 'audio') {
                    document.getElementById('localPlayer').classList.add('active');
                    document.getElementById('localPlayerInfo').textContent = 'Playing: ' + filename;
                    
                    localAudioElement.src = '/media/audio/' + filename;
                    localAudioElement.play().catch(e => {
                        console.log('Local audio play failed:', e);
                        alert('Cannot play audio file locally');
                    });
                } else if (type === 'video') {
                    playVideoFile(filename);
                }
            }
            
            function playVideoFile(filename) {
                const modal = document.getElementById('videoModal');
                const videoPlayer = document.getElementById('videoPreview');
                const modalTitle = document.getElementById('videoModalTitle');
                
                modalTitle.textContent = 'Playing: ' + filename;
                videoPlayer.src = '/media/video/' + filename;
                
                modal.style.display = 'block';
                
                videoPlayer.play().catch(e => {
                    console.log('Video auto-play blocked, user can click play');
                });
            }
            
            function closeVideoModal() {
                const modal = document.getElementById('videoModal');
                const videoPlayer = document.getElementById('videoPreview');
                
                videoPlayer.pause();
                videoPlayer.currentTime = 0;
                modal.style.display = 'none';
            }
            
            function localPlay() {
                if (localAudioElement.src) {
                    localAudioElement.play().catch(e => {
                        alert('Cannot play audio: ' + e.message);
                    });
                }
            }
            
            function localStop() {
                localAudioElement.pause();
                localAudioElement.currentTime = 0;
            }
            
            function closeLocalPlayer() {
                localStop();
                localAudioElement.src = '';
                document.getElementById('localPlayer').classList.remove('active');
                document.getElementById('localPlayerInfo').textContent = 'No file selected';
            }
            
            async function startBroadcast() {
                let audioFile = '';
                let playlist = [];
                
                if (currentBroadcastMode === 'audio') {
                    const select = document.getElementById('audioSelect');
                    const selectedOptions = Array.from(select.selectedOptions);
                    const selectedFiles = selectedOptions.map(option => option.value).filter(v => v);
                    
                    if (selectedFiles.length === 0) {
                        alert('Please select at least one audio file for broadcast.');
                        return;
                    }
                    
                    if (selectedFiles.length === 1) {
                        audioFile = selectedFiles[0];
                        playlist = [];
                    } else {
                        audioFile = selectedFiles[0];
                        playlist = selectedFiles;
                        console.log('Starting playlist with', playlist.length, 'tracks');
                    }
                } else if (currentBroadcastMode === 'video') {
                    const videoFile = document.getElementById('videoSelect').value;
                    
                    if (!videoFile) {
                        alert('Please select a video file for video broadcast.');
                        return;
                    }
                }
                
                try {
                    const response = await fetch('/api/start-broadcast', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            audio: audioFile,
                            video: currentBroadcastMode === 'video' ? document.getElementById('videoSelect').value : '',
                            mode: currentBroadcastMode,
                            playlist: playlist
                        })
                    });
                    
                    const result = await response.json();
                    if (result.status === 'success') {
                        console.log('✅ Broadcast started:', result.broadcast);
                        updateBroadcastStatus(result.broadcast, true);
                    } else {
                        alert('❌ ' + result.error);
                    }
                } catch (error) {
                    alert('❌ Failed to start broadcast: ' + error.message);
                }
            }
            
            async function stopBroadcast() {
                try {
                    const response = await fetch('/api/stop-broadcast', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    const result = await response.json();
                    if (result.status === 'success') {
                        console.log('⏹️ Broadcast stopped');
                        updateBroadcastStatus(result.broadcast, true);
                    } else {
                        alert('❌ ' + result.error);
                    }
                } catch (error) {
                    alert('❌ Failed to stop broadcast');
                }
            }
            
            async function updateBroadcastStatusFromServer() {
                try {
                    const response = await fetch('/api/broadcast-status');
                    const status = await response.json();
                    updateBroadcastStatus(status, false);
                } catch (error) {
                    console.log('Failed to get broadcast status');
                }
            }
            
            function updateBroadcastStatus(broadcast, isUserAction = false) {
                const statusIndicator = document.getElementById('statusIndicator');
                const statusText = document.getElementById('broadcastStatusText');
                const nowPlaying = document.getElementById('nowPlaying');
                const playbackStatus = document.getElementById('playbackStatus');
                const playlistInfo = document.getElementById('playlistInfo');
                
                if (broadcast.isPlaying) {
                    statusIndicator.className = 'status-indicator status-live';
                    statusText.textContent = 'LIVE BROADCAST ACTIVE';
                    document.getElementById('startButton').disabled = true;
                    document.getElementById('stopButton').disabled = false;
                    playbackStatus.textContent = 'Playing';
                    
                    if (broadcast.playlist && broadcast.playlist.length > 0 && broadcast.currentIndex >= 0) {
                        playlistInfo.style.display = 'block';
                        playlistInfo.textContent = \`Track \${broadcast.currentIndex + 1} of \${broadcast.playlist.length}\`;
                    } else {
                        playlistInfo.style.display = 'none';
                    }
                } else {
                    statusIndicator.className = 'status-indicator status-offline';
                    statusText.textContent = 'NO BROADCAST ACTIVE';
                    document.getElementById('startButton').disabled = false;
                    document.getElementById('stopButton').disabled = true;
                    playbackStatus.textContent = 'Stopped';
                    playlistInfo.style.display = 'none';
                }
                
                if (broadcast.mode === 'audio' && broadcast.currentAudio) {
                    nowPlaying.textContent = '🔊 ' + broadcast.currentAudio;
                    const audioSelect = document.getElementById('audioSelect');
                    for (let option of audioSelect.options) {
                        option.selected = option.value === broadcast.currentAudio;
                    }
                } else if (broadcast.mode === 'video' && broadcast.currentVideo) {
                    nowPlaying.textContent = '🎥 ' + broadcast.currentVideo;
                    document.getElementById('videoSelect').value = broadcast.currentVideo;
                } else {
                    nowPlaying.textContent = 'Nothing';
                }
                
                if (isUserAction && broadcast.mode) {
                    setBroadcastMode(broadcast.mode);
                }
            }
            
            document.getElementById('uploadForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const resultDiv = document.getElementById('uploadResult');
                
                try {
                    resultDiv.innerHTML = '<p>⏳ Uploading...</p>';
                    const response = await fetch('/upload', { method: 'POST', body: formData });
                    const result = await response.json();
                    
                    if (result.status === 'success') {
                        let message = \`✅ \${result.message}\`;
                        if (result.file !== result.originalName) {
                            message += \` (Renamed from \"\${result.originalName}\")\`;
                        }
                        message += \` - \${result.sizeFormatted}\`;
                        
                        resultDiv.innerHTML = \`<p style="color: green;">\${message}</p>\`;
                        e.target.reset();
                        loadMediaFiles();
                    } else {
                        resultDiv.innerHTML = \`<p style="color: red;">❌ \${result.error}</p>\`;
                    }
                } catch (error) {
                    resultDiv.innerHTML = '<p style="color: red;">❌ Upload failed: ' + error.message + '</p>';
                }
            });
            
            async function loadMediaFiles() {
                try {
                    const audioResponse = await fetch('/files/audio');
                    const audioFiles = await audioResponse.json();
                    const audioDiv = document.getElementById('audioFiles');
                    const audioSelect = document.getElementById('audioSelect');
                    
                    audioDiv.innerHTML = '';
                    audioSelect.innerHTML = '<option value="">Select Audio File...</option>';
                    
                    audioFiles.forEach(file => {
                        const fileItem = createFileItem(file, 'audio');
                        audioDiv.appendChild(fileItem);
                        
                        const option = document.createElement('option');
                        option.value = file.name;
                        option.textContent = file.name;
                        audioSelect.appendChild(option);
                    });
                    
                    document.getElementById('audioCount').textContent = \`(\${audioFiles.length} files)\`;
                    
                    if (audioFiles.length === 0) {
                        audioDiv.innerHTML = '<p>No audio files uploaded yet.</p>';
                    }
                    
                    const videoResponse = await fetch('/files/video');
                    const videoFiles = await videoResponse.json();
                    const videoDiv = document.getElementById('videoFiles');
                    const videoSelect = document.getElementById('videoSelect');
                    
                    videoDiv.innerHTML = '';
                    videoSelect.innerHTML = '<option value="">Select Video File...</option>';
                    
                    videoFiles.forEach(file => {
                        const fileItem = createFileItem(file, 'video');
                        videoDiv.appendChild(fileItem);
                        
                        const option = document.createElement('option');
                        option.value = file.name;
                        option.textContent = file.name;
                        videoSelect.appendChild(option);
                    });
                    
                    document.getElementById('videoCount').textContent = \`(\${videoFiles.length} files)\`;
                    
                    if (videoFiles.length === 0) {
                        videoDiv.innerHTML = '<p>No video files uploaded yet.</p>';
                    }
                    
                    console.log('Loaded files - Audio:', audioFiles.length, 'Video:', videoFiles.length);
                    
                } catch (error) {
                    console.error('Error loading files:', error);
                    document.getElementById('audioFiles').innerHTML = '<p>Error loading audio files</p>';
                    document.getElementById('videoFiles').innerHTML = '<p>Error loading video files</p>';
                }
            }
            
            function createFileItem(file, type) {
                const fileDiv = document.createElement('div');
                fileDiv.className = \`file-item \${file.isCurrentBroadcast ? 'current-broadcast' : ''}\`;
                
                const icon = type === 'audio' ? '🔊' : '🎥';
                const playText = type === 'audio' ? '▶️ Play' : '🎬 Play';
                
                fileDiv.innerHTML = \`
                    <div class="file-info">
                        <div class="file-name">\${icon} \${file.name}</div>
                        <div class="file-details">
                            \${file.sizeFormatted} • \${new Date(file.modified).toLocaleDateString()}
                            \${file.isCurrentBroadcast ? '<div style="color: green; font-size: 12px;">● Currently Broadcasting</div>' : ''}
                        </div>
                    </div>
                    <div class="file-actions">
                        <button class="button" onclick="playLocalFile('\${file.name}', '\${type}')">\${playText}</button>
                        <button class="button button-danger" onclick="deleteFile('\${file.name}', '\${type}')">🗑️ Delete</button>
                    </div>
                \`;
                
                return fileDiv;
            }
            
            function deleteFile(filename, type) {
                if (confirm(\`Are you sure you want to delete \"\${filename}\"?\`)) {
                    fetch(\`/files/delete/\${type}/\${filename}\`, {
                        method: 'DELETE'
                    })
                    .then(response => response.json())
                    .then(result => {
                        if (result.status === 'success') {
                            alert('✅ ' + result.message);
                            loadMediaFiles();
                            updateBroadcastStatusFromServer();
                        } else {
                            alert('❌ ' + result.error);
                        }
                    })
                    .catch(error => {
                        alert('❌ Failed to delete file');
                    });
                }
            }
            
            window.onclick = function(event) {
                const modal = document.getElementById('videoModal');
                if (event.target == modal) {
                    closeVideoModal();
                }
            }
        </script>
    </body>
    </html>
    `);
});

// ==================== CLIENT DISPLAY (For Testing) ====================
app.get('/display', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Broadcast Display</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Arial', sans-serif;
                background: #1a1a1a;
                color: white;
                overflow: hidden;
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .display-container {
                text-align: center;
                padding: 40px;
                max-width: 90%;
                width: 100%;
            }
            .logo {
                font-size: 4em;
                margin-bottom: 20px;
            }
            .message {
                font-size: 2.5em;
                margin: 30px 0;
                padding: 20px;
                background: rgba(255,255,255,0.1);
                border-radius: 15px;
            }
            .status {
                font-size: 1.2em;
                opacity: 0.8;
                margin-top: 20px;
            }
            #videoElement {
                width: 100%;
                max-width: 800px;
                height: auto;
                margin: 20px 0;
                display: none;
            }
            .waiting {
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            .playlist-info {
                font-size: 1em;
                margin-top: 10px;
                color: #4caf50;
            }
        </style>
    </head>
    <body>
        <div class="display-container">
            <div class="logo" id="logo">📺</div>
            <div class="message" id="messageDisplay">Waiting for broadcast...</div>
            <video id="videoElement" controls autoplay loop muted>
                <source src="" type="video/mp4" id="videoSource">
                Your browser does not support the video tag.
            </video>
            <audio id="audioElement" autoplay style="display: none;">
                <source src="" type="audio/mpeg" id="audioSource">
            </audio>
            <div class="playlist-info" id="playlistInfo" style="display: none;"></div>
            <div class="status" id="statusDisplay">● Ready - Connected to Server</div>
        </div>

        <script>
            let ws = null;
            let currentMode = 'audio';
            
            function connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = \`\${protocol}//\${window.location.host}\`;
                
                ws = new WebSocket(wsUrl);
                
                ws.onopen = () => {
                    console.log('🔗 Display connected to server');
                    document.getElementById('statusDisplay').textContent = '● Connected - Waiting for broadcast';
                };
                
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    console.log('📨 Display received:', data.type);
                    handleBroadcastCommand(data);
                };
                
                ws.onclose = () => {
                    console.log('🔌 Display disconnected');
                    document.getElementById('statusDisplay').textContent = '● Connecting...';
                    setTimeout(connectWebSocket, 3000);
                };
            }
            
            function handleBroadcastCommand(data) {
                const broadcast = data.broadcast;
                
                if (data.type === 'play') {
                    startPlayback(broadcast);
                } else if (data.type === 'stop') {
                    stopPlayback();
                } else if (data.type === 'status') {
                    if (broadcast.isPlaying) {
                        startPlayback(broadcast);
                    } else {
                        stopPlayback();
                    }
                }
            }
            
            function startPlayback(broadcast) {
                console.log('🎬 Starting playback:', broadcast);
                
                document.getElementById('messageDisplay').textContent = broadcast.currentMessage;
                document.getElementById('statusDisplay').textContent = '● LIVE BROADCAST - Playing';
                
                if (broadcast.playlist && broadcast.playlist.length > 0 && broadcast.currentIndex >= 0) {
                    document.getElementById('playlistInfo').style.display = 'block';
                    document.getElementById('playlistInfo').textContent = 
                        \`Track \${broadcast.currentIndex + 1} of \${broadcast.playlist.length}\`;
                } else {
                    document.getElementById('playlistInfo').style.display = 'none';
                }
                
                if (broadcast.mode === 'audio' && broadcast.currentAudio) {
                    currentMode = 'audio';
                    const audioUrl = '/media/audio/' + broadcast.currentAudio;
                    document.getElementById('audioSource').src = audioUrl;
                    const audioElement = document.getElementById('audioElement');
                    audioElement.load();
                    document.getElementById('videoElement').style.display = 'none';
                    document.getElementById('audioElement').style.display = 'none';
                    audioElement.onended = () => {
                        console.log('🎵 Audio track ended');
                        fetch('/api/track-ended', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        }).catch(() => {});
                    };
                    audioElement.play().catch(e => {
                        console.log('Audio auto-play blocked, waiting for user interaction');
                        document.getElementById('statusDisplay').textContent = '● Click screen to start audio';
                    });
                    document.getElementById('logo').textContent = '🔊';
                    console.log('🔊 Playing audio:', broadcast.currentAudio);
                } else if (broadcast.mode === 'video' && broadcast.currentVideo) {
                    currentMode = 'video';
                    const videoUrl = '/stream-video/' + broadcast.currentVideo;
                    document.getElementById('videoSource').src = videoUrl;
                    const videoElement = document.getElementById('videoElement');
                    videoElement.load();
                    document.getElementById('videoElement').style.display = 'block';
                    document.getElementById('audioElement').style.display = 'none';
                    videoElement.play().catch(e => {
                        console.log('Video auto-play blocked, waiting for user interaction');
                        document.getElementById('statusDisplay').textContent = '● Click screen to start video';
                    });
                    document.getElementById('logo').textContent = '🎥';
                    console.log('🎥 Playing video:', broadcast.currentVideo);
                }
            }
            
            function stopPlayback() {
                if (currentMode === 'audio') {
                    const audioElement = document.getElementById('audioElement');
                    audioElement.pause();
                    audioElement.currentTime = 0;
                    audioElement.onended = null;
                } else {
                    const videoElement = document.getElementById('videoElement');
                    videoElement.pause();
                    videoElement.currentTime = 0;
                    videoElement.style.display = 'none';
                }
                
                document.getElementById('messageDisplay').textContent = 'Waiting for broadcast...';
                document.getElementById('statusDisplay').textContent = '● Ready - Waiting for broadcast';
                document.getElementById('logo').textContent = '📺';
                document.getElementById('playlistInfo').style.display = 'none';
                
                console.log('⏹️ Playback stopped');
            }
            
            document.addEventListener('DOMContentLoaded', function() {
                connectWebSocket();
                document.body.addEventListener('click', () => {
                    if (currentMode === 'audio') {
                        document.getElementById('audioElement').play().catch(() => {});
                    } else {
                        document.getElementById('videoElement').play().catch(() => {});
                    }
                });
            });
        </script>
    </body>
    </html>
    `);
});

// ==================== SERVER STARTUP ====================
initializeServer();

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🎛️  BROADCAST SERVER STARTED WITH PASSWORD PROTECTION!');
    console.log('='.repeat(60));
    console.log(`📡 Control Panel (Login Required): http://localhost:${PORT}/`);
    console.log(`🔐 Login Page: http://localhost:${PORT}/login`);
    console.log(`📺 Display Screen (Public): http://localhost:${PORT}/display`);
    console.log(`🌐 Network Access: http://YOUR_IP:${PORT}`);
    console.log(`📁 Media Folder: ${path.join(__dirname, 'media')}`);
    console.log('='.repeat(60));
    console.log('🎯 TESTING INSTRUCTIONS:');
    console.log('1. Open http://localhost:3000/login and enter password (default: admin123)');
    console.log('2. Access control panel at http://localhost:3000 after login');
    console.log('3. Upload audio/video files to media/ folder');
    console.log('4. Open http://localhost:3000/display in another tab/window');
    console.log('5. For continuous audio playback: Select multiple audio files (hold Ctrl/Cmd)');
    console.log('6. Use Control Panel to Start/Stop broadcast');
    console.log('7. Watch the Display screen react in real-time!');
    console.log('8. Logout via button in control panel');
    console.log('='.repeat(60));
    console.log('🔊 For audio testing: Add MP3 files to media/audio/ folder');
    console.log('🎥 For video testing: Add MP4 files to media/video/ folder');
    console.log('='.repeat(60) + '\n');
});