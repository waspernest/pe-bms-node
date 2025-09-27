const { query } = require('../../mysql');

/**
 * Migration to create the admins table
 */
async function runMigration() {
  try {
    console.log('Starting migration: create admins table');
    
    // Check if admins table already exists
    const rows = await query(
      `SELECT TABLE_NAME 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'admins'`
    );

    if (Array.isArray(rows) && rows.length > 0) {
      console.log('admins table already exists, skipping creation');
      return;
    }

    // Create admins table
    await query(`
      CREATE TABLE admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('Admins table created successfully');
    
    // Create default admin user (password: admin123)
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await query(
      'INSERT INTO admins (name, email, password) VALUES (?, ?, ?)',
      ['Admin', 'admin@example.com', hashedPassword]
    );
    
    console.log('Default admin user created');
    console.log('Email: admin@example.com');
    console.log('Password: admin123');
    console.log('Please change this password after first login!');
    
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
    await query('DROP TABLE IF EXISTS admins');
    console.log('Dropped admins table');
  }
};

// Run the migration directly if this file is executed directly
if (require.main === module) {
  const bcrypt = require('bcrypt');
  runMigration().catch(console.error);
}
