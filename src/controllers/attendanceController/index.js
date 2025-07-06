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

exports.logAttendance = async (req, res) => {
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
                const records = await query(
                    `SELECT id, time_in, time_out 
                     FROM attendance 
                     WHERE zk_id = ? AND log_date = ?
                     ORDER BY time_in`,
                    [zk_id, log_date]
                );
                
                let action, result;
                let recordUpdated = false;
                
                // Check if there's an open record (time_in without time_out)
                const openRecord = records.find(r => r.time_in && !r.time_out);
                
                if (openRecord) {
                    // If there's an open record and the new time is after the time_in
                    if (time > openRecord.time_in) {
                        // Update the time_out of the open record
                        [result] = await query(
                            'UPDATE attendance SET time_out = ?, log_type = 1 WHERE id = ?',
                            [time, openRecord.id]
                        );
                        action = 'time_out';
                        results.push({ 
                            zk_id, 
                            log_date, 
                            time, 
                            action, 
                            id: openRecord.id,
                            log_type: 1 
                        });
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
                        [result] = await query(
                            'INSERT INTO attendance (zk_id, log_date, time_in, time_out, log_type) VALUES (?, ?, ?, NULL, 1)',
                            [zk_id, log_date, time]
                        );
                        action = 'time_in';
                        results.push({ 
                            zk_id, 
                            log_date, 
                            time, 
                            action, 
                            id: result.insertId,
                            log_type: 1 
                        });
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