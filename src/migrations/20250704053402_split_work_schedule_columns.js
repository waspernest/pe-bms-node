const db = require('../db').db();

async function columnExists(tableName, columnName) {
  return new Promise((resolve) => {
    db.all(
      `PRAGMA table_info(${tableName})`,
      [],
      (err, columns) => {
        if (err) {
          console.error('Error checking column:', err);
          return resolve(false);
        }
        const columnExists = columns.some(col => col.name === columnName);
        resolve(columnExists);
      }
    );
  });
}

async function runMigration() {
  try {
    console.log('Starting migration: Splitting work_schedule into start/end columns...');
    
    // Check if the old column exists and new columns don't exist
    const hasWorkSchedule = await columnExists('users', 'work_schedule');
    const hasStartTime = await columnExists('users', 'work_schedule_start');
    const hasEndTime = await columnExists('users', 'work_schedule_end');
    
    if (!hasWorkSchedule || hasStartTime || hasEndTime) {
      console.log('Migration not needed or already applied');
      process.exit(0);
      return;
    }

    // Begin transaction
    await new Promise((resolve, reject) => {
      db.run('BEGIN TRANSACTION', [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      // Add new columns
      console.log('Adding new work schedule columns...');
      await new Promise((resolve, reject) => {
        db.run(
          'ALTER TABLE users ADD COLUMN work_schedule_start TEXT',
          [],
          (err) => err ? reject(err) : resolve()
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          'ALTER TABLE users ADD COLUMN work_schedule_end TEXT',
          [],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Set default values (9 AM to 6 PM)
      console.log('Setting default work schedule (09:00-18:00)...');
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users SET 
            work_schedule_start = '09:00',
            work_schedule_end = '18:00'`,
          [],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Drop the old column (SQLite doesn't support DROP COLUMN in older versions)
      console.log('Creating new table without old work_schedule column...');
      
      // Create a new table with the updated schema
      await new Promise((resolve, reject) => {
        db.run(
          `CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            zk_id TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role INTEGER DEFAULT 0,
            job_position TEXT,
            work_schedule_start TEXT,
            work_schedule_end TEXT,
            has_fingerprint INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`,
          [],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Copy data to new table
      console.log('Migrating data to new table...');
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO users_new (
            id, first_name, last_name, zk_id, password, role, 
            job_position, work_schedule_start, work_schedule_end, has_fingerprint,
            created_at, updated_at
          )
          SELECT 
            id, first_name, last_name, zk_id, password, role, 
            job_position, work_schedule_start, work_schedule_end, has_fingerprint,
            created_at, updated_at
          FROM users`,
          [],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Drop old table and rename new one
      console.log('Replacing tables...');
      await new Promise((resolve, reject) => {
        db.run('DROP TABLE users', [], (err) => err ? reject(err) : resolve());
      });

      await new Promise((resolve, reject) => {
        db.run('ALTER TABLE users_new RENAME TO users', [], (err) => 
          err ? reject(err) : resolve()
        );
      });

      // Commit transaction
      await new Promise((resolve, reject) => {
        db.run('COMMIT', [], (err) => {
          if (err) reject(err);
          else {
            console.log('Migration completed successfully!');
            resolve();
          }
        });
      });

    } catch (error) {
      // Rollback on error
      await new Promise(resolve => db.run('ROLLBACK', [], () => resolve()));
      throw error;
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Export the migration function
module.exports = {
  up: runMigration,
  down: async () => {
    console.log('This migration cannot be automatically rolled back');
  }
};

// Run the migration if this file is executed directly
if (require.main === module) {
  runMigration().catch(console.error);
}
