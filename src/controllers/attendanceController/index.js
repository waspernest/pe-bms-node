const { getPool } = require('../../mysql');

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

exports.getAllAttendance = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const offset = (page - 1) * limit;
        const { search, startDate, endDate } = req.query;

        // Build WHERE clause for filters
        let whereClause = 'WHERE 1=1';
        const params = [];

        // Add search filter
        if (search) {
            whereClause += ` AND (
                a.zk_id LIKE ? OR 
                u.first_name LIKE ? OR 
                u.last_name LIKE ?
            )`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        // Add date range filter
        if (startDate) {
            whereClause += ' AND DATE(a.log_date) >= ?';
            params.push(startDate);
        }
        if (endDate) {
            whereClause += ' AND DATE(a.log_date) <= ?';
            params.push(endDate);
        }

        // Get total count with filters
        const countQuery = `
            SELECT COUNT(*) as count 
            FROM attendance a
            LEFT JOIN users u ON a.zk_id = u.zk_id
            ${whereClause}
        `;
        
        const countResult = await query(countQuery, params);
        const total = countResult[0]?.count || 0;
        
        // Only fetch attendance if there are any
        let attendance = [];
        if (total > 0) {
            // Build the main query with filters
            const queryStr = `
                SELECT a.*, u.first_name, u.last_name 
                FROM attendance a
                LEFT JOIN users u ON a.zk_id = u.zk_id
                ${whereClause}
                ORDER BY a.id DESC 
                LIMIT ? OFFSET ?
            `;
            
            // Add pagination parameters
            const queryParams = [...params, limit, offset];
            attendance = await query(queryStr, queryParams);
        }

        res.json({
            success: true,
            attendance,
            total: Number(total),
            page,
            limit
        });
        
    } catch (error) {
        console.error('Error getting attendance:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch attendance',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getUserAttendance = async (req, res) => {
    try {
        const { userId } = req.params;
        
        // First, get user details
        const [user] = await query('SELECT * FROM users WHERE id = ?', [userId]);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Then get all attendance logs for this user
        const attendanceLogs = await query(
            `SELECT a.* 
             FROM attendance a 
             WHERE a.zk_id = ? 
             ORDER BY a.log_date DESC, a.time_in DESC`,
            [user.zk_id]
        );
        
        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    zk_id: user.zk_id,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    job_position: user.job_position,
                    work_schedule_start: user.work_schedule_start,
                    work_schedule_end: user.work_schedule_end,
                    created_at: user.created_at
                },
                attendance: attendanceLogs
            }
        });
        
    } catch (error) {
        console.error('Error getting user attendance:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch user attendance',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.logAttendance = async (req, res) => {
    // If res is not provided (when called internally), return a promise
    if (!res) {
        return new Promise((resolve, reject) => {
            exports.logAttendance(req, {
                json: (data) => resolve(data),
                status: () => ({
                    json: (err) => reject(err)
                })
            });
        });
    }

    try {
        const { attendance } = req.body;
        
        if (!attendance || !Array.isArray(attendance) || attendance.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No attendance data provided'
            });
        }

        const results = [];
        
        for (const record of attendance) {
            const { zk_id, log_date, time } = record;
            
            // Validate required fields
            if (!zk_id || !log_date || !time) {
                console.warn('Skipping invalid record - missing required fields:', record);
                results.push({ ...record, error: 'Missing required fields', action: 'skipped' });
                continue;
            }
            
            try {
                // Find all attendance records for this user on this date
                const recordsResult = await query(
                    `SELECT id, time_in, time_out 
                     FROM attendance 
                     WHERE zk_id = ? AND log_date = ?
                     ORDER BY time_in`,
                    [zk_id, log_date]
                );
                
                // Ensure records is always an array
                const records = Array.isArray(recordsResult) ? recordsResult : [];
                
                let action;
                let recordUpdated = false;
                
                // Check if there's an open record (time_in without time_out)
                const openRecord = records.find(r => r.time_in && !r.time_out);
                
                if (openRecord) {
                    // If there's an open record and the new time is after the time_in
                    if (time > openRecord.time_in) {
                        // Update the time_out of the open record
                        const updateResult = await query(
                            'UPDATE attendance SET time_out = ?, log_type = 1 WHERE id = ?',
                            [time, openRecord.id]
                        );
                        
                        if (!updateResult) {
                            throw new Error('Failed to update attendance record');
                        }
                        
                        // Get the updated record with user details
                        const updatedRecords = await query(
                            `SELECT a.*, u.first_name, u.last_name 
                             FROM attendance a 
                             LEFT JOIN users u ON a.zk_id = u.zk_id 
                             WHERE a.id = ?`,
                            [openRecord.id]
                        );
                        
                        if (updatedRecords && updatedRecords.length > 0) {
                            const updatedRecord = updatedRecords[0];
                            action = 'time_out';
                            results.push({ 
                                ...updatedRecord,
                                action,
                                time_out: time,
                                time_in: updatedRecord.time_in,
                                log_date: updatedRecord.log_date
                            });
                        } else {
                            throw new Error('Failed to retrieve updated record');
                        }
                        recordUpdated = true;
                    } else {
                        // If the new time is before the open record's time_in, it's an error
                        throw new Error('New time is before the last time_in');
                    }
                }
                
                // If no open record was updated, check if we need to create a new time_in
                if (!recordUpdated) {
                    // Check if the new time is after the last time_out (if any)
                    const lastRecord = records[records.length - 1];
                    if (!lastRecord || (lastRecord.time_out && time > lastRecord.time_out)) {
                        // Create a new time_in record with log_type = 1 (device log)
                        const insertResult = await query(
                            'INSERT INTO attendance (zk_id, log_date, time_in, time_out, log_type) VALUES (?, ?, ?, NULL, 1)',
                            [zk_id, log_date, time]
                        );
                        
                        if (!insertResult || !insertResult.insertId) {
                            throw new Error('Failed to create attendance record');
                        }
                        
                        // Get the newly created record with user details
                        const userRecords = await query(
                            `SELECT a.*, u.first_name, u.last_name 
                             FROM attendance a 
                             LEFT JOIN users u ON a.zk_id = u.zk_id 
                             WHERE a.id = ?`,
                            [insertResult.insertId]
                        );
                        
                        if (userRecords && userRecords.length > 0) {
                            const newRecord = userRecords[0];
                            action = 'time_in';
                            results.push({ 
                                ...newRecord,
                                action,
                                time_in: time,
                                time_out: null
                            });
                        } else {
                            throw new Error('Failed to retrieve created record');
                        }
                    } else {
                        // If we get here, the time doesn't make sense (before last time_out)
                        throw new Error('Invalid time sequence');
                    }
                }
                
            } catch (error) {
                console.error('Error processing record:', record, error);
                results.push({ 
                    ...record, 
                    error: error.message,
                    action: 'error' 
                });
            }
        }

        res.json({
            success: true,
            processed: results.length,
            results
        });
        
    } catch (error) {
        console.error('Error logging attendance:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to log attendance',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Import attendance data from uploaded file directly from memory
 * @param {Object} req - Express request object with file in req.files
 * @param {Object} res - Express response object
 */
exports.importAttendance = async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded or invalid file format'
            });
        }
        
        const file = req.files.file;
        console.log('File info:', {
            name: file.name,
            size: file.size,
            mimetype: file.mimetype,
            encoding: file.encoding
        });
        
        // Access the file data directly
        const fileBuffer = file.data;
        console.log('File buffer length:', fileBuffer.length);
        
        // Process the file from memory buffer
        console.log('Processing file...');
        const attendanceData = await processAttendanceFile(fileBuffer, file.name);
        
        console.log('Processed attendance data:', attendanceData);
        
        // Temporarily commented out for testing
        // const result = await saveAttendanceData(attendanceData);
        
        res.json({
            success: true,
            message: 'File processed successfully (not saved to database)',
            fileInfo: {
                name: file.name,
                size: file.size,
                recordsProcessed: attendanceData ? attendanceData.length : 0
            },
            // insertedCount: result?.insertedCount || 0,
            sampleData: attendanceData ? attendanceData.slice(0, 3) : [] // Return first 3 records as sample
        });
        
    } catch (error) {
        console.error('Error importing attendance:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to import attendance',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};