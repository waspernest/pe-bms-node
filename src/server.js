const http = require("http");
const app = require("./app");
const { setupSocket } = require("./sockets");

const server = http.createServer(app);
//setupSocket(server);

// At the top of your server file
const { db } = require('./db');
const PORT = process.env.PORT || 3001;
const database = db();

// This will establish the database connection
database.serialize(() => {
  // Start your server after DB connection is ready
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});