const { getPool } = require('../../mysql');
const xlsx = require('xlsx');
const { Readable } = require('stream');
const csv = require('csv-parser');
const { format } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');

const timeZone = 'Asia/Manila';

const { 
    isRestDay, 
    getHolidayInfo, 
    calculateSummary,
    calculateWorkHours,
    toMYSQLDateTime,
    toMYSQLDate,
    formatTo12Hour
} = require('../../utils/controllers/attendance/attendanceHelper');

/**
 * Helper function to get a connection and run a query
 * @private
 */
const query = async (sql, params = []) => {
    const connection = await getPool().getConnection();
    try {
        const [results] = await connection.query(sql, params);
        return results;
    } finally {
        connection.release();
    }
};

const toPHDateString = (date) => {
    if (!date) return null;
    
    // Create date object from input
    const d = new Date(date);
    
    // Get date components in local time
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    // Return in YYYY-MM-DD format
    return `${year}-${month}-${day}`;
};

/**
 * Format Excel row data
 * @private
 * @param {Object} row - Raw row data from Excel
 * @returns {Object} Formatted row data
 */
const formatExcelRow = (row) => {
    const formattedRow = { ...row };
    
    // Format LOG_DATE if it exists
    if (formattedRow.LOG_DATE) {
        if (formattedRow.LOG_DATE instanceof Date) {
            formattedRow.LOG_DATE = formattedRow.LOG_DATE.toISOString().split('T')[0];
        } else if (typeof formattedRow.LOG_DATE === 'number') {
            const date = new Date((formattedRow.LOG_DATE - 25569) * 86400 * 1000);
            formattedRow.LOG_DATE = date.toISOString().split('T')[0];
        }
    }
    
    // Format TIME_IN and TIME_OUT if they exist
    ['TIME_IN', 'TIME_OUT'].forEach(field => {
        if (formattedRow[field] !== undefined) {
            if (typeof formattedRow[field] === 'number') {
                const totalSeconds = Math.round(formattedRow[field] * 86400);
                const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
                const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
                const seconds = (totalSeconds % 60).toString().padStart(2, '0');
                formattedRow[field] = `${hours}:${minutes}:${seconds}`;
            }
        }
    });
    
    return formattedRow;
}

/**
 * Process CSV file buffer
 * @private
 * @param {Buffer} buffer - CSV file buffer
 * @returns {Promise<Array>} Parsed CSV data
 */
const processCsvFile = async (buffer) => {
    return new Promise((resolve, reject) => {
        const results = [];
        const bufferStream = new Readable();
        bufferStream.push(buffer);
        bufferStream.push(null);
        
        bufferStream
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}
    
/**
 * Process Excel file buffer
 * @private
 * @param {Buffer} buffer - Excel file buffer
 * @returns {Promise<Array>} Parsed Excel data
 */
const processExcelFile = async (buffer) => {
    const workbook = xlsx.read(buffer, { 
        type: 'buffer',
        cellDates: true,
        cellText: true,
        cellNF: true,
        dateNF: 'yyyy-mm-dd',
        raw: false
    });
    
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    
    const data = xlsx.utils.sheet_to_json(ws, {
        raw: false,
        dateNF: 'yyyy-mm-dd',
        defval: ''
    });
    
    return data.map(row => formatExcelRow(row));
}

/**
 * Import data to database with duplicate checking
 * @private
 * @param {Array} rows - Rows to import
 * @returns {Promise<Object>} Import results
 */
const importToDatabase = async (rows) => {
    const insertedRows = [];
    const skippedRows = [];
    const errors = [];
    
    for (const row of rows) {
        try {
            const { ZK_ID, LOG_DATE, TIME_IN, TIME_OUT } = row;
            
            if (!ZK_ID || !LOG_DATE || !TIME_IN) {
                errors.push({
                    row,
                    error: 'Missing required fields (ZK_ID, LOG_DATE, and TIME_IN are required)'
                });
                continue;
            }
            
            // Check for existing record with the same zk_id, log_date, and time_in
            const existingRecord = await query(
                `SELECT id FROM attendance 
                WHERE zk_id = ? 
                AND log_date = ? 
                AND time_in = ?`,
                [ZK_ID, LOG_DATE, TIME_IN]
            );

            if (existingRecord.length > 0) {
                // Record with same zk_id, date, and time_in already exists
                skippedRows.push({
                    ...row,
                    id: existingRecord[0].id,
                    status: 'skipped',
                    reason: 'A record with the same employee, date, and time already exists'
                });
                continue;
            }

            // Check for potential duplicate (same employee, date, and close times)
            const potentialDuplicate = await query(
                `SELECT id FROM attendance 
                WHERE zk_id = ? 
                AND log_date = ? 
                AND ABS(TIMESTAMPDIFF(MINUTE, CONCAT(log_date, ' ', time_in), ?)) <= 5`,
                [ZK_ID, LOG_DATE, `${LOG_DATE} ${TIME_IN}`]
            );

            if (potentialDuplicate.length > 0) {
                skippedRows.push({
                    ...row,
                    id: potentialDuplicate[0].id,
                    status: 'skipped',
                    reason: 'A similar record already exists within 5 minutes'
                });
                continue;
            }

            // Insert new record if no duplicates found
            const result = await query(
                `INSERT INTO attendance 
                (zk_id, log_date, time_in, time_out, log_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, NOW(), NOW())`,
                [ZK_ID, LOG_DATE, TIME_IN, TIME_OUT || null]
            );
            
            insertedRows.push({
                ...row,
                id: result.insertId,
                status: 'inserted'
            });
            
        } catch (error) {
            console.error('Error inserting row:', error);
            errors.push({
                row,
                error: error.message,
                status: 'error'
            });
        }
    }
    
    return { 
        insertedRows, 
        skippedRows,
        errors,
        totalProcessed: rows.length,
        totalInserted: insertedRows.length,
        totalSkipped: skippedRows.length,
        totalFailed: errors.length
    };
}

/**
 * Generate result message for import
 * @private
 * @param {Object} params - Parameters object
 * @param {Array} params.insertedRows - Successfully inserted rows
 * @param {Array} params.errors - Errors encountered
 * @returns {string} Result message
 */
const generateResultMessage = ({ insertedRows, errors }) => {
    const successMessage = `Successfully processed ${insertedRows.length} records`;
    const errorMessage = errors.length > 0 ? `, ${errors.length} failed` : '';
    return successMessage + errorMessage;
}

/**
 * Get all attendance records with pagination and filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
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

/**
 * Get attendance records for a specific user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
// exports.getUserAttendance = async (req, res) => {
//     try {
//         const { userId } = req.params;
        
//         // First, get user details
//         const [user] = await query('SELECT * FROM users WHERE id = ?', [userId]);
        
//         if (!user) {
//             return res.status(404).json({
//                 success: false,
//                 error: 'User not found'
//             });
//         }
        
//         // Then get all attendance logs for this user
//         const attendanceLogs = await query(
//             `SELECT a.* 
//              FROM attendance a 
//              WHERE a.zk_id = ? 
//              ORDER BY a.log_date ASC, a.time_in DESC`,
//             [user.zk_id]
//         );
        
//         res.json({
//             success: true,
//             data: {
//                 user: {
//                     id: user.id,
//                     zk_id: user.zk_id,
//                     first_name: user.first_name,
//                     last_name: user.last_name,
//                     job_position: user.job_position,
//                     work_schedule_start: user.work_schedule_start,
//                     work_schedule_end: user.work_schedule_end,
//                     rest_day: user.rest_day,
//                     created_at: user.created_at
//                 },
//                 attendance: attendanceLogs
//             }
//         });
        
//     } catch (error) {
//         console.error('Error getting user attendance:', error);
//         res.status(500).json({ 
//             success: false,
//             error: 'Failed to fetch user attendance',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

exports.getUserAttendance = async (req, res) => {
    console.log('1. Request received', { params: req.params, query: req.query });
    const { userId } = req.params;
    const { year, month } = req.query;
    
    try {
        console.log('2. Fetching user...');
        const [user] = await query('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Calculate month boundaries
        const startDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
        const endDate = new Date(Date.UTC(parseInt(year), parseInt(month), 0)); // First day of the next month

        const formattedStartDate = toMYSQLDate(startDate);
        const formattedEndDate = toMYSQLDate(endDate);

        console.log('3. Date range:', { formattedStartDate, formattedEndDate });

        // Get attendance for the month
        console.log('4. Fetching attendance...');
        const attendance = await query(
            `SELECT * FROM attendance 
             WHERE zk_id = ? 
             AND log_date BETWEEN ? AND ? 
             ORDER BY log_date ASC`,
            [user.zk_id, formattedStartDate, formattedEndDate]
        );
        console.log('5. Found attendance records:', attendance.length);

        // Create map of attendance by date with consistent date string format (YYYY-MM-DD)
        const attendanceByDate = {};
        attendance.forEach(record => {
            // Convert database date to local date string
            const recordDate = new Date(record.log_date);
            const dateKey = toPHDateString(recordDate);
            attendanceByDate[dateKey] = record;
        });

        // Generate all dates in month
        const allDates = [];
        const current = new Date(startDate);

        while (current <= endDate) {
            const dateStr = toPHDateString(current);
            const isRest = isRestDay(current, user.rest_day);
            const holidayInfo = getHolidayInfo(current);
            const hasAttendance = !!attendanceByDate[dateStr];
            
            const dateData = {
                date: dateStr,
                is_rest_day: isRest,
                is_editable: !hasAttendance, // true if no attendance record exists
                schedule: `${formatTo12Hour(user.work_schedule_start)} - ${formatTo12Hour(user.work_schedule_end)}`,
                ...getHolidayInfo(current),
                ...(hasAttendance ? {
                    ...attendanceByDate[dateStr],
                    is_editable: false, // explicitly set to false for existing records
                    ...(calculateWorkHours(
                        attendanceByDate[dateStr].time_in,
                        attendanceByDate[dateStr].time_out,
                        user.work_schedule_start,
                        user.work_schedule_end
                    ) || {})
                } : {})
            };
        
            allDates.push(dateData);
            current.setDate(current.getDate() + 1);
        }

        const summary = calculateSummary(allDates);

        res.json({
            success: true,
            data: {
                user: {
                    // user details
                    id: user.id,
                    zk_id: user.zk_id,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    job_position: user.job_position,
                    work_schedule_start: user.work_schedule_start,
                    work_schedule_end: user.work_schedule_end
                },
                attendance: allDates,
                summary
            }
        });

    } catch (error) {
        console.error('Error in getUserAttendance:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Log attendance for users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
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
}

/**
 * Import attendance data from uploaded file
 * @param {Object} req - Express request object with file in req.file
 * @param {Object} res - Express response object
 */
/**
 * Import attendance data from uploaded file
 * @param {Object} req - Express request object with file in req.file
 * @param {Object} res - Express response object
 */
exports.importAttendance = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File received in memory:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
    });
    
    try {
        let data;
        if (req.file.mimetype.includes('excel') || 
            req.file.originalname.endsWith('.xlsx') || 
            req.file.originalname.endsWith('.xls')) {
            
            // Process Excel file
            console.log('Processing Excel file...');
            data = await processExcelFile(req.file.buffer);
            
        } else if (req.file.mimetype.includes('csv') || 
                  req.file.originalname.endsWith('.csv')) {
            
            // Process CSV file
            console.log('Processing CSV file...');
            data = await processCsvFile(req.file.buffer);
            
        } else {
            throw new Error('Unsupported file type. Please upload a CSV or Excel file.');
        }

        // Import data to database
        console.log(`Processing ${data.length} records...`);
        const { 
            insertedRows, 
            skippedRows, 
            errors, 
            totalProcessed,
            totalInserted,
            totalSkipped,
            totalFailed 
        } = await importToDatabase(data);
        
        // Determine status based on results
        let status = 'success';
        if (totalInserted === 0 && totalSkipped > 0) {
            status = 'warning';
        } else if (totalFailed > 0) {
            status = totalInserted > 0 ? 'partial' : 'error';
        }
        
        // Simple success message
        const message = 'Import process successful';
        
        // Build response with counts
        const response = {
            success: status !== 'error',
            status,
            filename: req.file.originalname,
            inserted: totalInserted,
            skipped: totalSkipped,
            failed: totalFailed,
            total: totalProcessed,
            message
        };
        
        // Include errors for debugging if any
        if (errors.length > 0) {
            response.errors = errors;
        }
        
        return res.json(response);
        
    } catch (error) {
        console.error('Error processing file:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Error processing file',
            message: error.message,
            inserted: 0,
            failed: 0
        });
    }
}

/**
 * Add a new attendance record manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.addAttendanceRecord = async (req, res) => {
    const connection = await getPool().getConnection();
    try {
        const { zk_id, date, time_in, time_out } = req.body;
        const is_reliever = 1;
        
        // Validate required fields
        if (!zk_id || !date || !time_in) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: zk_id, date, and time_in are required',
            });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid date format. Please use YYYY-MM-DD',
            });
        }

        // Validate time format (HH:MM or HH:MM:SS)
        const timeRegex = /^\d{2}:\d{2}(?::\d{2})?$/;
        if (!timeRegex.test(time_in) || (time_out && !timeRegex.test(time_out))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid time format. Please use HH:MM or HH:MM:SS',
            });
        }

        // Insert the attendance record
        const [result] = await connection.query(
            `INSERT INTO attendance 
             (zk_id, log_date, time_in, time_out, is_reliever, log_type) 
             VALUES (?, ?, ?, ?, 1, 1)`,
            [zk_id, date, time_in, time_out, is_reliever]
        );

        res.status(201).json({
            success: true,
            message: 'Attendance record added successfully',
            data: {
                id: result.insertId
            }
        });
    } catch (error) {
        console.error('Error adding attendance record:', error);
        
        // Handle duplicate entry error
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'An attendance record already exists for this user and date',
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to add attendance record',
            error: error.message,
        });
    } finally {
        connection.release();
    }
};

// Export helper functions for testing (only in development)
if (process.env.NODE_ENV === 'test') {
    module.exports._test = {
        formatExcelRow,
        processCsvFile,
        processExcelFile,
        importToDatabase,
        generateResultMessage
    };
}