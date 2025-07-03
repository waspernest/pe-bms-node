//const ZKLib = require('node-zklib');
//const ZKLib = require('zklib-js');
const ZKLib = require('../../libs/zkh-lib'); // Local copy of the zkh-lib in src/libs/zkh-lib. DO NOT REMOVE OR CHANGE THIS LINE

exports.testConnection = async (req, res) => {
    // Replace with your actual device IP and port
    const zkDevice = new ZKLib('192.168.254.201', 4370, 10000, 4000);
    try {
        await zkDevice.createSocket();
        await zkDevice.disconnect();
        res.json({ reachable: true, message: 'Device is reachable.' });
    } catch (error) {
        res.status(500).json({ reachable: false, message: 'Device is not reachable.', error: error.message });
    } finally {
        try {
            await zkDevice.disconnect();
        } catch (e) {
            console.error('Error disconnecting from ZK device:', e);
        }
    }
};

exports.getUsers = async (req, res) => {
    const zkDevice = new ZKLib('192.168.254.201', 4370, 10000, 4000);
    try {
        await zkDevice.createSocket();
        const users = await zkDevice.getUsers();
        await zkDevice.disconnect();
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        try {
            await zkDevice.disconnect();
        } catch (e) {
            console.error('Error disconnecting from ZK device:', e);
        }
    }
};

exports.getAttendance = async (req, res) => {
    const zkDevice = new ZKLib('192.168.254.201', 4370, 10000, 4000);
    let isConnected = false;

    try {
        console.log(`[${new Date().toISOString()}] 🔌 Starting connection to ZKTeco device...`);
        await zkDevice.createSocket();
        isConnected = true;
        console.log(`[${new Date().toISOString()}] ✅ Device connected.`);
        console.log(`[${new Date().toISOString()}] 📥 Attempting to fetch attendance logs...`);

        const attendance = await zkDevice.getAttendances();

        if (!attendance || !attendance.data || attendance.data.length === 0) {
            console.warn('⚠️ No attendance logs available.');
            return res.json({
                success: true,
                message: 'No attendance records found.',
                attendance: [],
                currentTime: new Date().toISOString()
            });
        }

        const formattedAttendance = attendance.data.map(log => ({
            ...log,
            recordTime: new Date(log.recordTime).toISOString()
        }));

        res.json({
            success: true,
            attendance: formattedAttendance,
            currentTime: new Date().toISOString(),
            recordCount: formattedAttendance.length
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error encountered:`, error.message || error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch attendance data',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (isConnected) {
            try {
                console.log(`[${new Date().toISOString()}] 🔌 Disconnecting from device...`);
                await zkDevice.disconnect();
                console.log(`[${new Date().toISOString()}] 🔌 Disconnected successfully.`);
            } catch (e) {
                console.error('⚠️ Error during disconnect:', e.message || e);
            }
        }
    }
};

// POST /api/zk/user
exports.createOrUpdateUser = async (req, res) => {
    // Handle both Express and direct calls
    const params = req.body || req;
    const { uid, userid, name, password, role = 0, cardno = 0 } = params;
    
    if (!uid || !userid || !name || password === undefined) {
        const error = new Error('uid, userid, name, and password are required.');
        if (res && typeof res.status === 'function' && typeof res.json === 'function') {
            return res.status(400).json({ error: error.message });
        }
        throw error;
    }

    const zkDevice = new ZKLib('192.168.254.201', 4370, 10000, 4000);
    try {
        await zkDevice.createSocket();
        const result = await zkDevice.setUser(uid, userid, name, password, role, cardno);
        await zkDevice.disconnect();
        
        if (res && typeof res.json === 'function') {
            res.json({ success: true, result });
        }
        return { success: true, result };
    } catch (error) {
        if (res && typeof res.status === 'function' && typeof res.json === 'function') {
            res.status(500).json({ success: false, error: error.message });
        }
        throw error;
    } finally {
        try {
            await zkDevice.disconnect();
        } catch (e) {
            console.error('Error disconnecting from ZK device:', e);
        }
    }
};