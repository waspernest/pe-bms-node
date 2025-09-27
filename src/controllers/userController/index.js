const { getPool } = require('../../mysql');
const { createOrUpdateUser, getUsers } = require('../zkController');
const { 
    isRestDay, 
    getHolidayInfo, 
    calculateSummary,
    calculateWorkHours,
    toMYSQLDateTime,
    toMYSQLDate,
    formatTo12Hour
} = require('../../utils/controllers/attendance/attendanceHelper');

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
        const status = req.query.status || 'active';
        const search = (req.query.search || '').trim();
        const offset = (page - 1) * limit;

        // Build the base WHERE clause based on status
        let whereConditions = [];
        let queryParams = [];

        // Add status condition
        if (status === 'deleted') {
            whereConditions.push('u.is_deleted = 1');
        } else if (status === 'active') {
            whereConditions.push('u.is_deleted = 0');
        } // 'all' will have no status filter

        // Add search condition if search term exists
        if (search) {
            const searchTerm = `%${search}%`;
            whereConditions.push(`(
                u.first_name LIKE ? OR 
                u.last_name LIKE ? OR 
                u.zk_id LIKE ? OR 
                u.job_position LIKE ? OR
                CONCAT(u.first_name, ' ', u.last_name) LIKE ?
            )`);
            // Add the search term for each condition (5 times for each placeholder)
            queryParams = queryParams.concat(Array(5).fill(searchTerm));
        }

        // Combine all WHERE conditions
        const whereClause = whereConditions.length > 0 
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        // Get total count with the same filters
        const countQuery = `
            SELECT COUNT(DISTINCT u.id) as count 
            FROM users u
            LEFT JOIN schedule as s ON u.sid = s.id
            ${whereClause}
        `;
        
        const countResult = await query(countQuery, queryParams);
        const total = countResult[0]?.count || 0;
        
        // Only fetch users if there are any
        let users = [];
        if (total > 0) {
            const usersQuery = `
                SELECT 
                    u.*, 
                    s.name as schedule_name
                FROM users u
                LEFT JOIN schedule as s ON u.sid = s.id
                ${whereClause}
                ORDER BY u.id DESC 
                LIMIT ? OFFSET ?
            `;
            // Add limit and offset to the query params
            users = await query(usersQuery, [...queryParams, limit, offset]);
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
            'SELECT u.*, u.sid FROM users u WHERE u.id = ?', 
            [id]
        );
        
        // Also fetch the schedule details if sid exists
        if (user && user.sid) {
            const [schedule] = await query(
                'SELECT * FROM schedules WHERE id = ?',
                [user.sid]
            );
            if (schedule) {
                user.schedule = schedule;
            }
        }
        
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
        password, 
        department,
        job_position,
        work_schedule_start,
        work_schedule_end,
        rest_day,
        has_fingerprint,
        sid,
        schedules
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
            // if (!/^\d{1,4}$/.test(zk_id)) {
            //     throw new Error('ZK ID must be a 1-4 digit number (e.g., 1, 01, 001, or 0001)');
            // }
            
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
            updateValues.push(zk_id);
        }
        
        if (job_position !== undefined) {
            updateFields.push('job_position = ?');
            updateValues.push(job_position ? job_position.trim() : null);
        }

        if (department !== undefined) {
            updateFields.push('department = ?');
            updateValues.push(department);
        }
        
        if (work_schedule_start) {
            updateFields.push('work_schedule_start = ?');
            updateValues.push(work_schedule_start);
        }
        
        if (work_schedule_end) {
            updateFields.push('work_schedule_end = ?');
            updateValues.push(work_schedule_end);
        }
        
        if (rest_day) {
            updateFields.push('rest_day = ?');
            updateValues.push(rest_day);
        }
        
        if (has_fingerprint !== undefined) {
            updateFields.push('has_fingerprint = ?');
            updateValues.push(has_fingerprint ? 1 : 0);
        }

        // Handle schedule ID for coal_handling department
        if (department === 'coal_handling' && sid) {
            updateFields.push('sid = ?');
            updateValues.push(sid);
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
            const paddedZkId = updatedUserData.zk_id;
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
    // Destructure with default values that handle empty strings
    const { 
        first_name, 
        last_name, 
        zk_id, 
        password, 
        job_position,
        department,
        work_schedule_start,
        work_schedule_end,
        rest_day,
        has_fingerprint = false
    } = req.body;
    
    // Apply defaults if values are empty or undefined
    const workStart = work_schedule_start || '09:00';
    const workEnd = work_schedule_end || '18:00';
    const restDay = rest_day || 'Sunday';
    
    const role = 0; // Default role
    
    try {
        // Validate required fields
        if (!first_name || !last_name || !zk_id || !password) {
            throw new Error('First name, last name, ZK ID, and password are required');
        }
        
        // Validate ZK ID format
        // if (!/^\d{1,4}$/.test(zk_id)) {
        //     throw new Error('ZK ID must be a 1-4 digit number (e.g., 1, 01, 001, or 0001)');
        // }
        
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

        // Hash the password before storing
        //const hashedPassword = await bcrypt.hash(password, 10);

        // Insert the new user into the database
        const result = await query(
            `INSERT INTO users (
                first_name, 
                last_name, 
                zk_id, 
                password, 
                role,
                job_position, 
                department,
                work_schedule_start, 
                work_schedule_end,
                rest_day,
                has_fingerprint,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                first_name.trim(),
                last_name.trim(),
                zk_id,
                password,
                role,
                job_position,
                department,
                workStart,
                workEnd,
                restDay,
                has_fingerprint ? 1 : 0
            ]
        );
        
        const userId = result.insertId;
        
        // Create user in ZK device
        const uid = Number(zk_id);
        const paddedZkId = zk_id;
        const fullName = `${first_name.trim()} ${last_name.trim()}`.substring(0, 24); // Max 24 chars
        const userPassword = password.substring(0, 8); // Max 8 chars
        const userRole = 0; // Default role
        const cardNo = 0;

        console.log('Attempting to create user in ZK device:', {
            uid,
            userid: paddedZkId,
            name: fullName,
            role: userRole,
            cardno: cardNo
        });
        
        try {
            const zkResult = await createOrUpdateUser({
                uid,
                userid: paddedZkId,
                name: fullName,
                password: userPassword,
                role: userRole,
                cardno: cardNo
            });

            console.log('zkResult', zkResult);
            
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
        
        // Delete the user
        await connection.query(
            'UPDATE users SET is_deleted = 1 WHERE id = ?', 
            [id]
        );
        
        // Add to deleted_users table
        await connection.query(
            'INSERT INTO deleted_users (user_id, zk_id, deleted_by, deleted_at) VALUES (?, ?, ?, NOW())',
            [id, user.zk_id, req.user?.id || null]
        );

        // Update the user in ZK device to mark as deleted
        try {
            // Use the existing createOrUpdateUser function to update the user in ZK device
            await createOrUpdateUser({
                uid: Number(user.zk_id),
                userid: user.zk_id,
                name: `Deleted - ${user.first_name} ${user.last_name || ''}`.trim(),
                password: '', // Default or empty password
                role: 0, // Default role
                cardno: 0
            }, null); // Pass null as res since we're not in an HTTP context
            
            console.log(`Successfully marked user ${user.zk_id} as deleted in ZK device`);

            // If we get here, all operations were successful
            await connection.commit();

        } catch (zkError) {
            console.error('Error updating ZK device:', zkError);
            // Don't fail the entire operation if ZK update fails
            // Just log the error and continue
        }
        
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

// Remove user totally by ID
exports.removeUser = async (req, res) => {

    const { id } = req.params;
    const connection = await getPool().getConnection();

    try {
        await connection.beginTransaction();

        // Delete related records first (example: user_roles, user_devices, etc.)
        await connection.query(
            'DELETE FROM attendance WHERE zk_id = ?', 
            [id]
        );
        
        // Delete the user from deleted_users
        await connection.query(
            'DELETE FROM deleted_users WHERE user_id = ?', 
            [id]
        );

        // Delete the user from users
        await connection.query(
            'DELETE FROM users WHERE id = ?', 
            [id]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'User removed successfully',
            userId: id 
        });

    } catch (error) {
        console.error('Error removing user:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to remove user',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }

}

exports.syncUser = async (req, res) => {
    const { type } = req.query;
    const connection = await getPool().getConnection();
    let count = 0;

    try {
        if (type === 'from_device') {
            // Get users directly from ZK device
            const response = await getUsers();
            const zkUsers = response.data || [];
            
            // Start a transaction
            await connection.beginTransaction();

            try {
                for (const user of zkUsers) {
                    const { uid, name, password, role, cardno } = user;
                    
                    // Skip deleted users (both old and new format)
                    if (name === 'Deleted User' || name.startsWith('Deleted - ')) {
                        continue;
                    }

                    // Handle names more robustly
                    const nameParts = name.trim().split(/\s+/);
                    const first_name = nameParts[0] || '';
                    const last_name = nameParts.slice(1).join(' ') || '';

                    // Check if user already exists
                    const [existing] = await connection.query(
                        'SELECT id FROM users WHERE zk_id = ?',
                        [uid]
                    );

                    if (existing && existing.length > 0) {
                        // Update existing user
                        await connection.query(
                            'UPDATE users SET first_name = ?, last_name = ?, role = ? WHERE zk_id = ?',
                            [first_name, last_name, role, uid]
                        );
                    } else {
                        // Insert new user
                        await connection.query(
                            'INSERT INTO users (zk_id, old_zk_id, first_name, last_name, password, role) VALUES (?, ?, ?, ?, ?, ?)',
                            [uid, 0, first_name, last_name, password, role]
                        );
                    }
                    count++;
                }
                
                // Commit the transaction
                await connection.commit();
                
                return res.json({
                    success: true,
                    message: `Successfully synced ${count} users from device`,
                    count: count
                });
            } catch (error) {
                // Rollback in case of error
                await connection.rollback();
                throw error; // Re-throw to be caught by the outer try-catch
            }
            
        }
        
        if (type === 'to_device') {
            await connection.beginTransaction();
            let addedCount = 0;
            let errorCount = 0;
            const errors = [];

            try {
                // Get all active users from database
                const [dbUsers] = await connection.query(
                    'SELECT * FROM users WHERE zk_id IS NOT NULL AND is_deleted = 0'
                );

                // Get current users from ZK device
                const zkResponse = await getUsers();
                const zkUsers = zkResponse.data || [];
                
                // Find users that exist in DB but not on device
                for (const dbUser of dbUsers) {
                    const userExists = zkUsers.some(zkUser => 
                        parseInt(zkUser.uid) === parseInt(dbUser.zk_id)
                    );

                    if (!userExists) {
                        try {
                            // Add user to device
                            await createOrUpdateUser({
                                uid: dbUser.zk_id,
                                userid: dbUser.zk_id.toString(),
                                name: `${dbUser.first_name} ${dbUser.last_name}`.trim(),
                                password: dbUser.password || '1234', // Default password if not set
                                role: dbUser.role || 0, // Default role if not set
                                cardno: dbUser.cardno || 0
                            });
                            addedCount++;
                        } catch (error) {
                            console.error(`Error adding user ${dbUser.zk_id} to device:`, error);
                            errorCount++;
                            errors.push({
                                userId: dbUser.zk_id,
                                name: `${dbUser.first_name} ${dbUser.last_name}`.trim(),
                                error: error.message
                            });
                        }
                    }
                }

                await connection.commit();
                
                return res.json({
                    success: true,
                    message: `Sync to device completed. Added ${addedCount} users.`,
                    addedCount,
                    errorCount,
                    errors: errors.length > 0 ? errors : undefined
                });

            } catch (error) {
                await connection.rollback();
                console.error('Error during sync to device:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to sync users to device',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
        }
        
        // If we get here, the sync type is invalid
        return res.status(400).json({
            success: false,
            error: 'Invalid sync type. Use "from_device" or "to_device"'
        });
        
    } catch (error) {
        console.error('Error during sync:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to sync users: ' + error.message
        });
    }
};

exports.exportUserAttendance = async (req, res) => {
    try {
        const connection = await getPool().getConnection();
        
        try {

            // Calculate date range (1-15 or 16-end of month)
            const now = new Date();
            const currentDay = now.getDate();
            const year = now.getFullYear();
            const month = now.getMonth();

            let startDate, endDate;

            if (currentDay <= 15) {
                // First half of the month (1-15)
                startDate = new Date(year, month, 1);
                endDate = new Date(year, month, 15);
            } else {
                // Second half of the month (16-end)
                startDate = new Date(year, month, 16);
                endDate = new Date(year, month + 1, 0); // Last day of current month
            }

            // Format dates for database query (YYYY-MM-DD)
            const formatForDB = (date) => {
                return date.toISOString().split('T')[0];
            };

            // Format dates for response (YYYY-MM-DD)
            const formatForResponse = (date) => {
                const d = new Date(date);
                const pad = num => num.toString().padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            };

            const startDateStr = formatForDB(startDate);
            const endDateStr = formatForDB(endDate);

            // Function to generate all dates in range
            const getAllDates = (start, end) => {
                const dates = [];
                const current = new Date(start);
                const last = new Date(end);
                
                while (current <= last) {
                    dates.push(new Date(current));
                    current.setDate(current.getDate() + 1);
                }
                return dates;
            };

            const dateRange = getAllDates(startDate, endDate);

            const [users] = await connection.query(`
                SELECT 
                    u.id,
                    u.zk_id,
                    u.first_name as firstName,
                    u.last_name as lastName,
                    u.job_position as position,
                    u.work_schedule_start as scheduleStart,
                    u.work_schedule_end as scheduleEnd
                FROM users u
                WHERE u.is_deleted = 0
                ORDER BY u.last_name ASC
            `);

            // Process each user's attendance
            for (const user of users) {
                const [attendance] = await connection.query(`
                    SELECT 
                        id,
                        log_date as date,
                        time_in as timeIn,
                        time_out as timeOut
                    FROM attendance
                    WHERE zk_id = ? 
                    AND DATE(log_date) BETWEEN ? AND ?
                    ORDER BY log_date ASC
                `, [user.zk_id, startDateStr, endDateStr]);

                // Create a map of existing attendance records by date
                const attendanceMap = new Map();
                attendance.forEach(record => {
                    const dateKey = formatForResponse(new Date(record.date));
                    attendanceMap.set(dateKey, record);
                });

                // Helper function to format time to 12-hour format
                const formatTo12Hour = (timeStr) => {
                    if (!timeStr) return '--:--';
                    
                    const [hours, minutes] = timeStr.split(':');
                    const hour = parseInt(hours, 10);
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const hour12 = hour % 12 || 12;
                    return `${hour12}:${minutes} ${ampm}`;
                };

                // Helper function to process each date in the range
                const processDate = async (currentDate) => {
                    const dateKey = formatForResponse(currentDate);
                    const existingRecord = attendanceMap.get(dateKey);
                    
                    if (existingRecord) {
                        const holidayInfo = await getHolidayInfo(currentDate);
                        const restDay = await isRestDay(user.id, currentDate);
                        
                        // Calculate work hours
                        let workHours = { nt: 0, ot: 0, lt: 0, ut: 0 };
                        if (existingRecord.timeIn && existingRecord.timeOut) {
                            // This is a simplified calculation - adjust according to your business logic
                            const start = new Date(`${dateKey}T${existingRecord.timeIn}`);
                            const end = new Date(`${dateKey}T${existingRecord.timeOut}`);
                            const diffHours = (end - start) / (1000 * 60 * 60);
                            workHours.nt = Math.min(8, Math.max(0, diffHours));
                            workHours.ot = Math.max(0, diffHours - 8);
                            // Add your late/undertime calculations here
                        }
                        
                        return {
                            ...existingRecord,
                            date: dateKey,
                            timeIn: existingRecord.timeIn ? formatTo12Hour(existingRecord.timeIn) : '--:--',
                            timeOut: existingRecord.timeOut ? formatTo12Hour(existingRecord.timeOut) : '--:--',
                            workHours: workHours.nt,
                            overtime: workHours.ot,
                            late: workHours.lt,
                            undertime: workHours.ut,
                            isHoliday: holidayInfo.isHoliday,
                            holidayType: holidayInfo.type,
                            isRestDay: restDay,
                            hasRecord: true
                        };
                    } else {
                        const holidayInfo = await getHolidayInfo(currentDate);
                        const restDay = await isRestDay(user.id, currentDate);
                        
                        return {
                            date: dateKey,
                            timeIn: '--:--',
                            timeOut: '--:--',
                            workHours: 0,
                            overtime: 0,
                            late: 0,
                            undertime: 0,
                            isHoliday: holidayInfo.isHoliday,
                            holidayType: holidayInfo.type,
                            isRestDay: restDay,
                            hasRecord: false
                        };
                    }
                };

                // Process all dates in parallel
                const processedAttendance = await Promise.all(dateRange.map(processDate));

                // Prepare summary data
                const summaryData = processedAttendance.map(record => {
                    const workHours = typeof record.workHours === 'string' 
                        ? parseFloat(record.workHours) || 0 
                        : record.workHours;

                    return {
                        date: record.date,
                        time_in: record.timeIn,
                        time_out: record.timeOut,
                        is_rest_day: record.isRestDay,
                        is_holiday: record.isHoliday || false,
                        holiday_type: record.holidayType || null,
                        work_hours: workHours,
                        overtime: record.overtime || 0,
                        late: record.late || 0,
                        undertime: record.undertime || 0,
                        has_record: record.hasRecord
                    };
                });

                // Calculate summary stats
                const workedDays = processedAttendance.filter(day => day.hasRecord).length;
                const totalWorkedHours = processedAttendance
                    .filter(day => day.hasRecord)
                    .reduce((sum, day) => sum + (parseFloat(day.workHours) || 0), 0);

                const summary = {
                    reg_hrs: totalWorkedHours,
                    worked_days: workedDays,
                    total_hours_worked: totalWorkedHours,
                    regular_ot: processedAttendance
                        .filter(day => day.hasRecord)
                        .reduce((sum, day) => sum + (parseFloat(day.overtime) || 0), 0),
                    rest_days_worked: 0,
                    total_rest_days: 0,
                    total_late_time: processedAttendance
                        .filter(day => day.hasRecord)
                        .reduce((sum, day) => sum + (parseFloat(day.late) || 0), 0),
                    total_undertime: processedAttendance
                        .filter(day => day.hasRecord)
                        .reduce((sum, day) => sum + (parseFloat(day.undertime) || 0), 0),
                    total_night_diff: 0,
                    regular_holidays_worked: 0,
                    special_holidays_worked: 0,
                    total_regular_holidays: 0,
                    total_special_holidays: 0
                };

                user.attendance = processedAttendance;
                user.summary = summary;
                user.schedule = {
                    start: formatTo12Hour(user.scheduleStart),
                    end: formatTo12Hour(user.scheduleEnd)
                };
                delete user.scheduleStart;
                delete user.scheduleEnd;
            }

            res.json({
                startDate: formatForResponse(startDate),
                endDate: formatForResponse(endDate),
                period: currentDay <= 15 ? 'First Half' : 'Second Half',
                users
            });

        } finally {
            await connection.release();
        }

    } catch (error) {
        console.error('Error exporting user attendance:', error);
        res.status(500).json({ 
            error: 'Failed to export user attendance',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.exportUserAttendanceToWord = async (req, res) => {
    let connection;
    try {
        connection = await getPool().getConnection();
        console.log('Database connection established');
        const { month, year, range, department } = req.query;
        
        // Validate required parameters
        if (!month || !year || !range || !department) {
            return res.status(400).json({ 
                error: 'Missing required parameters: month, year, range, or department' 
            });
        }
        
        let monthIndex;
        
        // Check if month is a number (1-12)
        if (/^\d+$/.test(month)) {
            monthIndex = parseInt(month, 10) - 1; // Convert to 0-based index
            if (monthIndex < 0 || monthIndex > 11) {
                return res.status(400).json({ 
                    error: 'Invalid month number. Must be between 1 and 12',
                    received: month
                });
            }
        } else {
            // Handle month name
            const monthNames = ["january", "february", "march", "april", "may", "june",
                "july", "august", "september", "october", "november", "december"];
            monthIndex = monthNames.indexOf(month.toLowerCase());
            
            if (monthIndex === -1) {
                return res.status(400).json({ 
                    error: 'Invalid month name',
                    received: month,
                    expected: 'Month name (e.g., "January") or number (1-12)'
                });
            }
        }
        
        // Calculate date range based on provided parameters
        const yearNum = parseInt(year, 10);
        let startDate, endDate;
        
        if (range === 'first_period') {
            // First half of the month (1-15)
            startDate = new Date(yearNum, monthIndex, 1);
            endDate = new Date(yearNum, monthIndex, 15);
        } else {
            // Second half of the month (16-end)
            startDate = new Date(yearNum, monthIndex, 16);
            endDate = new Date(yearNum, monthIndex + 1, 0); // Last day of the month
        }
        
        // Format dates for database query (YYYY-MM-DD)
        const formatForDB = (date) => {
            return date.toISOString().split('T')[0];
        };
        
        // Format dates for response (YYYY-MM-DD)
        const formatForResponse = (date) => {
            const d = new Date(date);
            const pad = num => num.toString().padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        
        const startDateStr = formatForDB(startDate);
        const endDateStr = formatForDB(endDate);
        
        // Function to generate all dates in range
        const getAllDates = (start, end) => {
            const dates = [];
            const current = new Date(start);
            const last = new Date(end);
            
            while (current <= last) {
                dates.push(new Date(current));
                current.setDate(current.getDate() + 1);
            }
            return dates;
        };
        
        const dateRange = getAllDates(startDate, endDate);
        
        // Get users for the specified department
        const [users] = await connection.query(`
            SELECT 
                u.id,
                u.zk_id,
                u.first_name as firstName,
                u.last_name as lastName,
                u.job_position as position,
                u.work_schedule_start as scheduleStart,
                u.work_schedule_end as scheduleEnd,
                u.sid,
                u.department
            FROM users u
            WHERE u.is_deleted = 0
            AND u.department = ?
            ORDER BY u.last_name ASC
        `, [department]);
        
        if (users.length === 0) {
            return res.status(404).json({ 
                error: 'No users found in the specified department' 
            });
        }
        
        // For coal_handling department, fetch dynamic schedules
        if (department === 'coal_handling') {
            // Get the month and year for schedule lookup (YYYY-MM format)
            const scheduleMonth = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
            
            // Get all schedules for coal_handling users in one query for better performance
            const coalHandlingUsers = users.filter(u => u.department === 'coal_handling' && u.sid);
            const sids = coalHandlingUsers.map(u => u.sid);
            
            if (sids.length > 0) {
                const [allSchedules] = await connection.query(`
                    SELECT 
                        sa.sid,
                        sa.schedule_date,
                        sa.work_schedule_start as scheduleStart,
                        sa.work_schedule_end as scheduleEnd
                    FROM schedule_assoc sa
                    WHERE sa.sid IN (?) 
                    AND DATE_FORMAT(sa.schedule_date, '%Y-%m') = ?
                    ORDER BY sa.schedule_date ASC
                `, [sids, scheduleMonth]);
                
                // Group schedules by sid and date
                const scheduleMap = new Map();
                allSchedules.forEach(schedule => {
                    if (!scheduleMap.has(schedule.sid)) {
                        scheduleMap.set(schedule.sid, new Map());
                    }
                    // Convert MySQL date string to YYYY-MM-DD format
                    // Handle both string and Date objects from the database
                    const scheduleDate = schedule.schedule_date instanceof Date 
                        ? schedule.schedule_date 
                        : new Date(schedule.schedule_date);
                    
                    if (isNaN(scheduleDate.getTime())) {
                        console.error('Invalid date value:', schedule.schedule_date);
                        return; // Skip invalid dates
                    }
                    
                    const dateKey = scheduleDate.toISOString().split('T')[0];
                    
                    scheduleMap.get(schedule.sid).set(dateKey, {
                        scheduleStart: schedule.scheduleStart,
                        scheduleEnd: schedule.scheduleEnd
                    });
                });
                
                // Assign schedules to users
                users.forEach(user => {
                    if (scheduleMap.has(user.sid)) {
                        user.schedules = scheduleMap.get(user.sid);
                    }
                });
            }
        }
        
        // Process each user's attendance
        for (const user of users) {
            const [attendance] = await connection.query(`
                SELECT 
                    id,
                    log_date as date,
                    time_in as timeIn,
                    time_out as timeOut
                FROM attendance
                WHERE zk_id = ? 
                AND DATE(log_date) BETWEEN ? AND ?
                ORDER BY log_date ASC
            `, [user.zk_id, startDateStr, endDateStr]);
            
            // Create a map of existing attendance records by date
            const attendanceMap = new Map();
            attendance.forEach(record => {
                const dateKey = formatForResponse(new Date(record.date));
                attendanceMap.set(dateKey, record);
            });
            
            // Helper function to get schedule for a specific date
            const getScheduleForDate = (date) => {
                try {
                    // For coal_handling department with dynamic schedules
                    if (user.schedules) {
                        // Ensure we have a valid date object
                        const scheduleDate = date instanceof Date ? date : new Date(date);
                        if (isNaN(scheduleDate.getTime())) {
                            throw new Error(`Invalid date: ${date}`);
                        }
                        
                        const dateKey = scheduleDate.toISOString().split('T')[0];
                        const daySchedule = user.schedules.get(dateKey);
                        
                        if (daySchedule) {
                            return {
                                start: daySchedule.scheduleStart || user.scheduleStart,
                                end: daySchedule.scheduleEnd || user.scheduleEnd
                            };
                        }
                    }
                    // Fallback to user's default schedule
                    return {
                        start: user.scheduleStart,
                        end: user.scheduleEnd
                    };
                } catch (error) {
                    console.error('Error in getScheduleForDate:', {
                        error: error.message,
                        date,
                        userId: user.id
                    });
                    // Return default schedule on error
                    return {
                        start: user.scheduleStart,
                        end: user.scheduleEnd
                    };
                }
            };
            
            // Generate records for all dates in range
            const processedAttendance = await Promise.all(dateRange.map(async (currentDate) => {
                const dateKey = formatForResponse(currentDate);
                const existingRecord = attendanceMap.get(dateKey);
                
                // Get schedule for this specific date
                const schedule = getScheduleForDate(currentDate);
                
                if (existingRecord) {
                    const workHours = calculateWorkHours(
                        existingRecord.timeIn, 
                        existingRecord.timeOut, 
                        schedule.start, 
                        schedule.end
                    );
                    
                    const holidayInfo = await getHolidayInfo(currentDate);
                    const restDay = await isRestDay(user.id, currentDate);
                    
                    return {
                        ...existingRecord,
                        date: dateKey,
                        timeIn: existingRecord.timeIn ? formatTo12Hour(existingRecord.timeIn) : '--:--',
                        timeOut: existingRecord.timeOut ? formatTo12Hour(existingRecord.timeOut) : '--:--',
                        workHours: workHours?.nt,
                        overtime: workHours?.ot,
                        late: workHours?.lt,
                        undertime: workHours?.ut,
                        isHoliday: holidayInfo.isHoliday,
                        holidayType: holidayInfo.type,
                        isRestDay: restDay,
                        hasRecord: true,
                        schedule: {
                            start: formatTo12Hour(schedule.start),
                            end: formatTo12Hour(schedule.end)
                        }
                    };
                } else {
                    const holidayInfo = await getHolidayInfo(currentDate);
                    const restDay = await isRestDay(user.id, currentDate);
                    
                    return {
                        date: dateKey,
                        timeIn: '--:--',
                        timeOut: '--:--',
                        workHours: 0,
                        overtime: 0,
                        late: 0,
                        undertime: 0,
                        isHoliday: holidayInfo.isHoliday,
                        holidayType: holidayInfo.type,
                        isRestDay: restDay,
                        hasRecord: false,
                        schedule: {
                            start: formatTo12Hour(schedule.start),
                            end: formatTo12Hour(schedule.end)
                        }
                    };
                }
            }));
            
            // Calculate summary stats
            const workedDays = processedAttendance.filter(day => day.hasRecord).length;
            const totalWorkedHours = processedAttendance
                .filter(day => day.hasRecord)
                .reduce((sum, day) => sum + (parseFloat(day.workHours) || 0), 0);
            
            // Get unique schedules for the user
            const uniqueSchedules = new Map();
            processedAttendance.forEach(day => {
                const scheduleKey = `${day.schedule.start}-${day.schedule.end}`;
                if (!uniqueSchedules.has(scheduleKey)) {
                    uniqueSchedules.set(scheduleKey, day.schedule);
                }
            });
            
            const summary = {
                reg_hrs: totalWorkedHours,
                worked_days: workedDays,
                total_hours_worked: totalWorkedHours,
                regular_ot: processedAttendance
                    .filter(day => day.hasRecord)
                    .reduce((sum, day) => sum + (parseFloat(day.overtime) || 0), 0),
                rest_days_worked: 0,
                total_rest_days: 0,
                total_late_time: processedAttendance
                    .filter(day => day.hasRecord)
                    .reduce((sum, day) => sum + (parseFloat(day.late) || 0), 0),
                total_undertime: processedAttendance
                    .filter(day => day.hasRecord)
                    .reduce((sum, day) => sum + (parseFloat(day.undertime) || 0), 0),
                total_night_diff: 0,
                regular_holidays_worked: 0,
                special_holidays_worked: 0,
                total_regular_holidays: 0,
                total_special_holidays: 0,
                schedules: Array.from(uniqueSchedules.values())
            };
            
            user.attendance = processedAttendance;
            user.summary = summary;
            
            // Only include default schedule if no dynamic schedules exist
            if (!user.schedules) {
                user.schedule = {
                    start: formatTo12Hour(user.scheduleStart),
                    end: formatTo12Hour(user.scheduleEnd)
                };
            }
            
            // Clean up
            delete user.scheduleStart;
            delete user.scheduleEnd;
            delete user.schedules; // No need to send this to the client
        }
    

        // Send the response with the processed data
        res.json({
            startDate: formatForResponse(startDate),
            endDate: formatForResponse(endDate),
            period: range === 'first_period' ? 'First Half' : 'Second Half',
            department,
            users
        });
    } catch (error) {
        console.error('Error in exportUserAttendanceToWord:', {
            message: error.message,
            stack: error.stack,
            query: req.query,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({ 
            error: 'Failed to export user attendance to Word',
            details: process.env.NODE_ENV === 'development' ? {
            message: error.message,
            stack: error.stack
        } : undefined
    });
} finally {
    if (connection) {
        try {
            await connection.release();
            console.log('Database connection released');
        } catch (releaseError) {
            console.error('Error releasing database connection:', releaseError);
        }
    }
}
}; 
