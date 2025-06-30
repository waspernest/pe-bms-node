// services/zkService.js
const ZKLib = require('zklib-js');
//const ZKLib = require('zkh-lib');

const zk = new ZKLib('192.168.254.201', 4370, 10000, 4000);

let lastTimestamp = null;

async function pollLogsAndEmit(io) {
    try {
        await zk.createSocket();
        const logs = await zk.getAttendances();
        await zk.disconnect();

        const newLogs = logs.data.filter(log => {
            const logTime = new Date(log.recordTime);
            return !lastTimestamp || logTime > lastTimestamp;
        });

        if (newLogs.length > 0) {
            lastTimestamp = new Date(newLogs[newLogs.length - 1].recordTime);
            io.emit('new-scan', newLogs);
            console.log('📢 Emitted new logs:', newLogs);
        }
    } catch (err) {
        console.error('Polling error:', err.message);
    }
}

function startPolling(io) {
    setInterval(() => {
        pollLogsAndEmit(io);
    }, 10000);
}

module.exports = { startPolling };
