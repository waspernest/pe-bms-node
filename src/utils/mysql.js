/** 
 * Utils for mysql transactions
 * 1. Insert
 * 2. Update
 * 3. Delete
**/ 

const { query, transaction } = require('../mysql');

class MySQLUtils {
    /**
     * Insert a new record into the specified table
     * @param {string} table - Table name
     * @param {Object} data - Object containing column-value pairs
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.returnId] - Whether to return the inserted ID
     * @returns {Promise<Object>} - Result object with success status and data/error
     */
    static async insert(table, data, options = {}) {
        try {
            if (!table || !data || Object.keys(data).length === 0) {
                throw new Error('Table name and data are required');
            }

            const columns = Object.keys(data);
            const values = Object.values(data);
            const placeholders = columns.map(() => '?').join(', ');
            const queryStr = `INSERT INTO \`${table}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
            
            const result = await query(queryStr, values);
            
            if (options.returnId) {
                return { success: true, data: { id: result.insertId } };
            }
            
            return { success: true, data: result };
        } catch (error) {
            console.error('Insert error:', error);
            return { 
                success: false, 
                error: error.message,
                code: error.code
            };
        }
    }

    /**
     * Update a record in the specified table
     * @param {string} table - Table name
     * @param {Object} data - Object containing column-value pairs to update
     * @param {Object} conditions - Object containing where conditions (column-value pairs)
     * @returns {Promise<Object>} - Result object with success status and data/error
     */
    static async update(table, data, conditions) {
        try {
            if (!table || !data || Object.keys(data).length === 0 || !conditions || Object.keys(conditions).length === 0) {
                throw new Error('Table name, data, and conditions are required');
            }

            const setClause = Object.keys(data).map(col => `\`${col}\` = ?`).join(', ');
            const whereClause = Object.keys(conditions).map(col => `\`${col}\` = ?`).join(' AND ');
            const values = [...Object.values(data), ...Object.values(conditions)];
            
            const queryStr = `UPDATE \`${table}\` SET ${setClause} WHERE ${whereClause}`;
            const result = await query(queryStr, values);
            
            return { 
                success: true, 
                data: { 
                    affectedRows: result.affectedRows,
                    changedRows: result.changedRows
                } 
            };
        } catch (error) {
            console.error('Update error:', error);
            return { 
                success: false, 
                error: error.message,
                code: error.code
            };
        }
    }

    /**
     * Delete records from the specified table
     * @param {string} table - Table name
     * @param {Object} conditions - Object containing where conditions (column-value pairs)
     * @returns {Promise<Object>} - Result object with success status and data/error
     */
    static async delete(table, conditions) {
        try {
            if (!table || !conditions || Object.keys(conditions).length === 0) {
                throw new Error('Table name and conditions are required');
            }

            const whereClause = Object.keys(conditions).map(col => `\`${col}\` = ?`).join(' AND ');
            const values = Object.values(conditions);
            
            const queryStr = `DELETE FROM \`${table}\` WHERE ${whereClause}`;
            const result = await query(queryStr, values);
            
            return { 
                success: true, 
                data: { 
                    affectedRows: result.affectedRows
                } 
            };
        } catch (error) {
            console.error('Delete error:', error);
            return { 
                success: false, 
                error: error.message,
                code: error.code
            };
        }
    }

    /**
     * Find records in the specified table
     * @param {string} table - Table name
     * @param {Object} [conditions] - Object containing where conditions (column-value pairs)
     * @param {Array} [columns] - Array of columns to select (default: all)
     * @param {Object} [options] - Additional options
     * @param {number} [options.limit] - Limit the number of results
     * @param {number} [options.offset] - Offset for pagination
     * @param {Array} [options.orderBy] - Array of objects for ordering: [{ column: 'name', direction: 'ASC' }]
     * @returns {Promise<Object>} - Result object with success status and data/error
     */
    static async find(table, conditions = {}, columns = ['*'], options = {}) {
        try {
            if (!table) {
                throw new Error('Table name is required');
            }

            const selectColumns = columns.join(', ');
            let queryStr = `SELECT ${selectColumns} FROM \`${table}\``;
            const values = [];
            
            // Add WHERE clause if conditions are provided
            if (Object.keys(conditions).length > 0) {
                const whereClause = Object.keys(conditions).map(col => `\`${col}\` = ?`).join(' AND ');
                queryStr += ` WHERE ${whereClause}`;
                values.push(...Object.values(conditions));
            }
            
            // Add ORDER BY if specified
            if (options.orderBy && Array.isArray(options.orderBy) && options.orderBy.length > 0) {
                const orderClause = options.orderBy
                    .map(order => `\`${order.column}\` ${order.direction || 'ASC'}`)
                    .join(', ');
                queryStr += ` ORDER BY ${orderClause}`;
            }
            
            // Add LIMIT and OFFSET if specified
            if (options.limit) {
                queryStr += ' LIMIT ?';
                values.push(parseInt(options.limit, 10));
                
                if (options.offset) {
                    queryStr += ' OFFSET ?';
                    values.push(parseInt(options.offset, 10));
                }
            }
            
            const result = await query(queryStr, values);
            return { success: true, data: result };
            
        } catch (error) {
            console.error('Find error:', error);
            return { 
                success: false, 
                error: error.message,
                code: error.code
            };
        }
    }

    /**
     * Find a single record by ID
     * @param {string} table - Table name
     * @param {string|number} id - Record ID
     * @param {string} [idColumn='id'] - ID column name
     * @returns {Promise<Object>} - Result object with success status and data/error
     */
    static async findById(table, id, idColumn = 'id') {
        try {
            if (!table || id === undefined || id === null) {
                throw new Error('Table name and ID are required');
            }
            
            const result = await this.find(table, { [idColumn]: id });
            
            if (result.success && result.data && result.data.length > 0) {
                return { 
                    success: true, 
                    data: result.data[0] 
                };
            }
            
            return { 
                success: false, 
                error: 'Record not found',
                code: 'NOT_FOUND'
            };
            
        } catch (error) {
            console.error('Find by ID error:', error);
            return { 
                success: false, 
                error: error.message,
                code: error.code
            };
        }
    }
}

module.exports = MySQLUtils;