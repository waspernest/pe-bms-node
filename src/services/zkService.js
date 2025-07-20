// services/zkService.js
const ZKLib = require('zkh-lib');
const fs = require('fs').promises;
const path = require('path');

const zk = new ZKLib('192.168.254.201', 4370, 10000, 4000);
const TIMESTAMP_FILE = path.join(__dirname, '../../.last_timestamp');

let lastTimestamp = null;

// Load last timestamp from file on startup
async function loadLastTimestamp() {
    try {
        const data = await fs.readFile(TIMESTAMP_FILE, 'utf8');
        const timestamp = new Date(parseInt(data, 10));
        if (!isNaN(timestamp.getTime())) {
            lastTimestamp = timestamp;
            console.log(`Loaded last timestamp: ${lastTimestamp}`);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error loading last timestamp:', error);
        }
    }
}

// Save the last timestamp to file
async function saveLastTimestamp(timestamp) {
    try {
        await fs.writeFile(TIMESTAMP_FILE, timestamp.getTime().toString(), 'utf8');
    } catch (error) {
        console.error('Error saving last timestamp:', error);
    }
}

async function pollLogsAndEmit(io) {
    let logs;
    let connection;
    
    try {
        connection = await zk.createSocket();
        logs = await zk.getAttendances();
        
        if (!logs || !Array.isArray(logs.data)) {
            throw new Error('Invalid logs format received from device');
        }

        // Process logs in chronological order (oldest first)
        const sortedLogs = [...logs.data].sort((a, b) => 
            new Date(a.recordTime) - new Date(b.recordTime)
        );

        const newLogs = [];
        
        for (const log of sortedLogs) {
            try {
                const logTime = new Date(log.recordTime);
                if (isNaN(logTime.getTime())) {
                    console.warn('Invalid log time format:', log.recordTime);
                    continue;
                }
                
                if (!lastTimestamp || logTime > lastTimestamp) {
                    newLogs.push({
                        ...log,
                        timestamp: logTime.toISOString()
                    });
                    // Update lastTimestamp to the most recent log
                    lastTimestamp = logTime;
                }
            } catch (error) {
                console.error('Error processing log entry:', error, log);
            }
        }

        if (newLogs.length > 0) {
            // Save the latest timestamp to file
            await saveLastTimestamp(lastTimestamp);
            
            // Format logs for database with timestamps
            const { logAttendance } = require('../controllers/attendanceController');
            const attendanceLogs = newLogs.map(log => {
                const date = new Date(log.recordTime);
                const logDate = date.toISOString().split('T')[0]; // YYYY-MM-DD format
                const logTime = date.toTimeString().split(' ')[0]; // HH:MM:SS format
                
                return {
                    zk_id: log.deviceUserId.toString(),
                    log_date: logDate,
                    time: logTime,
                    recordTime: log.recordTime // Keep original timestamp for reference
                };
            });

            // Log what we're about to save
            console.log('\n📋 Processing new logs:', {
                count: newLogs.length,
                logs: attendanceLogs,
                latestTimestamp: lastTimestamp.toISOString()
            });

            try {
                // Import the logAttendance function
                const { logAttendance } = require('../controllers/attendanceController');
                
                // Call logAttendance directly (it will return a promise)
                const response = await logAttendance({ 
                    body: { attendance: attendanceLogs } 
                });

                if (response?.success && response?.results) {
                    // Format the response to match the expected structure
                    const formattedLogs = response.results.map(log => ({
                        id: log.id,
                        zk_id: log.zk_id,
                        log_date: log.log_date,
                        time_in: log.time_in,
                        time_out: log.time_out || null,
                        log_type: log.log_type || 1,
                        first_name: log.first_name || 'Unknown',
                        last_name: log.last_name || '',
                        action: log.action || (log.time_out ? 'time_out' : 'time_in'),
                        // Add a display name for convenience
                        display_name: `${log.first_name || 'Unknown'} ${log.last_name || ''}`.trim()
                    }));

                    console.log('✅ Logged attendance:', {
                        success: response.success,
                        processed: response.processed,
                        results: formattedLogs.length
                    });
                    
                    // Emit the formatted logs to clients
                    io.emit('new-scan', formattedLogs);
                    console.log(`📢 Emitted ${formattedLogs.length} processed log(s) to clients. Latest: ${lastTimestamp.toISOString()}`);
                    return formattedLogs;
                } else {
                    throw new Error('Invalid response format from logAttendance');
                }
                
            } catch (error) {
                console.error('❌ Error in attendance processing:', error.message);
                if (error.response) {
                    console.error('Error response:', error.response.data);
                }
                // Emit error to clients if needed
                io.emit('attendance-error', { 
                    error: 'Failed to process attendance',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
                return [];
            }
        }
        
        return [];
        
    } catch (err) {
        console.error('Polling error:', err.message);
        if (err.stack) console.error(err.stack);
        throw err;
    } finally {
        try {
            if (connection) {
                await zk.disconnect();
            }
        } catch (disconnectError) {
            console.error('Error disconnecting from device:', disconnectError);
        }
    }
}

async function startPolling(io, initialPollDelay = 2000, pollInterval = 10000) {
    // Load last timestamp before starting
    await loadLastTimestamp();
    
    // Initial poll after delay
    setTimeout(() => pollLogsAndEmit(io).catch(console.error), initialPollDelay);
    
    // Set up regular polling
    const intervalId = setInterval(() => {
        pollLogsAndEmit(io).catch(console.error);
    }, pollInterval);
    
    // Return cleanup function
    return () => {
        clearInterval(intervalId);
    };
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('Saving last timestamp before exit...');
    if (lastTimestamp) {
        await saveLastTimestamp(lastTimestamp);
    }
    process.exit(0);
});

module.exports = { 
    startPolling,
    pollLogsAndEmit // Export for manual polling if needed
};
