//const ZKLib = require('node-zklib');
//const ZKLib = require('zklib-js');
const ZKLib = require('../../libs/zkh-lib'); // Local copy of the zkh-lib in src/libs/zkh-lib. DO NOT REMOVE OR CHANGE THIS LINE
const { getPool } = require('../../mysql');
const { logAttendance } = require('../attendanceController');
const dotenv = require('dotenv');
dotenv.config();
const { getConfig } = require('../../utils/setupConfig');
const config = getConfig();

// Helper function to get a connection and run a query
const query = async (sql, params = []) => {
    const connection = await getPool().getConnection();
    try {
        const [results] = await connection.query(sql, params);
        return results;
    } finally {
        connection.release();
    }
};

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

exports.testDeviceConnection = async (req, res) => {
    const {zk_ip, zk_port, zk_timeout} = req.body;
    const deviceInfo = `ZK Device ${zk_ip}:${zk_port}`;
    const timestamp = new Date().toISOString();

    console.log(`[${timestamp}] Attempting to connect to ${deviceInfo} with timeout: ${zk_timeout}ms`);

    const zkDevice = new ZKLib(
        zk_ip, 
        parseInt(zk_port, 10), 
        parseInt(zk_timeout, 10), 
        parseInt(process.env.ZK_READ_TIMEOUT || 10000, 10)
    );

    let isConnected = false;
    try {
        console.log(`[${new Date().toISOString()}] Creating socket connection to ${deviceInfo}...`);
        await zkDevice.createSocket();
        isConnected = true;
        const successMsg = `Successfully connected to ${deviceInfo}`;
        console.log(`[${new Date().toISOString()}] ${successMsg}`);
        res.json({ 
            reachable: true, 
            message: successMsg,
            device: deviceInfo,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        const errorMsg = `Failed to connect to ${deviceInfo}: ${error.message}`;
        console.error(`[${new Date().toISOString()}] ${errorMsg}`, error);
        res.status(500).json({ 
            reachable: false, 
            message: `Connection to ${deviceInfo} failed`,
            error: error.message,
            details: {
                code: error.code,
                device: deviceInfo,
                timestamp: new Date().toISOString()
            }
        });
    } finally {
        if (isConnected) {
            try {
                console.log(`[${new Date().toISOString()}] Disconnecting from ${deviceInfo}...`);
                await zkDevice.disconnect();
                console.log(`[${new Date().toISOString()}] Successfully disconnected from ${deviceInfo}`);
            } catch (e) {
                const disconnectError = `Error disconnecting from ${deviceInfo}: ${e.message}`;
                console.error(`[${new Date().toISOString()}] ${disconnectError}`, e);
            }
        }
    }
};

/**
 * Get users from ZK device
 * @param {Object} req - Express request object (optional if called directly)
 * @param {Object} res - Express response object (optional if called directly)
 * @returns {Promise<Array|Object>} Array of users if called directly, otherwise sends JSON response
 */
exports.getUsers = async (req, res = null) => {
    // Handle case where only res is passed (backward compatibility)
    if (res === null && req && typeof req.json === 'function') {
        res = req;
        req = { body: {} };
    }
    // const zkDevice = new ZKLib(
    //     config.zk_ip, 
    //     parseInt(config.zk_port, 10), 
    //     parseInt(config.zk_timeout, 10), 
    //     parseInt(config.zk_read_timeout, 10)
    // );

    const zkDevice = new ZKLib(
        req.deviceConfig.ip, 
        parseInt(req.deviceConfig.port, 10), 
        parseInt(req.deviceConfig.timeout, 10), 
        parseInt(req.deviceConfig.readTimeout, 10)
    );

    try {
        await zkDevice.createSocket();
        const users = await zkDevice.getUsers();
        
        // If called as middleware (with res), send JSON response
        if (res && typeof res.json === 'function') {
            return res.json({ 
                success: true, 
                users 
            });
        }
        
        return users;
    } catch (error) {
        console.error('Error getting users:', error);
        
        // If called as middleware, send error response
        if (res && typeof res.status === 'function') {
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to get users from ZK device',
                details: error.message 
            });
        }
        
        throw error;
    } finally {
        try {
            if (zkDevice && typeof zkDevice.disconnect === 'function') {
                await zkDevice.disconnect();
            }
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
            const response = {
                success: true,
                message: 'No attendance records found.',
                details: {
                    count: 0,
                    startDate: null,
                    endDate: null
                }
            };
            return res ? res.json(response) : response;
        }

        // Format attendance data
        const formattedAttendance = attendance.data.map(log => {
            const date = new Date(log.recordTime);
            return {
                ...log,
                recordTime: date.toISOString(),
                date: date.toISOString().split('T')[0],
                time: date.toTimeString().split(' ')[0]
            };
        });

        // Log attendance to database if needed
        try {
            await logAttendance({ 
                body: { 
                    attendance: formattedAttendance.map(log => ({
                        zk_id: log.deviceUserId,
                        log_date: log.date,
                        time: log.time
                    }))
                } 
            }, { json: () => {} });
        } catch (error) {
            console.error('Error in attendance logging:', error);
            // Don't fail the main request if attendance logging fails
        }
        
        const response = {
            success: true,
            result: formattedAttendance,
            message: 'Attendance logs retrieved successfully',
            details: {
                count: formattedAttendance.length,
                startDate: formattedAttendance[0]?.date,
                endDate: formattedAttendance[formattedAttendance.length - 1]?.date
            }
        };

        if (res) {
            res.json(response);
        }
        return response;

    } catch (error) {
        console.error('Error getting attendance from ZKTeco device:', error);
        const errorResponse = {
            success: false,
            error: error.message,
            details: {
                errorTime: new Date().toISOString()
            }
        };
        
        if (res) {
            res.status(500).json(errorResponse);
        }
        throw error;
    } finally {
        if (isConnected) {
            try {
                await zkDevice.disconnect();
                console.log(`[${new Date().toISOString()}] 🔌 Disconnected from ZK device.`);
            } catch (e) {
                console.error('Error disconnecting from ZK device:', e);
            }
        }
    }
};

/**
 * Fetches attendance logs directly from the ZK device without saving to database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Raw attendance data from device
 */
exports.getAttendanceNew = async (req, res) => {
    const deviceConfig = req.deviceConfig || {
        ip: config.zk_ip,
        port: config.zk_port,
        timeout: config.zk_timeout,
        readTimeout: config.zk_read_timeout
    };

    const zkDevice = new ZKLib(
        deviceConfig.ip, 
        parseInt(deviceConfig.port, 10), 
        parseInt(deviceConfig.timeout, 10), 
        parseInt(deviceConfig.readTimeout, 10)
    );

    let isConnected = false;

    try {
        console.log(`[${new Date().toISOString()}] 🔌 Starting connection to ZKTeco device...`);
        await zkDevice.createSocket();
        isConnected = true;
        console.log(`[${new Date().toISOString()}] ✅ Device connected.`);
        console.log(`[${new Date().toISOString()}] 📥 Fetching attendance logs...`);

        // Get raw attendance data from device
        const attendance = await zkDevice.getAttendances();

        if (!attendance?.data?.length) {
            console.warn('ℹ️ No attendance logs found on device.');
            const response = {
                success: true,
                message: 'No attendance records found on device.',
                result: [],
                details: {
                    count: 0,
                    startDate: null,
                    endDate: null,
                    deviceInfo: {
                        ip: deviceConfig.ip,
                        port: deviceConfig.port,
                        lastChecked: new Date().toISOString()
                    }
                }
            };
            return res ? res.json(response) : response;
        }

        // Format the raw data for better readability
        const formattedData = attendance.data.map(log => {
            const date = new Date(log.recordTime);
            return {
                userId: log.userId,
                deviceUserId: log.deviceUserId,
                recordTime: date.toISOString(),
                date: date.toISOString().split('T')[0],
                time: date.toTimeString().split(' ')[0],
                type: log.type,
                status: log.status,
                // Include all original properties
                ...log
            };
        });

        const response = {
            success: true,
            message: 'Attendance logs retrieved successfully',
            result: formattedData,
            details: {
                count: formattedData.length,
                startDate: formattedData[0]?.date,
                endDate: formattedData[formattedData.length - 1]?.date,
                deviceInfo: {
                    ip: deviceConfig.ip,
                    port: deviceConfig.port,
                    lastSynced: new Date().toISOString()
                }
            }
        };

        if (res) {
            res.json(response);
        }
        return response;

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Error fetching attendance:`, error);
        const errorResponse = {
            success: false,
            error: error.message,
            details: {
                errorTime: new Date().toISOString(),
                deviceInfo: {
                    ip: deviceConfig.ip,
                    port: deviceConfig.port,
                    status: 'error'
                }
            }
        };
        
        if (res) {
            res.status(500).json(errorResponse);
        }
        throw error;
        
    } finally {
        if (isConnected) {
            try {
                await zkDevice.disconnect();
                console.log(`[${new Date().toISOString()}] 🔌 Disconnected from ZK device.`);
            } catch (e) {
                console.error('Error disconnecting from ZK device:', e);
            }
        }
    }
};

// POST /api/zk/user
exports.createOrUpdateUser = async (req, res) => {
    // Handle both Express and direct calls
    //let uid, userid, name, password, role, cardno;
    
    // Handle both direct call (from userController) and HTTP request
    const requestData = req.body.data || req.body; // Handle both nested and direct data
    
    // Extract fields from request data
    const { 
        uid, 
        userid, 
        name, 
        password, 
        role = 0, 
        cardno = 0 
    } = requestData;

    // Debug
    console.log('Received data in createOrUpdateUser:', {
        body: req.body,
        deviceConfig: req.deviceConfig
    });
    console.log('Extracted data:', requestData);
    console.log('Extracted fields:', { uid, userid, name, password, role, cardno });
    
    if (!uid || !userid || !name || password === undefined) {
        const error = new Error('uid, userid, name, and password are required.');
        if (res && typeof res.status === 'function' && typeof res.json === 'function') {
            return res.status(400).json({ error: error.message });
        }
        throw error;
    }

    const zkDevice = new ZKLib(
        req.deviceConfig.ip, 
        parseInt(req.deviceConfig.port, 10), 
        parseInt(req.deviceConfig.timeout, 10), 
        parseInt(req.deviceConfig.readTimeout, 10)
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

exports.getDevice = async (req, res) => {
    try {
        // Get the admin ID from the request
        const adminId = req.user?.id || req.body?.adminId || req.query?.adminId;
        console.log('Admin ID from request:', adminId);

        if (!adminId) {
            const error = new Error('Admin ID is required');
            if (res) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
            throw error;
        }

        // Execute the query
        console.log('Executing query with adminId:', adminId);
        const results = await query(
            'SELECT id, zk_ip, zk_port, zk_timeout FROM zk_config WHERE aid = ?',
            [adminId]
        );
        console.log('Query results:', results);

        // Check if we got any results
        if (!results || results.length === 0) {
            console.log('No device configuration found for admin ID:', adminId);
            const error = new Error('No device configuration found for this admin');
            if (res) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            throw error;
        }

        const device = results[0];
        console.log('Found device:', device);

        // Validate device data
        if (!device) {
            const error = new Error('No device data received from database');
            if (res) {
                return res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
            throw error;
        }

        const response = {
            success: true,
            device: {
                id: device.id,
                ip: device.zk_ip || '192.168.18.100',
                port: device.zk_port || 4370,
                timeout: device.zk_timeout || 5000
            }
        };

        // If res is provided, send the response
        if (res) {
            return res.json(response);
        }
        
        // Otherwise, return the data
        return response;

    } catch (error) {
        console.error('Error in getDevice:', {
            message: error.message,
            stack: error.stack,
            request: req ? {
                query: req.query,
                body: req.body,
                user: req.user
            } : 'No request object'
        });
        
        if (res) {
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve device settings',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
        throw error;
    }
};

exports.syncToDevice = async (req, res) => {
    const { type, deviceUsers, databaseUsers, zk_ip, zk_port, zk_timeout } = req.body;
    
    // Set up deviceConfig for createOrUpdateUser function using the passed device config
    req.deviceConfig = {
        ip: zk_ip || config.zk_ip,
        port: zk_port || config.zk_port,
        timeout: zk_timeout || config.zk_timeout,
        readTimeout: config.zk_read_timeout
    };
    
    console.log('Using device config for syncToDevice:', req.deviceConfig);
    
    // Handle different data structures for database users
    let dbUsersArray = databaseUsers;
    if (!Array.isArray(databaseUsers)) {
        console.log('databaseUsers structure:', databaseUsers);
        dbUsersArray = [];
    }

    // Handle different data structures from ZK device
    let usersArray = deviceUsers;
    if (deviceUsers && deviceUsers.data && Array.isArray(deviceUsers.data)) {
        usersArray = deviceUsers.data;
    } else if (!Array.isArray(deviceUsers)) {
        console.log('deviceUsers structure:', deviceUsers);
        usersArray = [];
    }

    let missingUsers = [];
    let insertedCount = 0;
    let errorCount = 0;
    let errorDetails = [];

    // Find users that are in database but not in device
    missingUsers = dbUsersArray.filter(dbUser => {
        return dbUser.zk_id && !usersArray.some(deviceUser => 
            deviceUser.uid && deviceUser.uid.toString() === dbUser.zk_id.toString()
        );
    });

    // Process to add users from database to device
    if (missingUsers.length > 0) {
        for (const dbUser of missingUsers) {
            try {
                // Prepare user data for createOrUpdateUser function
                const userData = {
                    uid: parseInt(dbUser.zk_id),
                    userid: parseInt(dbUser.zk_id), // Use zk_id as userid
                    name: `${dbUser.first_name || ''} ${dbUser.last_name || ''}`.trim(),
                    password: dbUser.password || '1234',
                    role: dbUser.role || 0,
                    cardno: dbUser.cardno || 0
                };

                // Create a mock request object for createOrUpdateUser
                const userReq = { 
                    body: userData,
                    deviceConfig: req.deviceConfig
                };

                // Use existing createOrUpdateUser function
                await exports.createOrUpdateUser(userReq);
                insertedCount++;
                console.log(`Added user to device: ${userData.name} (ID: ${userData.uid})`);
            } catch (error) {
                const errorDetail = {
                    userName: `${dbUser.first_name || ''} ${dbUser.last_name || ''}`.trim(),
                    userId: dbUser.zk_id,
                    errorMessage: error.message,
                    errorCode: error.code || 'UNKNOWN',
                    deviceError: error.deviceError || 'N/A'
                };
                
                errorDetails.push(errorDetail);
                
                console.error(`Failed to add user ${dbUser.first_name} ${dbUser.last_name} to device:`, {
                    message: error.message,
                    code: error.code || 'UNKNOWN',
                    deviceError: error.deviceError || 'N/A'
                });
                errorCount++;
            }
        }
        
        console.log(`Device sync completed: ${insertedCount} added, ${errorCount} errors`);
    }
    
    console.log(`Found ${missingUsers.length} users to add to device`);
    
    return {
        status: true,
        sync_type: type,
        deviceUsers: usersArray,
        dbUsers: dbUsersArray,
        sync_results: {
            total_found: missingUsers.length,
            successful_inserts: insertedCount || 0,
            failed_inserts: errorCount || 0,
            error_details: errorDetails,
            message: `Device sync completed: ${insertedCount || 0} users added successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}`
        },
        message: 'Device sync completed successfully'
    };
};

exports.zkService = async (req, res) => {
    try {
        const { action, aid, ...data } = req.body;

        if (!action || !aid) {
            return res.status(400).json({
                success: false,
                error: 'Action and admin ID are required'
            });
        }

        try {
            // Get config based on admin ID
            // const { success, device } = await exports.getDevice({ 
            //     body: { adminId: aid } 
            // });

            // if (!success || !device) {
            //     return res.status(500).json({
            //         success: false,
            //         error: 'Device IP and port are required'
            //     });
            // }

            // Add device config to request object with defaults
            req.deviceConfig = {
                ip: data.zk_ip,
                port: data.zk_port,
                timeout: data.zk_timeout || 5000,  // Default timeout if not provided
                readTimeout: data.zk_readTimeout || 10000  // Default readTimeout if not provided
            };

            // Handle the action with dynamic data
            let result;
            switch (action) {
                case 'getAttendance':
                    result = await exports.getAttendanceNew(req, res);
                    break;
                case 'createOrUpdateUser':
                    // Check for required fields directly in the data object
                    if (!data.uid || !data.userid || !data.name || data.password === undefined) {
                        return res.status(400).json({
                            success: false,
                            error: 'uid, userid, name, and password are required for user operations'
                        });
                    }
                    
                    // Create a new request object with the data in the body
                    const userReq = { 
                        ...req, 
                        body: { 
                            ...data,
                            role: data.role || 0,
                            cardno: data.cardno || 0
                        } 
                    };
                    result = await exports.createOrUpdateUser(userReq, res);
                    break;
                case 'getUsers':
                    {
                        const users = await exports.getUsers(req);
                        console.log(`zkService syncUsers: fetched ${Array.isArray(users) ? users.length : 0} users`);
                        result = { success: true, users };
                    }
                    break;
                case 'sync_to_device':
                    {
                        result = await exports.syncToDevice(req, res);
                    }
                    break;
                case 'deleteUser':
                    {
                        const { uid } = data;
                        if (!uid) {
                            return res.status(400).json({
                                success: false,
                                error: 'User ID (uid) is required for delete operation'
                            });
                        }
                        
                        const zkDevice = new ZKLib(
                            req.deviceConfig.ip, 
                            parseInt(req.deviceConfig.port, 10), 
                            parseInt(req.deviceConfig.timeout, 10), 
                            parseInt(req.deviceConfig.readTimeout, 10)
                        );

                        try {
                            await zkDevice.createSocket();
                            const deleteResult = await zkDevice.deleteUser(uid);
                            await zkDevice.disconnect();
                            
                            result = { 
                                success: true, 
                                message: `User ${uid} successfully removed from device`,
                                result: deleteResult
                            };
                        } catch (error) {
                            console.error(`Error deleting user ${uid} from device:`, error);
                            result = { 
                                success: false, 
                                error: `Failed to delete user ${uid} from device: ${error.message}`
                            };
                        }
                    }
                    break;
                default:
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid action'
                    });
            }

            // Only send response if it hasn't been sent yet
            if (res && !res.headersSent) {
                return res.json(result);
            }
            
        } catch (error) {
            console.error(`Error in zkService - ${action}:`, error);
            
            // Only send response if it hasn't been sent yet
            if (res && !res.headersSent) {
                return res.status(500).json({
                    success: false,
                    error: `Failed to process ${action} action`,
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
        }
    } catch (error) {
        console.error('Unexpected error in zkService:', error);
        
        // Only send response if it hasn't been sent yet
        if (res && !res.headersSent) {
            return res.status(500).json({
                success: false,
                error: 'Internal server error',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
};