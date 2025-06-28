const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const ZKLib = require('node-zklib');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    },
});

app.use(cors());

const zk = new ZKLib('192.168.254.201', 4370, 10000, 4000);
let lastTimestamp = null;

async function pollDevice() {
    try {
        await zk.createSocket();

        const logs = await zk.getAttendances();
        await zk.disconnect();

        if (!logs || !logs.data || logs.data.length === 0) {
            console.log('No logs returned from device.');
            return;
        }

        console.log('Fetched logs:', logs.data);

        const newLogs = logs.data.filter(log => {
            const logTime = new Date(log.timestamp);
            return !lastTimestamp || logTime.getTime() > lastTimestamp.getTime();
        });

        if (newLogs.length > 0) {
            lastTimestamp = new Date(newLogs[newLogs.length - 1].timestamp);
            io.emit('new-scan', newLogs);
            console.log('📢 New scan sent to client:', newLogs);
        } else {
            console.log('✅ No new logs at', new Date().toLocaleTimeString());
        }

    } catch (error) {
        console.log('❌ Polling failed: ', error);
    }
}

// Poll every 10 seconds
setInterval(pollDevice, 10000);

// Socket Connection
io.on('connection', (socket) => {
    console.log('🟢 Client connected: ', socket.id);

    socket.on('disconnect', () => {
        console.log('🔴 Client disconnected: ', socket.id);
    });
});

server.listen(3000, () => {
    console.log('🚀 Server is running on port 3000');
});
