const ZKLib = require('zkh-lib');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();
const { getConfig } = require('../utils/setupConfig');

// Get device configuration
const config = getConfig();
console.log('🔧 ZK Device Configuration:', {
    ip: config.zk_ip,
    port: config.zk_port,
    timeout: config.zk_timeout,
    readTimeout: config.zk_read_timeout
});

const zk = new ZKLib(
    config.zk_ip, 
    parseInt(config.zk_port, 10), 
    parseInt(config.zk_timeout, 10), 
    parseInt(config.zk_read_timeout, 10)
);

const TIMESTAMP_FILE = path.join(__dirname, '../../.last_timestamp');
let lastTimestamp = null;

// Load last timestamp from file on startup
async function loadLastTimestamp() {
    try {
        const data = await fs.readFile(TIMESTAMP_FILE, 'utf8');
        const timestamp = new Date(parseInt(data, 10));
        if (!isNaN(timestamp.getTime())) {
            lastTimestamp = timestamp;
            console.log(`⏱️  Loaded last timestamp: ${lastTimestamp}`);
        } else {
            console.log('ℹ️  No valid last timestamp found, will fetch all logs');
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('ℹ️  No timestamp file found, will fetch all logs');
        } else {
            console.error('❌ Error loading last timestamp:', error.message);
        }
    }
}

// Save the last timestamp to file
async function saveLastTimestamp(timestamp) {
    try {
        await fs.writeFile(TIMESTAMP_FILE, timestamp.getTime().toString(), 'utf8');
        console.log(`💾 Saved last timestamp: ${timestamp}`);
    } catch (error) {
        console.error('❌ Error saving last timestamp:', error.message);
    }
}

async function testZKConnection() {
    let connection;
    try {
        console.log('🔌 Testing connection to ZK device...');
        connection = await zk.createSocket();
        const time = await zk.getTime();
        console.log('✅ Successfully connected to ZK device. Device time:', time);
        return true;
    } catch (error) {
        console.error('❌ Failed to connect to ZK device:', error.message);
        return false;
    } finally {
        if (connection) {
            try {
                await zk.disconnect();
            } catch (e) {
                console.error('Error disconnecting:', e.message);
            }
        }
    }
}

async function pollLogsAndEmit(io) {
    let logs;
    let connection;
    
    try {
        console.log('\n🔄 Polling for new attendance logs...');
        
        // Test connection first
        const isConnected = await testZKConnection();
        if (!isConnected) {
            throw new Error('Cannot connect to ZK device');
        }
        
        // Create new connection for data fetching
        connection = await zk.createSocket();
        console.log('🔍 Fetching attendance logs...');
        
        logs = await zk.getAttendances();
        console.log(`📊 Received ${logs?.data?.length || 0} logs from device`);
        
        if (!logs || !Array.isArray(logs.data)) {
            throw new Error('Invalid logs format received from device');
        }

        // Process logs in chronological order (oldest first)
        const sortedLogs = [...logs.data].sort((a, b) => 
            new Date(a.recordTime) - new Date(b.recordTime)
        );
        
        console.log(`🕒 Last known timestamp: ${lastTimestamp || 'None (fetching all logs)'}`);

        const newLogs = [];
        
        for (const log of sortedLogs) {
            try {
                const logTime = new Date(log.recordTime);
                if (isNaN(logTime.getTime())) {
                    console.warn('⚠️  Invalid log time format:', log.recordTime);
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
                console.error('❌ Error processing log entry:', error.message, log);
            }
        }

        console.log(`✨ Found ${newLogs.length} new logs to process`);

        if (newLogs.length > 0) {
            // Save the latest timestamp to file
            await saveLastTimestamp(lastTimestamp);
            
            // Format logs for database with timestamps
            const attendanceLogs = newLogs.map(log => {
                const date = new Date(log.recordTime);
                // Use local timezone for log_date to prevent 1-day offset
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const logDate = `${year}-${month}-${day}`;
                const logTime = date.toTimeString().split(' ')[0];
                
                return {
                    zk_id: log.deviceUserId?.toString() || 'unknown',
                    log_date: logDate,
                    time: logTime,
                    recordTime: log.recordTime
                };
            });

            try {
                const { logAttendance } = require('../controllers/attendanceController');
                const response = await logAttendance({ 
                    body: { attendance: attendanceLogs } 
                });

                if (response?.success && response?.results) {
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
                        display_name: `${log.first_name || 'Unknown'} ${log.last_name || ''}`.trim()
                    }));

                    console.log(`✅ Successfully processed ${formattedLogs.length} logs`);
                    
                    // Emit the formatted logs to clients
                    if (io) {
                        io.emit('new-scan', formattedLogs);
                        console.log(`📢 Emitted ${formattedLogs.length} logs to clients`);
                    } else {
                        console.warn('⚠️  io object not available, cannot emit logs to clients');
                    }
                    
                    return formattedLogs;
                } else {
                    throw new Error('Invalid response format from logAttendance');
                }
                
            } catch (error) {
                console.error('❌ Error in attendance processing:', error.message);
                if (error.response) {
                    console.error('Error response:', error.response.data);
                }
                if (io) {
                    io.emit('attendance-error', { 
                        error: 'Failed to process attendance',
                        details: process.env.NODE_ENV === 'development' ? error.message : undefined
                    });
                }
                return [];
            }
        }
        
        return [];
        
    } catch (err) {
        console.error('❌ Polling error:', err.message);
        if (err.stack) console.error(err.stack);
        
        if (io) {
            io.emit('polling-error', {
                error: 'Failed to poll device',
                message: err.message,
                timestamp: new Date().toISOString()
            });
        }
        
        throw err;
    } finally {
        if (connection) {
            try {
                await zk.disconnect();
                console.log('🔌 Disconnected from ZK device');
            } catch (disconnectError) {
                console.error('❌ Error disconnecting from device:', disconnectError.message);
            }
        }
    }
}

async function startPolling(io, initialPollDelay = 5000, pollInterval = 15000) {
    console.log('\n🚀 Starting ZK device polling service...');
    console.log(`⏱️  Initial delay: ${initialPollDelay}ms`);
    console.log(`🔄 Polling interval: ${pollInterval}ms`);
    
    // Load last timestamp before starting
    await loadLastTimestamp();
    
    // Test connection first
    const isConnected = await testZKConnection();
    if (!isConnected) {
        console.error('❌ Cannot start polling: Unable to connect to ZK device');
        return () => {}; // Return empty cleanup function
    }
    
    let isPolling = false;
    let errorCount = 0;
    const MAX_ERRORS = 5;
    
    const poll = async () => {
        if (isPolling) {
            console.log('⏳ Previous poll still in progress, skipping this interval');
            return;
        }
        
        try {
            isPolling = true;
            await pollLogsAndEmit(io);
            errorCount = 0; // Reset error count on successful poll
        } catch (error) {
            errorCount++;
            console.error(`❌ Polling attempt ${errorCount}/${MAX_ERRORS} failed:`, error.message);
            
            if (errorCount >= MAX_ERRORS) {
                console.error('❌ Max error count reached, stopping polling');
                if (io) {
                    io.emit('polling-stopped', { 
                        error: 'Max error count reached',
                        timestamp: new Date().toISOString()
                    });
                }
                return; // Stop polling after max errors
            }
        } finally {
            isPolling = false;
        }
    };
    
    // Initial poll after delay
    const initialTimer = setTimeout(() => {
        poll().catch(console.error);
    }, initialPollDelay);
    
    // Set up regular polling
    const intervalId = setInterval(() => {
        poll().catch(console.error);
    }, pollInterval);
    
    // Return cleanup function
    return () => {
        console.log('🛑 Stopping ZK device polling service...');
        clearTimeout(initialTimer);
        clearInterval(intervalId);
    };
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, saving last timestamp and exiting...');
    if (lastTimestamp) {
        await saveLastTimestamp(lastTimestamp);
    }
    process.exit(0);
});

module.exports = { 
    startPolling,
    pollLogsAndEmit,
    testZKConnection
};
