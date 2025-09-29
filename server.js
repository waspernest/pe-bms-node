// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes
const routes = require('./src/routes'); // adjust if your routes folder is elsewhere
const importRoutes = require('./src/routes/importRoutes');

// MySQL connector
const { connect, getPool } = require('./src/mysql');
const { setupSocket } = require('./src/sockets');
const { getConfigPath } = require('./src/utils/setupConfig');

// Create app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/import', importRoutes);
app.use('/api', routes);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ---------------------------------------------------
// Namecheap Node.js Manager passes PORT via env
// ---------------------------------------------------
const PORT = process.env.PORT || 3000;

// Start server only after DB connects
(async () => {
  try {
    await connect();
    const conn = await getPool().getConnection();
    console.log('✅ Connected to MySQL');
    conn.release();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
      console.log(`⚙️ Config Path: ${getConfigPath()}`);
    });

    // Setup socket.io
    setupSocket(server);

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
})();
