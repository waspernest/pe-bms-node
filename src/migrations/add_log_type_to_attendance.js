const mysql = require('mysql2/promise');
const { connect } = require('../mysql');

async function runMigration() {
    const pool = connect();
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        console.log('Adding log_type column to attendance table...');
        
        // Add log_type column
        await connection.query(`
            ALTER TABLE attendance 
            ADD COLUMN log_type INT NULL DEFAULT NULL 
            COMMENT 'Type of log (e.g., 0=check-in, 1=check-out, etc.)' 
            AFTER time_out;
        `);
        
        await connection.commit();
        console.log('✅ Added log_type column to attendance table successfully');
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Error adding log_type column:', error);
        throw error;
    } finally {
        connection.release();
        await pool.end();
    }
}

// Run the migration
runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
