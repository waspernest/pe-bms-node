const { getPool } = require('../../mysql');
const { createOrUpdateUser } = require('../zkController');

// Helper function to get a connection and run a query
const query = async (sql, params = []) => {
    const connection = await getPool().getConnection();
    try {
        const [results] = await connection.query(sql, params);
        return results;
    } finally {
        connection.release();
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const offset = (page - 1) * limit;

        // Get total count first
        const countResult = await query('SELECT COUNT(*) as count FROM users');
        const total = countResult[0]?.count || 0;
        
        // Only fetch users if there are any
        let users = [];
        if (total > 0) {
            users = await query(
                'SELECT * FROM users ORDER BY id DESC LIMIT ? OFFSET ?', 
                [limit, offset]
            );
        }

        res.json({
            success: true,
            users,
            total: Number(total),
            page,
            limit
        });
        
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch users',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get a single user by ID
exports.getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const [[user]] = await query(
            'SELECT * FROM users WHERE id = ?', 
            [id]
        );
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(user);
    } catch (error) {
        console.error('Error getting user:', error);
        res.status(500).json({ 
            error: 'Failed to fetch user',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
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
        const users = await query('SELECT * FROM users WHERE id = ?', [id]);
        
        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const user = users[0];

        // Check if zk_id is being updated
        if (zk_id && zk_id !== user.zk_id) {
            // Validate zk_id format (should be a 4-digit string)
            if (!/^\d{1,4}$/.test(zk_id)) {
                throw new Error('ZK ID must be a 1-4 digit number (e.g., 1, 01, 001, or 0001)');
            }
            
            // Check if new zk_id is already in use
            const existingUsers = await query(
                'SELECT * FROM users WHERE zk_id = ? AND id != ?', 
                [zk_id, id]
            );
            
            if (existingUsers.length > 0) {
                throw new Error(`ZK ID ${zk_id} is already in use by another user`);
            }
            
            // Check if zk_id is in deleted_users
            const deletedUsers = await query(
                'SELECT * FROM deleted_users WHERE zk_id = ?', 
                [zk_id]
            );
            
            if (deletedUsers.length > 0) {
                throw new Error(`ZK ID ${zk_id} has been previously deleted and cannot be reused`);
            }
        }
        
        // Build the update query dynamically based on provided fields
        const updateFields = [];
        const updateValues = [];
        
        if (first_name) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name.trim());
        }
        
        if (last_name) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name.trim());
        }
        
        if (zk_id) {
            updateFields.push('zk_id = ?');
            updateValues.push(zk_id.padStart(4, '0'));
        }
        
        if (job_position !== undefined) {
            updateFields.push('job_position = ?');
            updateValues.push(job_position ? job_position.trim() : null);
        }
        
        if (work_schedule_start) {
            updateFields.push('work_schedule_start = ?');
            updateValues.push(work_schedule_start);
        }
        
        if (work_schedule_end) {
            updateFields.push('work_schedule_end = ?');
            updateValues.push(work_schedule_end);
        }
        
        if (has_fingerprint !== undefined) {
            updateFields.push('has_fingerprint = ?');
            updateValues.push(has_fingerprint ? 1 : 0);
        }
        
        // If no fields to update, return the existing user
        if (updateFields.length === 0) {
            return res.json({
                success: true,
                message: 'No fields to update',
                user
            });
        }
        
        // Add updated_at timestamp
        updateFields.push('updated_at = NOW()');
        
        // Add id to the values array for the WHERE clause
        updateValues.push(id);
        
        // Build and execute the update query
        const updateQuery = `
            UPDATE users 
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `;
        
        await query(updateQuery, updateValues);
        
        // Fetch the updated user
        const updatedUser = await query('SELECT * FROM users WHERE id = ?', [id]);
        
        if (!updatedUser || updatedUser.length === 0) {
            throw new Error('Failed to fetch updated user');
        }
        
        const updatedUserData = updatedUser[0];
        
        // Update user in ZK device if zk_id or name changed
        if ((zk_id && zk_id !== user.zk_id) || 
            (first_name && first_name !== user.first_name) || 
            (last_name && last_name !== user.last_name)) {
            
            const uid = Number(updatedUserData.zk_id);
            const paddedZkId = updatedUserData.zk_id.padStart(4, '0');
            const fullName = `${updatedUserData.first_name} ${updatedUserData.last_name}`.substring(0, 24);
            
            console.log('Attempting to update user in ZK device:', {
                uid,
                userid: paddedZkId,
                name: fullName,
                role: updatedUserData.role || 0,
                cardno: 0
            });
            
            const zkResult = await createOrUpdateUser({
                uid,
                userid: paddedZkId,
                name: fullName,
                password: user.password, // Use existing password
                role: updatedUserData.role || 0,
                cardno: 0
            });
            
            if (!zkResult || !zkResult.success) {
                console.error('ZK device update failed:', zkResult);
                throw new Error(zkResult?.error || 'Failed to update user in ZK device');
            }
        }
        
        res.json({
            success: true,
            message: 'User updated successfully',
            user: {
                id: updatedUserData.id,
                first_name: updatedUserData.first_name,
                last_name: updatedUserData.last_name,
                zk_id: updatedUserData.zk_id,
                job_position: updatedUserData.job_position,
                work_schedule_start: updatedUserData.work_schedule_start,
                work_schedule_end: updatedUserData.work_schedule_end,
                has_fingerprint: Boolean(updatedUserData.has_fingerprint),
                created_at: updatedUserData.created_at,
                updated_at: updatedUserData.updated_at
            }
        });
        
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update user',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
        work_schedule_start = '09:00',
        work_schedule_end = '18:00',
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
        
        // Validate time format (HH:MM)
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(work_schedule_start) || !timeRegex.test(work_schedule_end)) {
            throw new Error('Invalid time format. Please use HH:MM format (e.g., 09:00)');
        }
        
        // Check if zk_id exists in deleted_users table
        const deletedUsers = await query(
            'SELECT * FROM deleted_users WHERE zk_id = ?', 
            [zk_id]
        );
        
        if (deletedUsers.length > 0) {
            throw new Error(`ZK ID ${zk_id} has been previously deleted and cannot be reused`);
        }
        
        // Check if zk_id already exists in users table
        const existingUsers = await query(
            'SELECT * FROM users WHERE zk_id = ?', 
            [zk_id]
        );
        
        if (existingUsers.length > 0) {
            throw new Error(`ZK ID ${zk_id} is already in use`);
        }

        // Insert user into database
        const result = await query(
            `INSERT INTO users (
                first_name, 
                last_name, 
                zk_id, 
                password, 
                role,
                job_position,
                work_schedule_start,
                work_schedule_end,
                has_fingerprint,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                first_name.trim(), 
                last_name.trim(), 
                zk_id.padStart(4, '0'), // Ensure 4-digit format
                password, 
                role,
                job_position ? job_position.trim() : null,
                work_schedule_start,
                work_schedule_end,
                has_fingerprint ? 1 : 0
            ]
        );
        
        const userId = result.insertId;
        
        // Create user in ZK device
        const uid = Number(zk_id);
        const paddedZkId = zk_id.padStart(4, '0');
        const fullName = `${first_name.trim()} ${last_name.trim()}`.substring(0, 24); // Max 24 chars
        const userPassword = password.substring(0, 8); // Max 8 chars
        const userRole = 0; // Default role
        const cardno = 0;

        console.log('Attempting to create user in ZK device:', {
            uid,
            userid: paddedZkId,
            name: fullName,
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
            
            if (!zkResult || !zkResult.success) {
                throw new Error(zkResult?.error || 'Unknown error from ZK device');
            }
            
            // Fetch the created user to include in the response
            const createdUser = await query('SELECT * FROM users WHERE id = ?', [userId]);
            
            if (!createdUser || createdUser.length === 0) {
                throw new Error('Failed to fetch created user');
            }

            res.status(201).json({ 
                success: true, 
                message: 'User created successfully in both database and ZK device',
                user: {
                    id: createdUser[0].id,
                    first_name: createdUser[0].first_name,
                    last_name: createdUser[0].last_name,
                    zk_id: createdUser[0].zk_id,
                    job_position: createdUser[0].job_position,
                    work_schedule_start: createdUser[0].work_schedule_start,
                    work_schedule_end: createdUser[0].work_schedule_end,
                    has_fingerprint: Boolean(createdUser[0].has_fingerprint),
                    created_at: createdUser[0].created_at,
                    updated_at: createdUser[0].updated_at
                }
            });
            
        } catch (zkError) {
            // If ZK device update fails, delete the user from the database
            await query('DELETE FROM users WHERE id = ?', [userId]);
            console.error('Error creating user in ZK device:', zkError);
            throw new Error(`Failed to create user in ZK device: ${zkError.message}`);
        }
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create user',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.updatePassword = async (req, res) => {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;
    
    try {
        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }
        
        if (newPassword.length < 4) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 4 characters long'
            });
        }
        
        // Get user from database
        const users = await query('SELECT * FROM users WHERE id = ?', [id]);
        
        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const user = users[0];
        
        // Verify current password
        // In a real app, you would use bcrypt to compare hashed passwords
        if (user.password !== currentPassword) {
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }
        
        // Update the password
        // In a real app, you would hash the new password here
        await query(
            'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
            [newPassword, id]
        );
        
        // Log password change (in a real app, you might want to log this to a secure audit log)
        console.log(`Password updated for user ID: ${id}`);
        
        // Update password in ZK device if user has a zk_id
        if (user.zk_id) {
            try {
                const zkResult = await createOrUpdateUser({
                    uid: Number(user.zk_id),
                    userid: user.zk_id.padStart(4, '0'),
                    name: `${user.first_name} ${user.last_name}`.substring(0, 24),
                    password: newPassword.substring(0, 8), // Max 8 chars for ZK device
                    role: user.role || 0,
                    cardno: 0
                });
                
                if (!zkResult || !zkResult.success) {
                    console.error('ZK device update failed:', zkResult);
                    throw new Error(zkResult?.error || 'Failed to update password in ZK device');
                }
                
                console.log(`Successfully updated password in ZK device for user ID: ${id}`);
                
            } catch (zkError) {
                console.error('Error updating password in ZK device:', zkError);
                // We don't throw here because the password was updated in the database
                // We just log the error and continue
            }
        }
        
        res.json({
            success: true,
            message: 'Password updated successfully' + (user.zk_id ? ' (ZK device update may require retry)' : '')
        });
        
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update password',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete a user by ID
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    const connection = await getPool().getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Get user data before deleting
        const [[user]] = await connection.query(
            'SELECT * FROM users WHERE id = ?', 
            [id]
        );
        
        if (!user) {
            return res.status(404).json({ 
                success: false,
                error: 'User not found' 
            });
        }
        
        // Delete related records first (example: user_roles, user_devices, etc.)
        await connection.query(
            'DELETE FROM user_roles WHERE user_id = ?', 
            [id]
        );
        
        // Delete the user
        await connection.query(
            'DELETE FROM users WHERE id = ?', 
            [id]
        );
        
        // Add to deleted_users table
        await connection.query(
            'INSERT INTO deleted_users (user_id, zk_id, deleted_by, deleted_at) VALUES (?, ?, ?, NOW())',
            [id, user.zk_id, req.user?.id || null]
        );
        
        // If we get here, all operations were successful
        await connection.commit();
        
        // Optionally, you might want to sync this deletion with ZK device
        // await deleteUserFromZKDevice(user.zk_id);
        
        res.json({ 
            success: true, 
            message: 'User deleted successfully',
            userId: id 
        });
        
    } catch (error) {
        // Rollback the transaction if there's any error
        if (connection && typeof connection.rollback === 'function') {
            await connection.rollback();
        }
        
        console.error('Error deleting user:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to delete user',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        // Always release the connection back to the pool
        if (connection && typeof connection.release === 'function') {
            connection.release();
        }
    }
};
