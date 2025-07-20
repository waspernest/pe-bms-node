const { createPool } = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create a database connection pool
const pool = createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pe_bms',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/**
 * Migration to remove the foreign key constraint from the attendance table
 */
async function runMigration() {
  let connection;
  try {
    console.log('Starting migration: remove foreign key from attendance table');
    
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Get the constraint name
    const [constraints] = await connection.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'attendance' 
        AND REFERENCED_TABLE_NAME IS NOT NULL
        AND REFERENCED_COLUMN_NAME = 'zk_id'
    `, [process.env.DB_NAME || 'pe_bms']);

    if (constraints.length === 0) {
      console.log('No foreign key constraint found on zk_id in attendance table');
      await connection.rollback();
      return;
    }

    const constraintName = constraints[0].CONSTRAINT_NAME;
    console.log(`Found constraint: ${constraintName}`);

    // Remove the foreign key constraint
    await connection.query(`
      ALTER TABLE attendance 
      DROP FOREIGN KEY ${constraintName}
    `);

    await connection.commit();
    console.log('✅ Successfully removed foreign key constraint from attendance table');
  } catch (error) {
    console.error('Error in migration:', error);
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

/**
 * Rollback function to add the foreign key back
 */
async function rollback() {
  let connection;
  try {
    console.log('Rolling back: adding foreign key to attendance table');
    
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Add the foreign key constraint back
    await connection.query(`
      ALTER TABLE attendance 
      ADD CONSTRAINT fk_attendance_users_zk_id
      FOREIGN KEY (zk_id) REFERENCES users(zk_id)
      ON DELETE CASCADE
      ON UPDATE CASCADE
    `);

    await connection.commit();
    console.log('✅ Successfully added foreign key constraint back to attendance table');
  } catch (error) {
    console.error('Error in rollback:', error);
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

// Export the migration functions
module.exports = {
  up: runMigration,
  down: rollback
};

// Run the migration directly if this file is executed directly
if (require.main === module) {
  runMigration()
    .then(() => console.log('Migration completed successfully'))
    .catch(console.error);
}
