// src/utils/controllers/attendance/attendanceHelper.js
const Holidays = require('date-holidays');
const hd = new Holidays('PH'); // Philippines holidays

exports.calculateWorkHours = (timeIn, timeOut, scheduleStart, scheduleEnd) => {
    if (!timeIn || !timeOut || !scheduleStart) {
        return null;
    }

    // Helper function to convert time string to minutes
    const timeToMinutes = (timeStr) => {
        // Handle 12-hour format (e.g., "8:00 AM")
        if (typeof timeStr === 'string' && (timeStr.includes('AM') || timeStr.includes('am') || 
                                           timeStr.includes('PM') || timeStr.includes('pm'))) {
            const [time, period] = timeStr.split(' ');
            let [hours, minutes = 0] = time.split(':').map(Number);
            
            if (period) {
                const periodUpper = period.toUpperCase();
                if (periodUpper === 'PM' && hours < 12) hours += 12;
                if (periodUpper === 'AM' && hours === 12) hours = 0;
            }
            
            return hours * 60 + minutes;
        }
        
        // Handle 24-hour format (e.g., "08:00" or "16:00")
        const [hours, minutes = 0] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    };

    try {
        const timeInMins = timeToMinutes(timeIn);
        let timeOutMins = timeToMinutes(timeOut);
        const schedStartMins = timeToMinutes(scheduleStart);
        const schedEndMins = scheduleEnd ? timeToMinutes(scheduleEnd) : schedStartMins + (9 * 60);

        // Handle overnight work (if timeOut is next day)
        if (timeOutMins < timeInMins) {
            timeOutMins += 24 * 60;
        }

        // Total worked minutes
        let totalMinutes = timeOutMins - timeInMins;
        if (totalMinutes < 0) totalMinutes += 24 * 60;

        // NT (Number of Time) in hours
        const nt = totalMinutes / 60;

        // OT (Overtime) - Time worked after scheduled end time
        const adjustedSchedEndMins = schedEndMins > schedStartMins ? schedEndMins : schedEndMins + (24 * 60);
        const otMinutes = Math.max(0, timeOutMins - adjustedSchedEndMins);
        const ot = otMinutes / 60;

        // UT (Undertime) - Less than scheduled hours
        const scheduledHours = (adjustedSchedEndMins - schedStartMins) / 60;
        const ut = Math.max(0, scheduledHours - nt);

        // LT (Late Time) - Arrival after schedule start
        const lt = Math.max(0, timeInMins - schedStartMins) / 60;

        // ND (Night Differential) - Work between 10PM to 6AM
        let ndMinutes = 0;
        for (let m = timeInMins; m < timeOutMins; m++) {
            const currentHour = (Math.floor(m / 60)) % 24;
            if (currentHour >= 22 || currentHour < 6) {
                ndMinutes++;
            }
        }
        const nd = ndMinutes / 60;

        const result = {
            nt: parseFloat(nt.toFixed(2)),
            ut: parseFloat(ut.toFixed(2)),
            ot: parseFloat(ot.toFixed(2)),
            lt: parseFloat(lt.toFixed(2)),
            nd: parseFloat(nd.toFixed(2))
        };

        return result;

    } catch (error) {
        return null;
    }
};

exports.toMYSQLDateTime = (date) => {
    return date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}

exports.toMYSQLDate = (date) => {
    return date.toISOString().split("T")[0];
}

// Add this helper function near the top of the file
exports.formatTo12Hour = (time24) => {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = ((hours + 11) % 12 + 1);
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
};

// Check if a date is a rest day
exports.isRestDay = (date, restDay) => {
    const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 1 = Monday, etc.
    // Convert rest day string to day number (assuming format like "Sunday" or "0")
    const restDayNumber = isNaN(restDay) 
        ? ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
            .indexOf(restDay.toLowerCase())
        : parseInt(restDay, 10);
    
    return dayOfWeek === restDayNumber;
};

// Check if a date is a holiday
exports.getHolidayInfo = (date) => {
    const holiday = hd.isHoliday(new Date(date));
    if (!holiday) return { is_holiday: false }; // Always return an object with is_holiday
    
    return {
        is_holiday: true,
        holiday_name: holiday.name || 'Holiday',
        holiday_type: holiday.type || 'public'
    };
};

// Calculate work schedule duration in hours
exports.getScheduleHours = (start, end) => {
    console.log('getScheduleHours called with:', { start, end });
    
    if (!start || !end) {
        console.error('Missing start or end time');
        return 0;
    }

    try {
        // Helper function to convert 12h to 24h format
        const parseTime = (timeStr) => {
            let [time, period] = timeStr.split(' ');
            let [hours, minutes] = time.split(':').map(Number);
            
            if (period && period.toUpperCase() === 'PM' && hours < 12) {
                hours += 12;
            } else if (period && period.toUpperCase() === 'AM' && hours === 12) {
                hours = 0;
            }
            
            return { hours, minutes: minutes || 0 };
        };
        
        const startTime = parseTime(start);
        const endTime = parseTime(end);
        
        console.log('Parsed times:', { startTime, endTime });
        
        let totalHours = endTime.hours - startTime.hours;
        totalHours += (endTime.minutes - startTime.minutes) / 60;
        
        // Handle overnight shifts
        if (totalHours < 0) totalHours += 24;
        
        console.log('Calculated total hours:', totalHours);
        return totalHours;
    } catch (error) {
        console.error('Error in getScheduleHours:', error.message);
        console.error('Input values:', { start, end });
        return 8; // Default to 8 hours if there's an error
    }
};

exports.calculateSummary = (attendanceData) => {
    
    return attendanceData.reduce((summary, day) => {
        // Parse schedule from string like "08:00 - 16:00"
        let work_schedule_start = '09:00'; // Default values
        let work_schedule_end = '18:00';
        let basic_rate = 513.00;
        
        if (day.schedule && day.schedule.includes('-')) {
            [work_schedule_start, work_schedule_end] = day.schedule
                .split('-')
                .map(s => s.trim());
        }

        if (day.time_in) {
            const workHours = this.calculateWorkHours(
                day.time_in,
                day.time_out || '00:00',
                work_schedule_start,
                work_schedule_end
            );

            if (workHours) {
                // Calculate hourly rate if not already set
                // Calculate hourly rate if not already set
                if (!summary.reg_hrs) {
                    const scheduleHours = this.getScheduleHours(work_schedule_start, work_schedule_end);
                    summary.reg_hrs = parseFloat((basic_rate / scheduleHours).toFixed(2));
                }
                summary.total_hours_worked += workHours.nt || 0;
                summary.regular_ot = parseFloat((summary.regular_ot + parseFloat(workHours.ot || 0)).toFixed(2));
                summary.total_late_time += workHours.lt || 0;
                summary.total_undertime += workHours.ut || 0;
                summary.total_night_diff += workHours.nd || 0;
                summary.worked_days++;

                // Count work on rest days
                if (day.is_rest_day) {
                    summary.rest_days_worked++;
                }

                // Count work on holidays
                if (day.is_holiday) {
                    if (day.holiday_type === 'regular') {
                        summary.regular_holidays_worked++;
                    } else {
                        summary.special_holidays_worked++;
                    }
                }
            }
        }

        // Count all rest days and holidays in period
        if (day.is_rest_day) {
            summary.total_rest_days++;
        }
        if (day.is_holiday) {
            if (day.holiday_type === 'regular') {
                summary.total_regular_holidays++;
            } else {
                summary.total_special_holidays++;
            }
        }

        return summary;
    }, {
        // Initialize summary object
        reg_hrs: 0,
        worked_days: 0,
        total_hours_worked: 0,
        regular_ot: 0,
        rest_days_worked: 0,
        total_rest_days: 0,
        total_late_time: 0,
        total_undertime: 0,
        total_night_diff: 0,
        regular_holidays_worked: 0,
        special_holidays_worked: 0,
        total_regular_holidays: 0,
        total_special_holidays: 0
    });
};
