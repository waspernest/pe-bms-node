const http = require('http');
const express = require('express');
const cors = require('cors');
const { setupSocket } = require('./sockets');
const { connect, getPool } = require('./mysql');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure CORS for development
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Import and use all routes
const routes = require('./routes');
app.use('/api', routes);

// Socket Connection - Polling every 10 seconds
const server = http.createServer(app);
//setupSocket(server);

const PORT = process.env.PORT || 3001;

// Initialize MySQL connection pool
const pool = connect();

// Test MySQL connection and start server
async function startServer() {
  try {
    // Initialize the database connection
    await connect();
    
    // Test the connection
    const connection = await getPool().getConnection();
    console.log('Successfully connected to MySQL database');
    connection.release();
    
    // Start the server
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`API Base URL: http://localhost:${PORT}/api`);
    });
    
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

// Start the server
startServer();