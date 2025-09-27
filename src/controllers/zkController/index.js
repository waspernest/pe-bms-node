//const ZKLib = require('node-zklib');
//const ZKLib = require('zklib-js');
const ZKLib = require('../../libs/zkh-lib'); // Local copy of the zkh-lib in src/libs/zkh-lib. DO NOT REMOVE OR CHANGE THIS LINE
const { logAttendance } = require('../attendanceController');
const dotenv = require('dotenv');
dotenv.config();
const { getConfig } = require('../../utils/setupConfig');
const config = getConfig();

exports.testConnection = async (req, res) => {
    // Replace with your actual device IP and port
    const zkDevice = new ZKLib(
        config.zk_ip, 
        parseInt(config.zk_port, 10), 
        parseInt(config.zk_timeout, 10), 
        parseInt(config.zk_read_timeout, 10)
    );

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

/**
 * Get users from ZK device
 * @param {Object} res - Optional Express response object. If provided, sends JSON response.
 * @returns {Promise<Array>} Array of users if called directly, otherwise sends JSON response
 */
exports.getUsers = async (res = null) => {
    const zkDevice = new ZKLib(
        config.zk_ip, 
        parseInt(config.zk_port, 10), 
        parseInt(config.zk_timeout, 10), 
        parseInt(config.zk_read_timeout, 10)
    );

    try {
        await zkDevice.createSocket();
        const users = await zkDevice.getUsers();
        
        // If called as middleware (with res), send JSON response
        if (res) {
            return res.json({ users });
        }
        
        // If called directly, return the users array
        return users;
    } catch (error) {
        console.error('Error getting users from ZK device:', error);
        
        // If called as middleware, send error response
        if (res) {
            return res.status(500).json({ error: error.message });
        }
        
        // If called directly, rethrow the error
        throw error;
    } finally {
        try {
            await zkDevice.disconnect();
        } catch (e) {
            console.error('Error disconnecting from ZK device:', e);
        }
    }
};

exports.getAttendance = async (req, res) => {
    const zkDevice = new ZKLib(
        config.zk_ip, 
        parseInt(config.zk_port, 10), 
        parseInt(config.zk_timeout, 10), 
        parseInt(config.zk_read_timeout, 10)
    );

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

        // Format attendance data with only required fields
        const attendanceLogs = attendance.data.map(log => {
            const date = new Date(log.recordTime);
            return {
                zk_id: log.deviceUserId, // Using deviceUserId from the log
                log_date: date.toISOString().split('T')[0], // YYYY-MM-DD format
                time: date.toTimeString().split(' ')[0]  // HH:MM:SS format
            };
        });

        try {
            // Call logAttendance with only the required fields
            await logAttendance({ body: { attendance: attendanceLogs } }, { json: () => {} });
        } catch (error) {
            console.error('Error in attendance logging:', error);
            // Don't fail the main request if attendance logging fails
        }
        
        // Keep the full formatted data for the response
        const formattedAttendance = attendance.data.map(log => {
            const date = new Date(log.recordTime);
            return {
                ...log,
                recordTime: date.toISOString(),
                date: date.toISOString().split('T')[0],
                time: date.toTimeString().split(' ')[0]
            };
        });

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
    let uid, userid, name, password, role, cardno;
    
    // Handle both direct call (from userController) and HTTP request
    if (req && req.body) {
        // Called from HTTP request
        ({ uid, userid, name, password, role, cardno } = req.body);
    } else {
        // Called directly from userController
        ({ uid, userid, name, password, role, cardno } = req);
    }
    
    if (!uid || !userid || !name || password === undefined) {
        const error = new Error('uid, userid, name, and password are required.');
        if (res && typeof res.status === 'function' && typeof res.json === 'function') {
            return res.status(400).json({ error: error.message });
        }
        throw error;
    }

    const zkDevice = new ZKLib(
        config.zk_ip, 
        parseInt(config.zk_port, 10), 
        parseInt(config.zk_timeout, 10), 
        parseInt(config.zk_read_timeout, 10)
    );

    try {
        await zkDevice.createSocket();
        const result = await zkDevice.setUser(uid, userid, name, password, role, cardno);
        await zkDevice.disconnect();

        const response = {
            success: true,
            result,
            message: 'User successfully added/updated on device',
            details: { uid, userid, name, role, cardno }
        };

        if (res) {
            res.json(response);
        }
        return response;

    } catch (error) {
        const errorResponse = {
            success: false,
            error: error.message,
            details: { uid, userid, name }
        };
        
        if (res) {
            res.status(500).json(errorResponse);
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