const db = require('../../db').db();
const bcrypt = require('bcrypt');

exports.login = (req, res) => {
    // Accept email and password from body, query, or params
    const email = req.body.email || req.query.email || req.params.email;
    const password = req.body.password || req.query.password || req.params.password;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    db.get('SELECT * FROM admins WHERE email = ?', [email], (err, row) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!row) {
            return res.status(401).json({ error: 'Admin account not found' });
        }
        // Compare password using bcrypt
        bcrypt.compare(password, row.password, (err, result) => {
            if (err) {
                console.error('Bcrypt error:', err.message);
                return res.status(500).json({ error: 'Password comparison failed' });
            }
            if (!result) {
                return res.status(401).json({ error: 'Invalid password' });
            }
            // Success: password matches
            res.json({ 
                success: true, 
                message: 'Login successful',
                user_type: row.role,
                user: { 
                    id: row.id, 
                    name: row.name, 
                    email: row.email, 
                    role: row.role 
                } 
            });
        });
    });
};