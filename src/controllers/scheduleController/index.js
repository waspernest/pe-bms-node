const { getPool } = require('../../mysql');

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

exports.getAllSchedules = async (req, res) => {
    try {
        // Get page number from query params, default to 1 if not provided
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // Number of records per page
        const offset = (page - 1) * limit;

        // Get total count of records
        const [totalResult] = await query('SELECT COUNT(*) as total FROM schedule');
        const total = totalResult.total;
        const totalPages = Math.ceil(total / limit);

        // Get paginated results
        const schedules = await query(
            'SELECT * FROM schedule ORDER BY id DESC LIMIT ? OFFSET ?',
            [limit, offset]
        );

        res.json({ 
            success: true, 
            data: schedules,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: total,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch schedules',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getScheduleAssoc = async (req, res) => {
    try {
        const { sid, month, year } = req.params;
        
        // Ensure month and year are numbers
        const monthNum = parseInt(month, 10);
        const yearNum = parseInt(year, 10);
        
        // Create date in local timezone to avoid timezone issues
        const firstDay = new Date(yearNum, monthNum - 1, 1);
        const lastDay = new Date(yearNum, monthNum, 0);
        
        // Format: YYYY-MM-DD (using local time)
        const formatDate = (date) => {
            const d = new Date(date);
            // Use local date components to avoid timezone conversion
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        // Generate all days of the month
        const allDays = [];
        const currentDate = new Date(firstDay);
        
        // Iterate through each day of the month
        while (currentDate.getMonth() === monthNum - 1) {
            const dateStr = formatDate(currentDate);
            allDays.push({
                date: dateStr,
                day: currentDate.getDate(),
                dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long' }),
                month: monthNum - 1, // 0-indexed for frontend
                year: yearNum,
                hasSchedule: false,
                schedule: null
            });
            
            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // Get schedules for the month using the same date format
        const startDate = formatDate(firstDay);
        const endDate = formatDate(lastDay);
        
        console.log('Fetching schedules for date range:', { startDate, endDate });
        
        const schedules = await query(
            'SELECT * FROM schedule_assoc WHERE sid = ? AND schedule_date BETWEEN ? AND ? ORDER BY schedule_date', 
            [sid, startDate, endDate]
        );
        
        console.log('Found schedules:', schedules.length);
        
        // Create a map of schedules by date for faster lookup
        const scheduleMap = new Map();
        schedules.forEach(schedule => {
            // Use the same formatDate function to ensure consistent formatting
            const dateKey = formatDate(new Date(schedule.schedule_date));
            scheduleMap.set(dateKey, schedule);
        });
        
        // Merge schedules with the days array
        const daysWithSchedules = allDays.map(day => {
            const schedule = scheduleMap.get(day.date);
            
            if (schedule) {
                return {
                    ...day,
                    hasSchedule: true,
                    schedule: {
                        id: schedule.id,
                        startTime: schedule.work_schedule_start,
                        endTime: schedule.work_schedule_end,
                        status: schedule.status || 'pending'
                    }
                };
            }
            
            return day;
        });
        
        res.json({ 
            success: true, 
            data: daysWithSchedules,
            month: month - 1, // 0-indexed for frontend
            year: parseInt(year)
        });
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch schedule',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete a schedule by ID
exports.deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if schedule exists
    const [schedule] = await query('SELECT * FROM schedule WHERE id = ?', [id]);
    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }
    
    // Delete the schedule
    await query('DELETE FROM schedule WHERE id = ?', [id]);
    
    res.json({ success: true, message: 'Schedule deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete schedule',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getSchedules = async (req, res) => {
  try {
    // Query to get all schedules with their associated sids
    const queryStr = `
      SELECT s.*, sa.sid
      FROM schedule s
      INNER JOIN schedule_assoc sa ON s.id = sa.schedule_id
      ORDER BY s.created_at DESC
    `;

    const schedules = await query(queryStr);

    res.json({
      success: true,
      data: schedules
    });

  } catch (error) {
    console.error('Error fetching user schedules:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch schedules',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.addSchedule = async (req, res) => {
    try {
        const { name } = req.body;
        
        // Input validation
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                error: 'Schedule name is required and must be a non-empty string' 
            });
        }

        // Execute the query without destructuring the result
        const result = await query(
            'INSERT INTO schedule (name) VALUES (?)',
            [name.trim()]
        );
        
        // Check if the insert was successful
        if (result.affectedRows === 1) {
            return res.json({ 
                success: true, 
                message: 'Schedule created successfully',
                scheduleId: result.insertId
            });
        } else {
            throw new Error('Failed to create schedule');
        }
    } catch (error) {
        console.error('Error creating schedule:', error);
        const statusCode = error.code === 'ER_DUP_ENTRY' ? 409 : 500;
        res.status(statusCode).json({ 
            success: false, 
            error: error.message || 'Internal server error' 
        });
    }
};

exports.setSchedule = async (req, res) => {
    try {
        const { id: sid } = req.params;
        const { schedule_date, work_schedule_start, work_schedule_end } = req.body;
        
        // Input validation
        if (!sid || !schedule_date || !work_schedule_start || !work_schedule_end) {
            return res.status(400).json({ 
                success: false, 
                error: 'All fields are required: sid, schedule_date, work_schedule_start, and work_schedule_end' 
            });
        }
        
        // First, check if a schedule exists for this date and time range
        const [existingSchedule] = await query(
            'SELECT sid FROM schedule_assoc WHERE sid = ? AND schedule_date = ?',
            [sid, schedule_date]
        );

        let result;
        
        if (existingSchedule) {
            // Update existing schedule
            result = await query(
                'UPDATE schedule_assoc SET work_schedule_start = ?, work_schedule_end = ? WHERE sid = ? AND schedule_date = ?',
                [work_schedule_start, work_schedule_end, sid, schedule_date]
            );
        } else {
            // Insert new schedule
            result = await query(
                'INSERT INTO schedule_assoc (schedule_date, work_schedule_start, work_schedule_end, sid) VALUES (?, ?, ?, ?)',
                [schedule_date, work_schedule_start, work_schedule_end, sid]
            );
        }
        
        // Check if the operation was successful
        if (result.affectedRows === 1) {
            return res.json({ 
                success: true, 
                message: existingSchedule ? 'Schedule updated successfully' : 'Schedule created successfully',
                sid: existingSchedule ? existingSchedule.sid : result.insertId
            });
        } else {
            throw new Error('Failed to save schedule');
        }
    } catch (error) {
        console.error('Error updating schedule:', error);
        const statusCode = error.code === 'ER_DUP_ENTRY' ? 409 : 500;
        res.status(statusCode).json({ 
            success: false, 
            error: error.message || 'Internal server error' 
        });
    }
};