const { getPool } = require('../../mysql');
const bcrypt = require('bcrypt');

// Helper function to execute queries
const query = async (sql, params = []) => {
    const connection = await getPool().getConnection();
    try {
        const [results] = await connection.query(sql, params);
        return results;
    } finally {
        connection.release();
    }
};

exports.testMYSQLConnection = async (req, res) => {
    try {
        const mysql = require("../../mysql");
        const { results } = await mysql.query("SELECT 1");
        res.json({ success: true, result: results[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

exports.createTestAdmin = async (req, res) => {
    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();
        
        // Check if admin table exists, create if not
        await connection.query(`
            CREATE TABLE IF NOT EXISTS admin (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'admin',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        
        // Check if test admin already exists
        const [existing] = await connection.query('SELECT * FROM admin WHERE email = ?', ['test@admin.com']);
        
        if (existing && existing.length > 0) {
            await connection.query('DELETE FROM admin WHERE email = ?', ['test@admin.com']);
            console.log('Existing test admin removed');
        }
        
        // Create new test admin
        const hashedPassword = await bcrypt.hash("admin123", 10);
        await connection.query(
            "INSERT INTO admin (name, email, password, role) VALUES (?, ?, ?, ?)",
            ["Test Admin", "test@admin.com", hashedPassword, "super_admin"]
        );
        
        // Get the inserted admin
        const [rows] = await connection.query('SELECT * FROM admin WHERE email = ?', ['test@admin.com']);
        const admin = rows[0];
        
        if (!admin) {
            throw new Error('Failed to retrieve created admin');
        }
        
        await connection.commit();
        
        console.log("Test admin created with ID:", admin.id);
        res.json({ 
            success: true, 
            message: "Test admin created successfully",
            credentials: {
                email: "test@admin.com",
                password: "admin123"
            },
            admin: {
                id: admin.id,
                email: admin.email,
                role: admin.role
            }
        });
    } catch (err) {
        console.error("Error inserting test admin:", err);
        res.status(500).json({ 
            success: false,
            error: "Failed to create test admin",
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// exports.deleteRecords = async (req, res) => {
//     const { table, ids } = req.body;
//     if (!table || !ids) {
//         return res.status(400).json({ error: 'Table and ids are required.' });
//     }
//     try {
//         const deletedCount = await deleteRecordsById(table, ids);
//         res.json({ success: true, deleted: deletedCount });
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// };

