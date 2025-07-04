const { query } = require('../../mysql');
const bcrypt = require('bcrypt');

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
    try {
        const hashedPassword = await bcrypt.hash("testpassword", 10); // 10 salt rounds
        const [result] = await query(
            "INSERT INTO admin (name, email, password, role) VALUES (?, ?, ?, ?)",
            ["Test Admin", "testadmin@example.com", hashedPassword, "super_admin"]
        );
        
        console.log("Test admin created with ID:", result.insertId);
        res.json({ 
            success: true, 
            message: "Test admin created successfully",
            adminId: result.insertId
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

