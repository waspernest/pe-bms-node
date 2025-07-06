const { getPool } = require('../../mysql');
const bcrypt = require('bcrypt');

exports.login = async (req, res) => {
    const email = req.body.email || req.query.email || req.params.email;
    const password = req.body.password || req.query.password || req.params.password;
    let connection;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        connection = await getPool().getConnection();
        const [rows] = await connection.query('SELECT * FROM admin WHERE email = ?', [email]);
        
        if (!rows?.length) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const admin = rows[0];
        const isMatch = await bcrypt.compare(password, admin.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Return only necessary user data
        const userData = {
            id: admin.id,
            email: admin.email,
            role: admin.role || 'admin',
            name: admin.name || ''
        };

        res.json({ 
            success: true, 
            message: 'Login successful',
            user: userData
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Login failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) await connection.release();
    }
};

exports.logout = (req, res) => {
    try {
        // In a token-based auth system, logout is handled client-side by removing the token
        // This endpoint is kept for consistency
        res.json({ 
            success: true, 
            message: 'Logout successful' 
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ 
            error: 'Logout failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getCurrentUser = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const connection = await getPool().getConnection();
        try {
            const [rows] = await connection.query('SELECT id, name, email, role, created_at FROM admin WHERE id = ?', [req.user.id]);
            
            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            res.json({ 
                success: true, 
                user: rows[0] 
            });
        } finally {
            if (connection) connection.release();
        }
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ 
            error: 'Failed to get current user',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
