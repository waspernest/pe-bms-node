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
    console.log('Starting migration: Add job_position and work_schedule to users table...');
    
    // Check if columns already exist
    const jobPositionExists = await columnExists('users', 'job_position');
    const workScheduleExists = await columnExists('users', 'work_schedule');
    
    if (jobPositionExists && workScheduleExists) {
      console.log('Columns already exist, skipping migration...');
      process.exit(0);
      return;
    }

    // Add new columns one by one
    console.log('Adding new columns to users table...');
    
    const addColumn = (table, column, type) => {
      return new Promise((resolve, reject) => {
        const sql = `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;
        db.run(sql, [], function(err) {
          if (err) {
            console.error(`Error adding column ${column}:`, err);
            return reject(err);
          }
          console.log(`Successfully added column: ${column} ${type}`);
          resolve();
        });
      });
    };
    
    try {
      if (!jobPositionExists) {
        await addColumn('users', 'job_position', 'TEXT');
      }
      
      if (!workScheduleExists) {
        await addColumn('users', 'work_schedule', 'TIME');
      }
    } catch (error) {
      console.error('Migration failed while adding columns:', error);
      throw error;
    }
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Export the migration function
module.exports = {
  up: runMigration,
  down: async () => {
    // This is a destructive operation, so we'll just log a message
    console.log('To remove these columns, you need to create a new migration or do it manually');
  }
};

// Run the migration if this file is executed directly
if (require.main === module) {
  runMigration().catch(console.error);
}
