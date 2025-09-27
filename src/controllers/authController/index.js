const mysql = require('mysql2/promise');
const { getPool } = require('../../mysql');
const bcryptjs = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { getConfig, writeConfig } = require('../../utils/setupConfig');
const ZKLib = require('../../libs/zkh-lib'); // Local copy of the zkh-lib in src/libs/zkh-lib. DO NOT REMOVE OR CHANGE THIS LINE

exports.login = async (req, res) => {
    const email = req.body.email || req.query.email || req.params.email;
    const password = req.body.password || req.query.password || req.params.password;
    let connection;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        connection = await getPool().getConnection();
        const [rows] = await connection.query('SELECT * FROM admin WHERE email = ? OR username = ?', [email, email]);
        
        if (!rows?.length) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const admin = rows[0];
        const isMatch = await bcryptjs.compare(password, admin.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Return only necessary user data
        const userData = {
            id: admin.id,
            email: admin.email,
            role: admin.role || 'admin',
            name: admin.name || ''
        };

        res.json({ 
            success: true, 
            message: 'Login successful',
            user: userData
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Login failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) await connection.release();
    }
};

exports.logout = (req, res) => {
    try {
        // In a token-based auth system, logout is handled client-side by removing the token
        // This endpoint is kept for consistency
        res.json({ 
            success: true, 
            message: 'Logout successful' 
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ 
            error: 'Logout failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getCurrentUser = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const connection = await getPool().getConnection();
        try {
            const [rows] = await connection.query('SELECT id, name, email, role, created_at FROM admin WHERE id = ?', [req.user.id]);
            
            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            res.json({ 
                success: true, 
                user: rows[0] 
            });
        } finally {
            if (connection) connection.release();
        }
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ 
            error: 'Failed to get current user',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getCurrentConfig = async (req, res) => {
    try {
        const config = getConfig();
        res.json({ 
            success: true, 
            config 
        });
    } catch (error) {
        console.error('Get current config error:', error);
        res.status(500).json({ 
            error: 'Failed to get current config',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.initialSetup = async (req, res) => {
    
    try {
        const config = getConfig();
        if (config.initial_setup) {
            return res.status(200).json({
                success: true,
                message: 'Initial setup required',
                initialSetup: config.initial_setup
            });
        } else {
            return res.status(200).json({
                success: true,
                message: 'Initial setup not required',
                initialSetup: config.initial_setup
            });
        }
    } catch (err) {
        console.error('Failed to read config.json:', err.message);
    }
};

exports.testDbConnection = async (req, res) => {
    const { db_host, db_name, db_user, db_password } = req.body;
    let pool;
    
    try {
        const dbConfig = {
            host: db_host,
            user: db_user,
            password: db_password,
            database: db_name,
            waitForConnections: true,
            connectionLimit: 1, // Use just 1 connection for testing
            queueLimit: 0
        };

        console.log(dbConfig);

        pool = mysql.createPool(dbConfig);
        
        // Test the connection
        const [rows] = await pool.query(`SELECT SCHEMA_NAME 
            FROM INFORMATION_SCHEMA.SCHEMATA 
            WHERE SCHEMA_NAME = ?`, [db_name]);

        if (rows && rows.length > 0) {
            return res.json({
                success: true,
                message: `Successfully connected to database '${db_name}'`,
            });
        }
        throw new Error(`Database '${db_name}' does not exist or is not accessible`);
    } catch (error) {
        console.error('Failed to connect to database:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to connect to database',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        // End the pool when done
        if (pool) {
            await pool.end();
        }
    }
};

exports.testZKConnection = async (req, res) => {
    const { zk_ip, zk_port, zk_timeout } = req.body;

    try {
        const zkDevice = new ZKLib(
            zk_ip, 
            parseInt(zk_port, 10), 
            parseInt(zk_timeout, 10), 
            parseInt(4000, 10)
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
    } catch (error) {
        res.status(500).json({ reachable: false, message: 'Device is not reachable.', error: error.message });
    }
};

exports.saveConfig = async (req, res) => {
    const { db_host, db_name, db_user, db_password, zk_ip, zk_port, zk_timeout } = req.body;

    try {
        // Get current config
        const currentConfig = getConfig();

        // Create updated config object
        const updatedConfig = {
            ...currentConfig,
            initial_setup: false,
            ...(db_host && { db_host }),
            ...(db_name && { db_name }),
            ...(db_user && { db_user }),
            ...(db_password && { db_password }),
            ...(zk_ip && { zk_ip }),
            ...(zk_port && { zk_port }),
            ...(zk_timeout && { zk_timeout })
        };

        // Write the updated config
        if(writeConfig(updatedConfig)) {
            return res.status(200).json({
                success: true,
                message: 'Config saved successfully',
            });

        } else {
            return res.status(500).json({
                success: false,
                message: 'Failed to save config',
            });
        }
    } catch (error) {
        console.error('Failed to save config:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to save configuration',
        });
    }
};
