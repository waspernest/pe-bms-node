const http = require('http');
const express = require('express');
const cors = require('cors');
const { setupSocket } = require('./sockets');
const { connect, getPool } = require('./mysql');
const { getConfigPath } = require('./utils/setupConfig');
const importRoutes = require('./routes/importRoutes');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure CORS for development
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Import routes
app.use('/api/import', importRoutes);

// Import and use all routes
const routes = require('./routes');
app.use('/api', routes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.IO with error handling
async function initializeServer() {
    try {
        // Initialize MySQL connection pool
        await connect();
        
        // Test the connection
        const connection = await getPool().getConnection();
        console.log('✅ Successfully connected to MySQL database');
        connection.release();
        
        // Setup Socket.IO
        setupSocket(server);
        
        const PORT = process.env.PORT || 3001;
        
        // Start the server
        server.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
            console.log(`⚙️  Config Path: ${getConfigPath()}`);
            console.log(`📡 Socket.IO ready`);
        });
        
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            process.exit(1);
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
initializeServer();

// Export the server for testing
module.exports = { app, server };