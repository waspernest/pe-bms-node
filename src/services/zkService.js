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
            
            // Emit new logs
            io.emit('new-scan', newLogs);
            console.log(`📢 Emitted ${newLogs.length} new log(s). Latest timestamp: ${lastTimestamp.toISOString()}`);
            
            return newLogs;
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
