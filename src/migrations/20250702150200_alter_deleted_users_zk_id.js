const db = require('../db').db();

async function columnExists(tableName, columnName) {
  return new Promise((resolve) => {
    db.get(
      `SELECT name FROM pragma_table_info('${tableName}') WHERE name = ?`,
      [columnName],
      (err, row) => {
        resolve(!!row);
      }
    );
  });
}

async function runMigration() {
  try {
    console.log('Starting migration: Update deleted_users.zk_id to TEXT...');
    
    // Check if the column exists and needs to be updated
    const isZkIdText = await columnExists('deleted_users', 'zk_id');
    if (!isZkIdText) {
      console.log('zk_id column does not exist in deleted_users table');
      process.exit(0);
      return;
    }

    // Create a temporary table with the new schema
    console.log('Creating temporary table...');
    await new Promise((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS deleted_users_temp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          zk_id TEXT NOT NULL UNIQUE,
          deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_by INTEGER
        )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Copy data from old table to temp table, converting zk_id to TEXT
    console.log('Copying data to temporary table...');
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO deleted_users_temp (id, user_id, zk_id, deleted_at, deleted_by)
         SELECT id, user_id, CAST(zk_id AS TEXT), deleted_at, deleted_by
         FROM deleted_users`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Drop the old table
    console.log('Dropping old table...');
    await new Promise((resolve, reject) => {
      db.run('DROP TABLE deleted_users', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Rename temp table to original name
    console.log('Renaming temporary table...');
    await new Promise((resolve, reject) => {
      db.run('ALTER TABLE deleted_users_temp RENAME TO deleted_users', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Recreate the index
    console.log('Recreating index...');
    await new Promise((resolve, reject) => {
      db.run('CREATE UNIQUE INDEX idx_deleted_users_zk_id ON deleted_users(zk_id)', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration();
