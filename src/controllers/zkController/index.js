//const ZKLib = require('node-zklib');
const ZKLib = require('zklib-js');
//const ZKLib = require('zkh-lib');

exports.testConnection = async (req, res) => {
    // Replace with your actual device IP and port
    const zkDevice = new ZKLib('192.168.254.201', 4370, 10000, 4000);
    try {
        await zkDevice.createSocket();
        await zkDevice.disconnect();
        res.json({ reachable: true, message: 'Device is reachable.' });
    } catch (error) {
        res.status(500).json({ reachable: false, message: 'Device is not reachable.', error: error.message });
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
    }
};

exports.getAttendance = async (req, res) => {
    const zkDevice = new ZKLib('192.168.254.201', 4370, 10000, 4000);
    try {
        await zkDevice.createSocket();
        const attendance = await zkDevice.getAttendances();
        await zkDevice.disconnect();

        const formattedAttendance = attendance.data.map((log) => ({
            ...log,
            recordTime: new Date(log.recordTime).toISOString(),
        }));
        
        res.json({
            attendance: formattedAttendance,
            currentTime: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        await zkDevice.disconnect();
        if (res && typeof res.status === 'function' && typeof res.json === 'function') {
            res.status(500).json({ success: false, error: error.message });
        }
        throw error;
    }
};