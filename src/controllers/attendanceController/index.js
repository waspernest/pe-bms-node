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

const { 
    processExcelFile, 
    processCsvFile, 
    processDatFile,
    importToDatabase 
} = require('./importHandler');

/**
 * Convert date to local timezone format for database storage
 * @private
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {string} Date string in database format
 */
const convertToLocalDate = (dateStr) => {
    if (!dateStr) return null;

    // If it's already in YYYY-MM-DD format, return as is
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }

    // Convert to local date string
    const date = new Date(dateStr);
    return toMYSQLDate(date);
};
const query = async (sql, params = []) => {
    const connection = await getPool().getConnection();
    try {
        const [results] = await connection.query(sql, params);
        return results;
    } finally {
    }
};

/**
 * Format date to Philippine timezone
 * @private
 * @param {Date} date - Date object
 * @returns {string} Formatted date string in YYYY-MM-DD format
 */
const toPHDateString = (date) => {
    if (!date) return null;

    // Create date object from input
    const d = utcToZonedTime(date, timeZone);

    // Get date components in local time
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    // Return in YYYY-MM-DD format
    return `${year}-${month}-${day}`;
};

/**
{{ ... }}
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
                SELECT a.*, u.first_name, u.last_name, u.department 
                FROM attendance a
                LEFT JOIN users u ON a.zk_id = u.zk_id
                ${whereClause}
                ORDER BY a.log_date DESC
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

exports.getUserAttendance = async (req, res) => {
    console.log('1. Request received', { params: req.params, query: req.query });
    const { userId } = req.params;
    const { year, month, period = 'all' } = req.query;

    try {
        console.log('2. Fetching user...');
        console.log('2. Query params:', { userId, year, month, period });

        // Validate input parameters
        if (!userId || !year || !month) {
            console.error('Missing required parameters:', { userId, year, month });
            return res.status(400).json({ error: 'Missing required parameters: userId, year, month' });
        }

        const [user] = await query('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) {
            console.error('User not found:', { userId });
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('2. User found:', { userId: user.id, zkId: user.zk_id });

        // Calculate month boundaries based on period
        const yearNum = parseInt(year);
        const monthNum = parseInt(month) - 1; // JavaScript months are 0-indexed

        console.log('3. Calculating date range:', { yearNum, monthNum, period });

        // Validate date parameters
        if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 0 || monthNum > 11) {
            console.error('Invalid date parameters:', { yearNum, monthNum });
            return res.status(400).json({ error: 'Invalid year or month parameters' });
        }

        let startDate, endDate, formattedStartDate, formattedEndDate;

        try {
            if (period === 'first') {
                // First half: 1st to 15th
                startDate = new Date(Date.UTC(yearNum, monthNum, 1));
                endDate = new Date(Date.UTC(yearNum, monthNum, 15));
            } else if (period === 'second') {
                // Second half: 16th to end of month
                startDate = new Date(Date.UTC(yearNum, monthNum, 16));
                endDate = new Date(Date.UTC(yearNum, monthNum + 1, 0)); // Last day of month
            } else {
                // Default to full month
                startDate = new Date(Date.UTC(yearNum, monthNum, 1));
                endDate = new Date(Date.UTC(yearNum, monthNum + 1, 0));
            }

            console.log('3. Date objects created:', {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            });

            // Validate dates
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                console.error('Invalid date objects created:', { startDate, endDate });
                return res.status(400).json({ error: 'Invalid date range calculated' });
            }

            formattedStartDate = toMYSQLDate(startDate);
            formattedEndDate = toMYSQLDate(endDate);

            console.log('3. Date range:', {
                startDate: formattedStartDate,
                endDate: formattedEndDate,
                period
            });

            // Validate formatted dates
            if (!formattedStartDate || !formattedEndDate) {
                console.error('Failed to format dates:', { startDate, endDate });
                return res.status(500).json({ error: 'Failed to format date range' });
            }
        } catch (dateError) {
            console.error('Error calculating date range:', dateError);
            return res.status(500).json({ error: 'Error calculating date range', details: dateError.message });
        }

        // Get attendance for the month
        console.log('4. Fetching attendance...');
        let attendance;
        try {
            attendance = await query(
                `SELECT * FROM attendance
                 WHERE zk_id = ?
                 AND log_date BETWEEN ? AND ?
                 ORDER BY log_date ASC`,
                [user.zk_id, formattedStartDate, formattedEndDate]
            );
            console.log('5. Found attendance records:', attendance.length);
        } catch (queryError) {
            console.error('Error fetching attendance:', queryError);
            return res.status(500).json({
                error: 'Failed to fetch attendance records',
                details: queryError.message
            });
        }

        // Create map of attendance by date with consistent date string format (YYYY-MM-DD)
        const attendanceByDate = {};
        try {
            attendance.forEach(record => {
                // Convert database date to local date string - handle UTC to local timezone conversion
                // The log_date is stored in UTC, but we want to display it in local timezone
                const recordDate = new Date(record.log_date);
                // Get date components in UTC to avoid timezone conversion issues
                const year = recordDate.getUTCFullYear();
                const month = String(recordDate.getUTCMonth() + 1).padStart(2, '0');
                const day = String(recordDate.getUTCDate()).padStart(2, '0');

                // Use UTC date components to create consistent date key
                const dateKey = `${year}-${month}-${day}`;
                attendanceByDate[dateKey] = record;
            });
        } catch (mapError) {
            console.error('Error mapping attendance records:', mapError);
            return res.status(500).json({
                error: 'Failed to process attendance records',
                details: mapError.message
            });
        }

        // Generate all dates in month
        const allDates = [];
        try {
            const current = new Date(startDate);

            while (current <= endDate) {
                // Get date components in UTC to match database storage
                const year = current.getUTCFullYear();
                const month = String(current.getUTCMonth() + 1).padStart(2, '0');
                const day = String(current.getUTCDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                const isRest = isRestDay(current, user.rest_day);
                const holidayInfo = getHolidayInfo(current);
                const hasAttendance = !!attendanceByDate[dateStr];

                // Calculate work hours for the day if attendance exists
                const workHours = hasAttendance
                    ? calculateWorkHours(
                        attendanceByDate[dateStr].time_in,
                        attendanceByDate[dateStr].time_out,
                        user.work_schedule_start,
                        user.work_schedule_end
                      ) || {}
                    : {};

                const dateData = {
                    date: dateStr,
                    is_rest_day: isRest,
                    is_editable: true, // alwasy set to true for now
                    is_holiday: holidayInfo.isHoliday,
                    holiday_type: holidayInfo.type,
                    schedule: `${formatTo12Hour(user.work_schedule_start)} - ${formatTo12Hour(user.work_schedule_end)}`,
                    // Map work hours to the expected property names
                    work_hours: workHours.nt || 0,
                    overtime: workHours.ot || 0,
                    late: workHours.lt || 0,
                    undertime: workHours.ut || 0,
                    night_diff: workHours.nd || 0,
                    ...(hasAttendance ? {
                        ...attendanceByDate[dateStr],
                        is_editable: true,
                        ...workHours
                    } : {})
                };

                allDates.push(dateData);
                current.setUTCDate(current.getUTCDate() + 1);
            }
        } catch (loopError) {
            console.error('Error generating date list:', loopError);
            return res.status(500).json({
                error: 'Failed to generate attendance date list',
                details: loopError.message
            });
        }

        // For summary, include all days that have attendance data
        // We'll check for existence of any attendance-related fields
        const daysWithAttendance = allDates.filter(day => {
            // Check if this day has any attendance data
            const hasAttendanceData = attendanceByDate[day.date] && (
                attendanceByDate[day.date].time_in ||
                attendanceByDate[day.date].time_out ||
                day.work_hours > 0 ||
                day.overtime > 0 ||
                day.late > 0 ||
                day.undertime > 0
            );
            return hasAttendanceData;
        });

        console.log('Days with attendance data:', daysWithAttendance.length);

        let summary;
        try {
            summary = calculateSummary(daysWithAttendance, {
                scheduleStart: user.work_schedule_start,
                scheduleEnd: user.work_schedule_end
            });
        } catch (summaryError) {
            console.error('Error calculating summary:', summaryError);
            return res.status(500).json({
                error: 'Failed to calculate attendance summary',
                details: summaryError.message
            });
        }

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
                    department: user.department,
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
            
            // Convert log_date to proper local timezone format
            const localLogDate = convertToLocalDate(log_date);
            
            try {
                // Find all attendance records for this user on this date
                const recordsResult = await query(
                    `SELECT id, time_in, time_out 
                     FROM attendance 
                     WHERE zk_id = ? AND log_date = ?
                     ORDER BY time_in`,
                    [zk_id, localLogDate]
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
                            [zk_id, localLogDate, time]
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
exports.importAttendance = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File received in memory:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        bufferLength: req.file.buffer ? req.file.buffer.length : 0
    });
    
    try {
        let data;
        console.log('Starting file processing...');
        
        if (req.file.mimetype.includes('excel') || 
            req.file.originalname.endsWith('.xlsx') || 
            req.file.originalname.endsWith('.xls')) {
            
            console.log('Processing as Excel file...');
            data = await processExcelFile(req.file.buffer);
            
        } else if (req.file.mimetype.includes('csv') || 
                  req.file.originalname.endsWith('.csv')) {
            
            console.log('Processing as CSV file...');
            data = await processCsvFile(req.file.buffer);
            
        } else if (req.file.mimetype.includes('octet-stream') || 
                 req.file.originalname.endsWith('.dat')) {
            
            console.log('Processing as DAT file...');
            try {
                data = await processDatFile(req.file.buffer);
                console.log(`Successfully parsed DAT file. Found ${data ? data.length : 0} records.`);
                if (data && data.length > 0) {
                    console.log('First record sample:', JSON.stringify(data[0]));
                }
            } catch (error) {
                console.error('Error processing DAT file:', error);
                throw new Error(`Failed to process DAT file: ${error.message}`);
            }
            
        } else {
            throw new Error('Unsupported file type. Please upload a CSV, Excel, or DAT file.');
        }

        if (!data || !Array.isArray(data)) {
            console.error('Invalid data format after parsing:', data);
            throw new Error('Failed to parse file data');
        }

        // Department-aware remapping: if department is Utility or Operation,
        // treat incoming zk_id as possibly an old_zk_id and remap to current zk_id
        let remappedCount = 0;
        let skippedUnknownOldId = 0;
        const dept = (department || '').toString().trim().toLowerCase();
        const needsOldIdRemap = dept === 'utility' || dept === 'operation';

        if (needsOldIdRemap) {
            console.log('Department requires old_zk_id remapping. Building mapping from users table...');
            // Collect unique candidate IDs from data (only if zk_id present)
            const candidateIds = Array.from(new Set(
                data
                    .map(r => (r && r.zk_id != null ? String(r.zk_id).trim() : ''))
                    .filter(Boolean)
            ));

            let oldToNew = new Map();
            let currentIds = new Set();

            if (candidateIds.length > 0) {
                // Build dynamic placeholders for IN clause
                const placeholders = candidateIds.map(() => '?').join(',');
                try {
                    // Query users for both matches: either current zk_id or old_zk_id
                    const rows = await query(
                        `SELECT zk_id AS current_zk_id, old_zk_id
                         FROM users
                         WHERE (old_zk_id IS NOT NULL AND old_zk_id IN (${placeholders}))
                            OR (zk_id IN (${placeholders}))`,
                        [...candidateIds, ...candidateIds]
                    );

                    for (const u of rows) {
                        if (u && u.current_zk_id) currentIds.add(String(u.current_zk_id).trim());
                        if (u && u.old_zk_id) oldToNew.set(String(u.old_zk_id).trim(), String(u.current_zk_id).trim());
                    }
                    console.log(`Remap candidates: ${candidateIds.length}, current matches: ${currentIds.size}, old->new mappings: ${oldToNew.size}`);
                } catch (e) {
                    console.error('Error building old_zk_id mapping:', e);
                }

                // Transform rows: keep if matches current zk_id; remap if matches old_zk_id; otherwise skip
                const transformed = [];
                for (const row of data) {
                    if (!row || row.zk_id == null) {
                        transformed.push(row); // let downstream validation handle
                        continue;
                    }
                    const rawId = String(row.zk_id).trim();
                    if (currentIds.has(rawId)) {
                        transformed.push(row); // already current
                        continue;
                    }
                    if (oldToNew.has(rawId)) {
                        const newId = oldToNew.get(rawId);
                        transformed.push({ ...row, zk_id: newId });
                        remappedCount++;
                    } else {
                        // Unknown old ID; skip this row to avoid bad inserts
                        skippedUnknownOldId++;
                        // Do not include; alternatively, include with marker to skip in import
                    }
                }
                data = transformed;
                console.log(`After remapping: remapped=${remappedCount}, skipped_unknown_old_id=${skippedUnknownOldId}, remaining=${data.length}`);
            }
        }

        console.log(`Processing ${data.length} records for database import...`);
        const { 
            insertedRows, 
            skippedRows, 
            errors, 
            totalProcessed,
            totalInserted,
            totalSkipped,
            totalFailed 
        } = await importToDatabase(data);
        
        console.log('Database import completed:', {
            totalProcessed,
            totalInserted,
            totalSkipped,
            totalFailed
        });
        
        // Determine status based on results
        let status = 'success';
        if (totalInserted === 0 && totalSkipped > 0) {
            status = 'warning';
        } else if (totalFailed > 0) {
            status = totalInserted > 0 ? 'partial' : 'error';
        }
        
        const message = status === 'success' ? 'Import completed successfully' : 
                       status === 'warning' ? 'Import completed with warnings' :
                       status === 'partial' ? 'Import partially completed' :
                       'Import failed';
        
        // Build response with counts
        const response = {
            success: status !== 'error',
            status,
            filename: req.file.originalname,
            inserted: totalInserted,
            skipped: totalSkipped,
            failed: totalFailed,
            total: totalProcessed,
            message,
            // Extra metrics for department-based remapping
            department_used_for_mapping: needsOldIdRemap ? dept : undefined,
            remapped_from_old_zk_id: needsOldIdRemap ? remappedCount : undefined,
            skipped_due_to_unknown_old_id: needsOldIdRemap ? skippedUnknownOldId : undefined
        };
        
        // Include errors for debugging if any
        if (errors.length > 0) {
            console.error('Import completed with errors:', errors);
            response.errors = errors;
        }
        
        console.log('Sending response:', JSON.stringify(response, null, 2));
        return res.json(response);
        
    } catch (error) {
        console.error('Error processing file:', {
            message: error.message,
            stack: error.stack,
            fileInfo: req.file ? {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            } : 'No file data'
        });
        
        return res.status(500).json({ 
            success: false, 
            error: 'Error processing file',
            message: error.message,
            inserted: 0,
            failed: 0,
            filename: req.file ? req.file.originalname : 'unknown'
        });
    }
}

exports.importAttendanceNew = async (req, res) => {

    const { department } = req.body;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File received in memory:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        bufferLength: req.file.buffer ? req.file.buffer.length : 0
    });
    
    try {
        let data;
        console.log('Starting file processing...');
        
        if (req.file.mimetype.includes('excel') || 
            req.file.originalname.endsWith('.xlsx') || 
            req.file.originalname.endsWith('.xls')) {
            
            console.log('Processing as Excel file...');
            data = await processExcelFile(req.file.buffer);
            
        } else if (req.file.mimetype.includes('csv') || 
                  req.file.originalname.endsWith('.csv')) {
            
            console.log('Processing as CSV file...');
            data = await processCsvFile(req.file.buffer);
            
        } else if (req.file.mimetype.includes('octet-stream') || 
                 req.file.originalname.endsWith('.dat')) {
            
            console.log('Processing as DAT file...');
            try {
                data = await processDatFile(req.file.buffer);
                console.log(`Successfully parsed DAT file. Found ${data ? data.length : 0} records.`);
                if (data && data.length > 0) {
                    console.log('First record sample:', JSON.stringify(data[0]));
                }
            } catch (error) {
                console.error('Error processing DAT file:', error);
                throw new Error(`Failed to process DAT file: ${error.message}`);
            }
            
        } else {
            throw new Error('Unsupported file type. Please upload a CSV, Excel, or DAT file.');
        }

        if (!data || !Array.isArray(data)) {
            console.error('Invalid data format after parsing:', data);
            throw new Error('Failed to parse file data');
        }

        console.log(`Processing ${data.length} records for database import...`);
        const { 
            insertedRows, 
            skippedRows, 
            errors, 
            totalProcessed,
            totalInserted,
            totalSkipped,
            totalFailed 
        } = await importToDatabase(data);
        
        console.log('Database import completed:', {
            totalProcessed,
            totalInserted,
            totalSkipped,
            totalFailed
        });
        
        // Determine status based on results
        let status = 'success';
        if (totalInserted === 0 && totalSkipped > 0) {
            status = 'warning';
        } else if (totalFailed > 0) {
            status = totalInserted > 0 ? 'partial' : 'error';
        }
        
        const message = status === 'success' ? 'Import completed successfully' : 
                       status === 'warning' ? 'Import completed with warnings' :
                       status === 'partial' ? 'Import partially completed' :
                       'Import failed';
        
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
            console.error('Import completed with errors:', errors);
            response.errors = errors;
        }
        
        console.log('Sending response:', JSON.stringify(response, null, 2));
        return res.json(response);
        
    } catch (error) {
        console.error('Error processing file:', {
            message: error.message,
            stack: error.stack,
            fileInfo: req.file ? {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            } : 'No file data'
        });
        
        return res.status(500).json({ 
            success: false, 
            error: 'Error processing file',
            message: error.message,
            inserted: 0,
            failed: 0,
            filename: req.file ? req.file.originalname : 'unknown'
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

/**
 * Delete an attendance record manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */


/**
 * Update an existing attendance record
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateAttendanceRecord = async (req, res) => {
    const connection = await getPool().getConnection();
    await connection.beginTransaction();
    
    try {
        const { id } = req.params;
        const { time_in, time_out, schedule_start, schedule_end } = req.body;
        
        // Validate required fields
        if (!time_in) {
            return res.status(400).json({
                success: false,
                message: 'time_in is required',
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

        // Check if the record exists
        const [existingRecord] = await connection.query(
            'SELECT * FROM attendance WHERE id = ?',
            [id]
        );

        if (!existingRecord || existingRecord.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found',
            });
        }

        // Prepare update fields
        const updateFields = [];
        const params = [];

        if (time_in) {
            updateFields.push('time_in = ?');
            params.push(time_in);
        }
        
        if (time_out !== undefined) {
            updateFields.push('time_out = ?');
            params.push(time_out || null);
        }

        if (schedule_start) {
            updateFields.push('schedule_start = ?');
            params.push(schedule_start);
        }

        if (schedule_end) {
            updateFields.push('schedule_end = ?');
            params.push(schedule_end);
        }

        // Add updated_at timestamp
        updateFields.push('updated_at = NOW()');

        // Add id to params for WHERE clause
        params.push(id);

        // Update the record
        const [result] = await connection.query(
            `UPDATE attendance 
             SET ${updateFields.join(', ')} 
             WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            throw new Error('Failed to update attendance record');
        }

        // Get the updated record
        const [updatedRecord] = await connection.query(
            'SELECT * FROM attendance WHERE id = ?',
            [id]
        );

        await connection.commit();
        
        return res.status(200).json({
            success: true,
            message: 'Attendance record updated successfully',
            data: updatedRecord[0]
        });

    } catch (error) {
        console.error('Error updating attendance record:', error);
        await connection.rollback();
        return res.status(500).json({
            success: false,
            message: 'Failed to update attendance record',
            error: error.message
        });

    } finally {
        connection.release();
    }
};

/**
 * Delete an attendance record manually
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.deleteAttendanceRecordManual = async (req, res) => {
    const connection = await getPool().getConnection();
    try {
        const { zk_id, date, time_in } = req.body;

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
        if (!timeRegex.test(time_in)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid time format. Please use HH:MM or HH:MM:SS',
            });
        }

        // Convert date to proper local timezone format
        const localLogDate = convertToLocalDate(date);

        // Find the record to delete
        const [existingRecord] = await connection.query(
            'SELECT id, time_in, time_out FROM attendance WHERE zk_id = ? AND log_date = ? AND time_in = ?',
            [zk_id, localLogDate, time_in]
        );

        if (!existingRecord || existingRecord.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found',
            });
        }

        const record = existingRecord[0];

        // Delete the record
        const [result] = await connection.query(
            'DELETE FROM attendance WHERE id = ?',
            [record.id]
        );

        if (result.affectedRows === 0) {
            throw new Error('Failed to delete attendance record');
        }

        res.status(200).json({
            success: true,
            message: 'Attendance record deleted successfully',
            data: {
                id: record.id,
                zk_id: zk_id,
                date: date,
                time_in: time_in,
                time_out: record.time_out
            }
        });
    } catch (error) {
        console.error('Error deleting attendance record manually:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete attendance record',
            error: error.message
        });
    } finally {
        connection.release();
    }
};
exports.deleteAttendanceRecord = async (req, res) => {
    const connection = await getPool().getConnection();
    try {
        const { id } = req.params;
        
        // Validate required fields
        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Record ID is required',
            });
        }

        // Check if the record exists
        const [existingRecord] = await connection.query(
            'SELECT * FROM attendance WHERE id = ?',
            [id]
        );

        if (!existingRecord || existingRecord.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found',
            });
        }

        // Delete the record
        const [result] = await connection.query(
            'DELETE FROM attendance WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            throw new Error('Failed to delete attendance record');
        }

        res.status(200).json({
            success: true,
            message: 'Attendance record deleted successfully',
            data: {
                id: parseInt(id)
            }
        });
    } catch (error) {
        console.error('Error deleting attendance record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete attendance record',
            error: error.message
        });
    } finally {
        connection.release();
    }
};