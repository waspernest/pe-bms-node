const http = require("http");
const app = require("./app");
const { setupSocket } = require("./sockets");
const { connect, getPool } = require('./mysql');

const server = http.createServer(app);
// setupSocket(server);

const PORT = process.env.PORT || 3001;

// Initialize MySQL connection pool
const pool = connect();

// Test MySQL connection on startup
getPool().getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    process.exit(1);
  }
  
  console.log('Successfully connected to MySQL database');
  connection.release();
  
  // Start the server
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});