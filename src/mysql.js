const mysql = require('mysql2/promise');

// MySQL connection configuration
const dbConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'pe_bms',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create a connection pool
let pool;

/**
 * Get a connection from the pool
 * @returns {Promise<mysql.Pool>} MySQL connection pool
 */
function connect() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
        console.log('MySQL connection pool created');
    }
    return pool;
}

/**
 * Execute a query with parameters
 * @param {string} sql - SQL query string
 * @param {Array} [params=[]] - Query parameters
 * @returns {Promise<{results: *, fields: *}>} Query results and fields
 */
async function query(sql, params = []) {
    const connection = await connect().getConnection();
    try {
        const [results, fields] = await connection.query(sql, params);
        return { results, fields };
    } catch (error) {
        console.error('MySQL query error:', error);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Execute a query in a transaction
 * @param {Function} callback - Async function that performs queries on the connection
 * @returns {Promise<*>} The result of the callback function
 */
async function transaction(callback) {
    const connection = await connect().getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        console.error('MySQL transaction error:', error);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Close all connections in the pool
 * @returns {Promise<void>}
 */
async function close() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('MySQL connection pool closed');
    }
}

module.exports = {
    connect,
    query,
    transaction,
    close,
    getPool: () => pool
};
