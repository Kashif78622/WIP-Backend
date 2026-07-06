// src/index.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');
const os = require('os');

dotenv.config();

// Import routes
const authRoutes = require('./routes/auth.routes');
const batchRoutes = require('./routes/batch.routes');
const boardRoutes = require('./routes/board.routes');
const machineRoutes = require('./routes/machine.routes');
const productRoutes = require('./routes/product.routes');
const stageRoutes = require('./routes/stage.routes');
const reportRoutes = require('./routes/report.routes');
const settingsRoutes = require('./routes/settings.routes');

// Import middleware
const { errorHandler } = require('./middleware/error.middleware');

const app = express();
const httpServer = createServer(app);

// Get local IP address
const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
};

const LOCAL_IP = getLocalIP();
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const WS_URL = process.env.WS_URL || `http://${LOCAL_IP}:${process.env.PORT || 5000}`;

console.log(`📡 Local IP Address: ${LOCAL_IP}`);

// Socket.IO setup
const io = new Server(httpServer, {
    cors: {
        origin: [
            CLIENT_URL,
            `http://${LOCAL_IP}:5173`,
            `http://${LOCAL_IP}:${process.env.PORT || 5000}`,
            /^http:\/\/192\.168\.\d+\.\d+:\d+$/, // Allow any local network IP
            /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/, // Allow any local network IP (Class A)
            /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/, // Allow any local network IP (Class B)
        ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
});

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
}));

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, etc.)
        if (!origin) return callback(null, true);

        // Check if origin is allowed
        const allowedOrigins = [
            CLIENT_URL,
            `http://${LOCAL_IP}:5173`,
            `http://localhost:5173`,
            /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
            /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
            /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/,
        ];

        const isAllowed = allowedOrigins.some(allowed => {
            if (allowed instanceof RegExp) {
                return allowed.test(origin);
            }
            return allowed === origin;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked for origin: ${origin}`);
            callback(null, true); // Still allow for development
        }
    },
    credentials: true,
    exposedHeaders: ['Authorization'],
}));

app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        server: {
            ip: LOCAL_IP,
            port: process.env.PORT || 5000,
            url: WS_URL
        }
    });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/batches', batchRoutes);
app.use('/api/v1/board', boardRoutes);
app.use('/api/v1/machines', machineRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/stages', stageRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/settings', settingsRoutes);

// Debug route to check server info
app.get('/api/v1/server-info', (req, res) => {
    res.json({
        ip: LOCAL_IP,
        port: process.env.PORT || 5000,
        clientUrl: CLIENT_URL,
        wsUrl: WS_URL,
        environment: process.env.NODE_ENV || 'development',
        connections: {
            websocket: `ws://${LOCAL_IP}:${process.env.PORT || 5000}`,
            http: `http://${LOCAL_IP}:${process.env.PORT || 5000}`
        }
    });
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id} from ${socket.handshake.address}`);

    // Send connection confirmation with server info
    socket.emit('server-info', {
        ip: LOCAL_IP,
        port: process.env.PORT || 5000,
        timestamp: new Date().toISOString()
    });

    socket.on('join-area', (areaId) => {
        socket.join(`area:${areaId}`);
        console.log(`📢 Client ${socket.id} joined area:${areaId}`);
        // Acknowledge the join
        socket.emit('area-joined', { areaId, timestamp: new Date().toISOString() });
    });

    socket.on('leave-area', (areaId) => {
        socket.leave(`area:${areaId}`);
        console.log(`📢 Client ${socket.id} left area:${areaId}`);
    });

    socket.on('error', (error) => {
        console.error(`Socket error from ${socket.id}:`, error);
    });

    socket.on('disconnect', (reason) => {
        console.log(`🔌 Client disconnected: ${socket.id}, reason: ${reason}`);
    });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log(`🚀 Server is running!`);
    console.log(`📍 Local:    http://localhost:${PORT}`);
    console.log(`📍 Network:  http://${LOCAL_IP}:${PORT}`);
    console.log(`📡 WebSocket: ws://${LOCAL_IP}:${PORT}`);
    console.log(`📡 WebSocket (local): ws://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(60));
    console.log('\n📌 For Flutter app development, use:');
    console.log(`   http://${LOCAL_IP}:${PORT}`);
    console.log(`   WebSocket: ws://${LOCAL_IP}:${PORT}`);
    console.log('\n📌 For other developers on same WiFi:');
    console.log(`   Base URL: http://${LOCAL_IP}:${PORT}`);
    console.log(`   API URL: http://${LOCAL_IP}:${PORT}/api/v1`);
    console.log(`   WebSocket URL: ws://${LOCAL_IP}:${PORT}`);
    console.log('='.repeat(60));
});

module.exports = { io };