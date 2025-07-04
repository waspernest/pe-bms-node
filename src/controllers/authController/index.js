const { query } = require('../../mysql');
const bcrypt = require('bcrypt');

exports.login = async (req, res) => {
    try {
        // Accept email and password from body, query, or params
        const email = req.body.email || req.query.email || req.params.email;
        const password = req.body.password || req.query.password || req.params.password;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Query the database for the admin user
        const [rows] = await query('SELECT * FROM admins WHERE email = ?', [email]);
        
        if (!rows || rows.length === 0) {
            return res.status(401).json({ error: 'Admin account not found' });
        }
        
        const admin = rows[0];
        
        // Compare password using bcrypt
        const isMatch = await bcrypt.compare(password, admin.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid password' });
        }
            // Success: password matches
            res.json({ 
                success: true, 
                message: 'Admin login successful',
                user_type: admin.role || 'admin',
                user: { 
                    id: admin.id, 
                    name: admin.name,
                    email: admin.email, 
                    role: admin.role || 'admin'
                } 
            });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'An error occurred during login',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};