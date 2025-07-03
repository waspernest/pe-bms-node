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
    const { 
        first_name, 
        last_name, 
        zk_id, 
        job_position,
        work_schedule_start,
        work_schedule_end,
        has_fingerprint
    } = req.body;
    
    try {
        // Get the existing user data first to get the password
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('User not found'));
                else resolve(row);
            });
        });

        // Check if zk_id is being updated
        if (zk_id && zk_id !== user.zk_id) {
            // Validate zk_id format (should be a 4-digit string)
            if (!/^\d{4}$/.test(zk_id)) {
                throw new Error('ZK ID must be a 4-digit number (e.g., 0001)');
            }
            
            // Check if new zk_id already exists in users table
            const checkStmt = await db.prepare('SELECT * FROM users WHERE zk_id = ? AND id != ?');
            const existingUser = await checkStmt.get(zk_id, id);
            await checkStmt.finalize();
            
            if (existingUser) {
                throw new Error(`ZK ID ${zk_id} is already in use`);
            }
            
            // Check if zk_id is in deleted_users
            const checkDeletedStmt = await db.prepare('SELECT * FROM deleted_users WHERE zk_id = ?');
            const deletedUser = await checkDeletedStmt.get(zk_id);
            await checkDeletedStmt.finalize();
            
            if (deletedUser) {
                throw new Error(`ZK ID ${zk_id} has been previously deleted and cannot be reused`);
            }
        }

        // Prepare update fields and values
        const updateFields = [];
        const updateValues = [];
        
        // Add basic fields
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        if (zk_id !== undefined) {
            updateFields.push('zk_id = ?');
            updateValues.push(zk_id);
        }
        
        // Add work schedule fields with validation
        if (work_schedule_start !== undefined) {
            if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(work_schedule_start)) {
                throw new Error('Invalid start time format. Use HH:MM (e.g., 09:00)');
            }
            updateFields.push('work_schedule_start = ?');
            updateValues.push(work_schedule_start);
        }
        
        if (work_schedule_end !== undefined) {
            if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(work_schedule_end)) {
                throw new Error('Invalid end time format. Use HH:MM (e.g., 18:00)');
            }
            updateFields.push('work_schedule_end = ?');
            updateValues.push(work_schedule_end);
        }
        
        // Add other fields
        if (job_position !== undefined) {
            updateFields.push('job_position = ?');
            updateValues.push(job_position || null);
        }
        
        if (has_fingerprint !== undefined) {
            updateFields.push('has_fingerprint = ?');
            updateValues.push(has_fingerprint ? 1 : 0);
        }
        
        // Add updated_at timestamp
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        
        if (updateFields.length === 0) {
            throw new Error('No fields to update');
        }
        
        // Add user ID to values for WHERE clause
        updateValues.push(id);
        
        // Build and execute the update query
        const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
        const stmt = db.prepare(updateQuery);
        const result = await stmt.run(...updateValues);
        await stmt.finalize();

        if (result.changes === 0) {
            throw new Error('Failed to update user in database');
        }

        // Update user in ZK device
        const uid = Number(zk_id);
        const paddedZkId = zk_id.padStart(4, '0');
        const fullName = `${first_name.trim()} ${last_name.trim()}`.substring(0, 24); // Max 24 chars
        const userPassword = user.password || '123456'; // Default password if not provided
        const userRole = 0; // Default role
        const cardno = 0;

        console.log('Attempting to update user in ZK device:', {
            uid,
            userid: paddedZkId,
            name: fullName,
            password: userPassword.substring(0, 8), // Max 8 chars
            role: userRole,
            cardno
        });
        
        try {
            const zkResult = await createOrUpdateUser({
                uid,
                userid: paddedZkId,
                name: fullName,
                password: userPassword.substring(0, 8), // Max 8 chars
                role: userRole,
                cardno
            });
            
            if (!zkResult || !zkResult.success) {
                throw new Error(zkResult?.error || 'Unknown error from ZK device');
            }
        } catch (zkError) {
            console.error('Error updating user in ZK device:', zkError);
            throw new Error(`Failed to update user in ZK device: ${zkError.message}`);
        }

        // Fetch the updated user to include all fields in the response
        const updatedUser = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        res.json({ 
            success: true, 
            message: 'User updated successfully in both database and ZK device',
            user: {
                id: updatedUser.id,
                first_name: updatedUser.first_name,
                last_name: updatedUser.last_name,
                zk_id: updatedUser.zk_id,
                job_position: updatedUser.job_position,
                work_schedule_start: updatedUser.work_schedule_start,
                work_schedule_end: updatedUser.work_schedule_end,
                has_fingerprint: Boolean(updatedUser.has_fingerprint),
                created_at: updatedUser.created_at,
                updated_at: updatedUser.updated_at
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

// Create a new user in the database
exports.createUser = async (req, res) => {
    const { 
        first_name, 
        last_name, 
        zk_id, 
        password, 
        job_position,
        work_schedule_start,
        work_schedule_end,
        has_fingerprint = false
    } = req.body;
    
    const role = 0; // Default role
    
    try {
        // Validate required fields
        if (!first_name || !last_name || !zk_id || !password) {
            throw new Error('First name, last name, ZK ID, and password are required');
        }
        
        // Validate ZK ID format
        if (!/^\d{1,4}$/.test(zk_id)) {
            throw new Error('ZK ID must be a 1-4 digit number (e.g., 1, 01, 001, or 0001)');
        }
        
        // Check if zk_id exists in deleted_users table
        const deletedUser = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM deleted_users WHERE zk_id = ?', [zk_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (deletedUser) {
            throw new Error(`ZK ID ${zk_id} has been previously deleted and cannot be reused`);
        }
        
        // Check if zk_id already exists in users table
        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE zk_id = ?', [zk_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingUser) {
            throw new Error(`ZK ID ${zk_id} is already in use`);
        }

        // Insert user into database
        const stmt = await db.prepare(
            `INSERT INTO users (
                first_name, 
                last_name, 
                zk_id, 
                password, 
                role,
                job_position,
                work_schedule_start,
                work_schedule_end,
                has_fingerprint
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        
        // Validate and set work schedule times
        const startTime = work_schedule_start || '09:00';
        const endTime = work_schedule_end || '18:00';
        
        // Validate time format (HH:MM)
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
            throw new Error('Invalid time format. Please use HH:MM format (e.g., 09:00)');
        }
        
        const result = await stmt.run(
            first_name.trim(), 
            last_name.trim(), 
            zk_id.padStart(4, '0'), // Ensure 4-digit format
            password, 
            role,
            job_position ? job_position.trim() : null,
            startTime,
            endTime,
            has_fingerprint ? 1 : 0
        );
        await stmt.finalize();

        const userId = Number(result.lastID);
        
        // Create user in ZK device
        const uid = Number(zk_id);
        const paddedZkId = zk_id.padStart(4, '0');
        const fullName = `${first_name.trim()} ${last_name.trim()}`.substring(0, 24); // Max 24 chars
        const userPassword = password.substring(0, 8); // Max 8 chars
        const userRole = 0; // Renamed from 'role' to avoid conflict
        const cardno = 0;

        console.log('Attempting to create user in ZK device:', {
            uid,
            userid: paddedZkId,
            name: fullName,
            password: userPassword,
            role: userRole,
            cardno
        });
        
        try {
            const zkResult = await createOrUpdateUser({
                uid,
                userid: paddedZkId,
                name: fullName,
                password: userPassword,
                role: userRole,
                cardno
            });
            console.log('ZK device response:', zkResult);
            
            if (!zkResult || !zkResult.success) {
                throw new Error(zkResult?.error || 'Unknown error from ZK device');
            }
        } catch (zkError) {
            console.error('Error creating user in ZK device:', zkError);
            // Rollback: delete from DB if ZK device creation fails
            await db.run('DELETE FROM users WHERE id = ?', [userId]);
            throw new Error(`Failed to create user in ZK device: ${zkError.message}`);
        }

        res.json({ 
            success: true, 
            message: 'User created successfully in both database and ZK device', 
            userId, 
            zk_id: zk_id.padStart(4, '0')
        });
    } catch (error) {
        console.error('Error creating user:', error.message);
        res.status(500).json({
            error: 'Failed to create user',
            details: error.message
        });
    }
};

// Delete a user by ID
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    
    try {

        // Get the existing user data first to get the password
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('User not found'));
                else resolve(row);
            });
        });

        // Do a fake delete in ZK device first so we can still access the user's data
        const zkReq = {
            body: {
                uid: Number(user.zk_id),
                userid: user.zk_id,
                name: 'Deleted User',
                password: 'deleted',
                role: 0,
                cardno: 0
            }
        };
        const zkResult = await createOrUpdateUser(zkReq, {});

        if (zkResult && zkResult.success) {
            // First, insert into deleted_users table
            const insertStmt = db.prepare('INSERT INTO deleted_users (user_id, zk_id, deleted_by) VALUES (?, ?, ?)');
            insertStmt.run(id, user.zk_id, req.user?.id || null);
            insertStmt.finalize();
            
            // Then delete from users table
            const stmt = db.prepare('DELETE FROM users WHERE id = ?');
            const result = stmt.run(id);
            stmt.finalize();

            if (result.changes === 0) {
                throw new Error('Failed to delete user');
            }

        } else {
            // 3. Rollback: delete from DB if ZK device creation fails
            await db.run('DELETE FROM users WHERE id = ?', [userId]);
            throw new Error('Failed to create user in ZK device');
        }

        res.json({ success: true, message: 'User deleted successfully' });

    } catch (error) {
        console.error('Error deleting user:', error.message);
        res.status(500).json({
            error: 'Failed to delete user',
            details: error.message
        });
    }
};
