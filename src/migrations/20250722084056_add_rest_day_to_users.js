const { query } = require('../mysql');

/**
 * Migration to add rest_day column to users table
 */
async function runMigration() {
  try {
    console.log('Starting migration: add rest_day column to users table');
    
    // Check if rest_day column already exists
    const columns = await query(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'rest_day'`
    );

    if (Array.isArray(columns) && columns.length > 0) {
      console.log('rest_day column already exists in users table');
      return;
    }

    // Add rest_day column
    await query(`
      ALTER TABLE users 
      ADD COLUMN rest_day VARCHAR(20) NULL DEFAULT NULL 
      COMMENT 'Day of the week when user has rest day (e.g., "Sunday", "Monday", etc.)' 
      AFTER work_schedule_end;
    `);

    console.log('✅ Added rest_day column to users table');
    return true;
  } catch (error) {
    console.error('❌ Error adding rest_day column:', error);
    throw error;
  }
}

// Execute the migration if run directly
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = runMigration;
