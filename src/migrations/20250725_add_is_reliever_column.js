const { query } = require('../mysql');

/**
 * Migration to add is_reliever column to attendance table
 */
async function runMigration() {
  try {
    console.log('Starting migration: add is_reliever column to attendance table');
    
    // Check if is_reliever column already exists
    const columns = await query(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'attendance'
       AND COLUMN_NAME = 'is_reliever'`
    );

    if (Array.isArray(columns) && columns.length > 0) {
      console.log('is_reliever column already exists in attendance table');
      return;
    }

    // Add is_reliever column
    await query(`
      ALTER TABLE attendance 
      ADD COLUMN is_reliever TINYINT(1) NOT NULL DEFAULT 0 
      COMMENT 'Flag indicating if the user was a reliever for this attendance record' 
      AFTER time_out;
    `);

    console.log('✅ Added is_reliever column to attendance table');
    return true;
  } catch (error) {
    console.error('❌ Error adding is_reliever column:', error);
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