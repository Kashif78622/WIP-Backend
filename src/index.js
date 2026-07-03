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

dotenv.config();

// Import routes
const authRoutes = require('./routes/auth.routes');
const batchRoutes = require('./routes/batch.routes');
const boardRoutes = require('./routes/board.routes');
const machineRoutes = require('./routes/machine.routes');
const productRoutes = require('./routes/product.routes');
const stageRoutes = require('./routes/stage.routes');
const reportRoutes = require('./routes/report.routes');

// Import middleware
const { errorHandler } = require('./middleware/error.middleware');

const app = express();
const httpServer = createServer(app);

// Socket.IO setup
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        credentials: true,
    },
});

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/batches', batchRoutes);
app.use('/api/v1/board', boardRoutes);
app.use('/api/v1/machines', machineRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/stages', stageRoutes);
app.use('/api/v1/reports', reportRoutes);

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    socket.on('join-area', (areaId) => {
        socket.join(`area:${areaId}`);
        console.log(`📢 Client ${socket.id} joined area:${areaId}`);
    });

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Socket.IO server ready`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { io };