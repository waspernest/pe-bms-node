const mysql = require('mysql2/promise');
const { connect } = require('../mysql');

async function runMigration() {
    const pool = connect();
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        console.log('Changing attendance time columns to TIME type...');
        
        // Change time_in column to TIME
        await connection.query(`
            ALTER TABLE attendance 
            MODIFY COLUMN time_in TIME NULL DEFAULT NULL COMMENT 'Time when user checked in';
        `);
        
        // Change time_out column to TIME
        await connection.query(`
            ALTER TABLE attendance 
            MODIFY COLUMN time_out TIME NULL DEFAULT NULL COMMENT 'Time when user checked out';
        `);
        
        await connection.commit();
        console.log('✅ Changed attendance time columns to TIME type successfully');
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Error changing attendance time columns:', error);
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
