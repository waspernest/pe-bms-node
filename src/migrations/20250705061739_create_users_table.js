const { query } = require('../mysql');

/**
 * Migration to create the users table
 */
async function runMigration() {
  try {
    console.log('Starting migration: create users table');
    
    // Check if users table already exists
    const rows = await query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'users'`
    );

    if (Array.isArray(rows) && rows.length > 0) {
      console.log('Users table already exists, skipping creation');
      return;
    }

    // Create users table
    await query(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        zk_id VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role INT DEFAULT 0,
        job_position VARCHAR(255),
        work_schedule_start VARCHAR(50),
        work_schedule_end VARCHAR(50),
        has_fingerprint TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('Users table created successfully');
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
    await query('DROP TABLE IF EXISTS users');
    console.log('Dropped users table');
  }
};

// Run the migration directly if this file is executed directly
if (require.main === module) {
  runMigration().catch(console.error);
}
