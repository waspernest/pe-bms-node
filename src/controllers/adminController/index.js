const bcrypt = require('bcrypt');

exports.createTestAdmin = async (req, res) => {
    const db = require("../../db").db();
    const hashedPassword = bcrypt.hashSync("testpassword", 10); // 10 salt rounds
    db.run(
        "INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, ?)",
        ["Test Admin", "testadmin@example.com", hashedPassword, "admin"],
        function (err) {
            if (err) {
                console.error("Error inserting test admin:", err.message);
                return res.status(500).json({ error: "Failed to create test admin" });
            }
            console.log("Test admin created with ID:", this.lastID);
            res.json({ success: true, message: "Test admin created successfully" });
        }
    );
}

