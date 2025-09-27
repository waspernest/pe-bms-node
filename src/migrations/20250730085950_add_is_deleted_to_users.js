const { query } = require('../mysql');

/**
 * Migration to add is_deleted column to users table
 */
async function runMigration() {
  try {
    console.log('Starting migration: add is_deleted column to users table');
    
    // Check if is_deleted column already exists
    const checkResult = await query(
      `SELECT COUNT(*) as count 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'is_deleted'`
    );

    const columnExists = checkResult.results[0].count > 0;

    if (columnExists) {
      console.log('is_deleted column already exists in users table');
      return;
    }

    // Add is_deleted column
    await query(`
      ALTER TABLE users 
      ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 
      COMMENT 'Flag indicating if the user is deleted (1) or active (0)'
      AFTER updated_at;
    `);

    console.log('✅ Added is_deleted column to users table');

    // Update existing records to set is_deleted based on deleted_users table
    const deletedUsersResult = await query(
      `SELECT user_id FROM deleted_users`
    );

    if (deletedUsersResult.results && deletedUsersResult.results.length > 0) {
      const userIds = deletedUsersResult.results.map(u => u.user_id).join(',');
      await query(
        `UPDATE users SET is_deleted = 1 WHERE id IN (${userIds})`
      );
      console.log(`✅ Updated is_deleted flag for ${deletedUsersResult.results.length} previously deleted users`);
    }

    return true;
  } catch (error) {
    console.error('❌ Error adding is_deleted column to users table:', error);
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
