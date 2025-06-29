// SQLite DB setup for Node.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database file will be in the project root, named 'database.sqlite'
const dbPath = path.resolve(__dirname, '../database.sqlite');

// Singleton DB instance
let db;

function connect() {
  if (!db) {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Failed to connect to SQLite database:', err.message);
      } else {
        console.log('Connected to SQLite database at', dbPath);
      }
    });
  }
  return db;
}

// Example: Create a sample table if it does not exist
// You can modify this schema as needed
function init() {
  const dbInstance = connect();
  dbInstance.serialize(() => {
    dbInstance.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL
    )`, (err) => {
      if (err) {
        console.error('Failed to create users table:', err.message);
      } else {
        console.log('Users table ready');
      }
    });
    dbInstance.run(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    )`, (err) => {
      if (err) {
        console.error('Failed to create admins table:', err.message);
      } else {
        console.log('Admins table ready');
      }
    });
  });
}

module.exports = {
  db: () => connect(), // Always get the singleton instance
  dbPath,
  init,
};

// If run directly, initialize tables
if (require.main === module) {
  init();
}

