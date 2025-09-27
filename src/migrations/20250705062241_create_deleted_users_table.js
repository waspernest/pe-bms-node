const { query } = require('../mysql');

/**
 * Migration to create the deleted_users table
 */
async function runMigration() {
  try {
    console.log('Starting migration: create deleted_users table');
    
    // Check if deleted_users table already exists
    const rows = await query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'deleted_users'`
    );

    if (Array.isArray(rows) && rows.length > 0) {
      console.log('deleted_users table already exists, skipping creation');
      return;
    }

    // Create deleted_users table
    await query(`
      CREATE TABLE deleted_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        zk_id VARCHAR(255) NOT NULL,
        deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_by INT,
        UNIQUE KEY uk_zk_id (zk_id),
        KEY idx_user_id (user_id),
        KEY idx_deleted_at (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('deleted_users table created successfully');
    console.log('Migration completed successfully');
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Export the migration function for the migration runner
module.exports = {
  up: runMigration,
  // Add down migration if needed for rollback
  down: async () => {
    await query('DROP TABLE IF EXISTS deleted_users');
    console.log('Dropped deleted_users table');
  }
};

// Run the migration directly if this file is executed directly
if (require.main === module) {
  runMigration().catch(console.error);
}
