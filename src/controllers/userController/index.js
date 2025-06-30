const db = require('../../db').db();
const { createOrUpdateUser } = require('../zkController');

exports.getAllUsers = (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    db.all('SELECT * FROM users LIMIT ? OFFSET ?', [limit, offset], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get('SELECT COUNT(*) as count FROM users', [], (err2, countResult) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({
                users: rows,
                total: countResult.count,
                page,
                limit
            });
        });
    });
};

// Get a single user by ID
exports.getUserById = (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'User not found' });
        res.json(row);
    });
};

// Update a user by ID and sync with ZK device
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, zk_id } = req.body;
    
    try {
        // Get the existing user data first to get the password
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('User not found'));
                else resolve(row);
            });
        });

        // Update user in database
        const stmt = db.prepare('UPDATE users SET first_name = ?, last_name = ?, zk_id = ? WHERE id = ?');
        const result = await stmt.run(first_name, last_name, zk_id, id);
        await stmt.finalize();

        if (result.changes === 0) {
            throw new Error('Failed to update user in database');
        }

        // Update user in ZK device
        const zkReq = {
            body: {
                uid: Number(zk_id),
                userid: zk_id,
                name: `${first_name} ${last_name}`,
                password: user.password, // Use existing password
                role: 0,
                cardno: 0
            }
        };

        const zkResult = await createOrUpdateUser(zkReq, {});
        
        if (!zkResult || !zkResult.success) {
            const errorMsg = `Failed to update user in ZK device: ${zkResult?.error || 'Unknown error'}`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }

        res.json({ 
            success: true, 
            message: 'User updated successfully in both database and ZK device',
            user: {
                id: id,
                first_name,
                last_name,
                zk_id
            }
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to update user'
        });
    }
};

// Create a new user in DB and ZK Device
exports.createUser = async (req, res) => {
    const { first_name, last_name, zk_id, password, role } = req.body;
    if (!first_name || !last_name || !zk_id || !password || !role) {
        return res.status(400).json({ error: 'First Name, Last Name, ZK ID, Password, and Role are required.' });
    }

    try {
        // 1. Insert user into database
        const stmt = await db.prepare(
            "INSERT INTO users (first_name, last_name, zk_id, password, role) VALUES (?, ?, ?, ?, ?)"
        );
        const result = await stmt.run(first_name, last_name, zk_id, password, role);
        await stmt.finalize();

        if (result.changes === 0) {
            throw new Error('Failed to insert user into database');
        }

        const userId = Number(result.lastID);
        const name = `${first_name} ${last_name}`;

        // 2. Try to create user in ZK device
        const zkReq = {
            body: {
                uid: userId, // or userId if you want to use DB id
                userid: zk_id,
                name,
                password,
                role: 0,
                cardno: 0
            }
        };
        const zkResult = await createOrUpdateUser(zkReq, {});

        if (zkResult && zkResult.success) {
            res.json({ success: true, message: 'User created in DB and ZK device', userId, zk_id });
        } else {
            // 3. Rollback: delete from DB if ZK device creation fails
            await db.run('DELETE FROM users WHERE id = ?', [userId]);
            throw new Error('Failed to create user in ZK device');
        }
    } catch (error) {
        console.error('Error creating user:', error.message);
        res.status(500).json({
            error: 'Failed to create user',
            details: error.message
        });
    }
};