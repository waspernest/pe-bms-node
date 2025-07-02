const db = require('../db').db();

async function tableExists(tableName) {
  return new Promise((resolve) => {
    db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName],
      (err, row) => {
        resolve(!!row);
      }
    );
  });
}

async function runMigration() {
  try {
    console.log('Starting migration: Create deleted_users table...');
    
    // Check if table already exists
    const exists = await tableExists('deleted_users');
    if (exists) {
      console.log('deleted_users table already exists, skipping...');
      process.exit(0);
      return;
    }

    // Create the deleted_users table
    console.log('Creating deleted_users table...');
    await new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS deleted_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          zk_id INTEGER NOT NULL UNIQUE,
          deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_by INTEGER
        )
      `;
      
      console.log(`Executing: ${sql}`);
      db.run(sql, (err) => {
        if (err) reject(err);
        else {
          console.log('Created deleted_users table');
          resolve();
        }
      });
    });

    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration().catch(console.error);
