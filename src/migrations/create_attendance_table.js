const mysql = require('mysql2/promise');
const { connect } = require('../mysql');

async function runMigration() {
    const pool = connect();
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        console.log('Creating attendance table...');
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INT AUTO_INCREMENT PRIMARY KEY,
                zk_id VARCHAR(4) NOT NULL,
                log_date DATE NOT NULL,
                time_in DATETIME NULL,
                time_out DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        
        await connection.commit();
        console.log('✅ Created attendance table successfully');
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Error creating attendance table:', error);
        throw error;
    } finally {
        connection.release();
        // Close the pool if you want to exit the script
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
