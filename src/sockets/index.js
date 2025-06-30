// src/sockets/index.js
const { Server } = require('socket.io');
const { startPolling } = require('../services/zkService'); // Adjust path as needed

function setupSocket(server) {
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
      console.log('Received ping:', data);
      socket.emit('pong', { message: 'pong', received: data });
    });

    socket.on('disconnect', () => {
      console.log('🔴 Client disconnected:', socket.id);
    });
  });

  startPolling(io);

  return io;
}

module.exports = { setupSocket };
