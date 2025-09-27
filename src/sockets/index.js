// src/sockets/index.js
const { Server } = require('socket.io');
const { startPolling } = require('../services/zkService');

let pollingStarted = false;
let pollingCleanup = null;

async function setupSocket(server) {
  const io = new Server(server, { 
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log('🟢 Client connected:', socket.id);

    socket.on('ping', (data) => {
      socket.emit('pong', { message: 'pong' });
    });

    socket.on('disconnect', () => {
      console.log('🔴 Client disconnected:', socket.id);
    });
    
    // Emit current polling status when a client connects
    socket.emit('polling-status', { 
      status: pollingStarted ? 'active' : 'inactive',
      timestamp: new Date().toISOString()
    });
  });

  // Start polling if not already started
  if (!pollingStarted) {
    try {
      console.log('🔄 Starting polling service...');
      pollingCleanup = await startPolling(io);
      pollingStarted = true;
      console.log('✅ Polling service started successfully');
      
      // Handle server shutdown
      const shutdown = async () => {
        console.log('🛑 Shutting down polling service...');
        if (pollingCleanup && typeof pollingCleanup === 'function') {
          await pollingCleanup();
        }
        process.exit(0);
      };

      // Handle different shutdown signals
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
      
    } catch (error) {
      console.error('❌ Failed to start polling service:', error);
      // Emit error to all connected clients
      io.emit('polling-error', {
        error: 'Failed to start polling service',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  return io;
}

module.exports = { setupSocket };
