// SQLite DB setup for Node.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database file will be in the project root, named 'database.sqlite'
const dbPath = path.resolve(__dirname, '../database.sqlite');

// Singleton DB instance
let db;

function connect() {
  if (!db) {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Failed to connect to SQLite database:', err.message);
      } else {
        console.log('Connected to SQLite database at', dbPath);
      }
    });
  }
  return db;
}

/**
 * Alter a table's structure
 * @param {string} table - Name of the table to alter
 * @param {Object} options - Alteration options
 * @param {string} [options.action='add'] - Type of alteration: 'add', 'drop', 'rename', or 'modify'
 * @param {string} [options.column] - Column name for the operation
 * @param {string} [options.type] - Column data type (required for 'add' and 'modify' actions)
 * @param {string} [options.newName] - New column name (for 'rename' action)
 * @param {string} [options.default] - Default value for the column
 * @param {boolean} [options.notNull] - Whether the column should be NOT NULL
 * @param {string} [options.after] - Column name to place the new column after (MySQL syntax)
 * @param {string} [options.sql] - Raw SQL to execute (if provided, other options are ignored)
 * @returns {Promise<void>}
 */
function alterTable(table, options = {}) {
  const dbInstance = connect();
  
  return new Promise((resolve, reject) => {
    try {
      let sql;
      
      if (options.sql) {
        // Use raw SQL if provided
        sql = options.sql;
      } else {
        // Build SQL dynamically based on action
        const action = options.action?.toLowerCase() || 'add';
        const column = options.column;
        
        if (!column && action !== 'custom') {
          throw new Error('Column name is required for this operation');
        }
        
        switch (action) {
          case 'add':
            if (!options.type) throw new Error('Column type is required for ADD COLUMN');
            sql = `ALTER TABLE ${table} ADD COLUMN ${column} ${options.type}`;
            if (options.default !== undefined) sql += ` DEFAULT ${options.default}`;
            if (options.notNull) sql += ' NOT NULL';
            if (options.after) sql += ` AFTER ${options.after}`;
            break;
            
          case 'drop':
            sql = `ALTER TABLE ${table} DROP COLUMN ${column}`;
            break;
            
          case 'rename':
            if (!options.newName) throw new Error('newName is required for RENAME COLUMN');
            sql = `ALTER TABLE ${table} RENAME COLUMN ${column} TO ${options.newName}`;
            break;
            
          case 'modify':
            if (!options.type) throw new Error('Column type is required for MODIFY COLUMN');
            sql = `ALTER TABLE ${table} MODIFY COLUMN ${column} ${options.type}`;
            if (options.default !== undefined) sql += ` DEFAULT ${options.default}`;
            if (options.notNull) sql += ' NOT NULL';
            break;
            
          default:
            throw new Error(`Unsupported alter action: ${action}`);
        }
      }
      
      console.log(`Executing SQL: ${sql}`);
      
      dbInstance.run(sql, (err) => {
        if (err) {
          console.error(`Failed to alter table ${table}:`, err.message);
          reject(err);
        } else {
          console.log(`Table ${table} altered successfully`);
          resolve();
        }
      });
      
    } catch (error) {
      console.error('Error preparing alter table statement:', error.message);
      reject(error);
    }
  });
}

/**
 * Create a new table with the given schema
 * @param {string} tableName - Name of the table to create
 * @param {Object} schema - Table schema definition
 * @param {Object} options - Additional options
 * @param {boolean} [options.ifNotExists=true] - Add IF NOT EXISTS clause
 * @param {boolean} [options.force=false] - Drop table if it exists and recreate
 * @returns {Promise<void>}
 */
async function createTable(tableName, schema, options = {}) {
  const {
    ifNotExists = true,
    force = false
  } = options;

  const dbInstance = connect();
  
  return new Promise(async (resolve, reject) => {
    try {
      // Check if table exists
      const tableExists = await new Promise((resolve) => {
        dbInstance.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          [tableName],
          (err, row) => resolve(!!row)
        );
      });

      // Handle existing table
      if (tableExists) {
        if (force) {
          console.log(`Dropping existing table ${tableName}...`);
          await new Promise((resolve, reject) => {
            dbInstance.run(`DROP TABLE ${tableName}`, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } else if (!ifNotExists) {
          throw new Error(`Table ${tableName} already exists`);
        } else {
          console.log(`Table ${tableName} already exists, skipping...`);
          return resolve();
        }
      }

      // Build column definitions
      const columns = Object.entries(schema.columns)
        .map(([name, def]) => {
          const parts = [name, def.type];
          if (def.primaryKey) parts.push('PRIMARY KEY');
          if (def.autoIncrement) parts.push('AUTOINCREMENT');
          if (def.unique) parts.push('UNIQUE');
          if (def.notNull) parts.push('NOT NULL');
          if (def.default !== undefined) parts.push(`DEFAULT ${def.default}`);
          if (def.references) {
            parts.push(`REFERENCES ${def.references.table}(${def.references.column})`);
          }
          return parts.join(' ');
        });

      // Add constraints if any
      const constraints = schema.constraints || [];
      
      // Build SQL
      const ifNotExistsClause = ifNotExists ? 'IF NOT EXISTS ' : '';
      const sql = `
        CREATE TABLE ${ifNotExistsClause}${tableName} (
          ${[...columns, ...constraints].join(',\n')}
        )
      `;

      console.log(`Creating table ${tableName}...`);
      console.log('Executing:', sql.replace(/\s+/g, ' ').trim());
      
      await new Promise((resolve, reject) => {
        dbInstance.run(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Create indexes if specified
      if (schema.indexes) {
        for (const [indexName, indexCols] of Object.entries(schema.indexes)) {
          const indexSql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${indexCols.join(', ')})`;
          await new Promise((resolve, reject) => {
            dbInstance.run(indexSql, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }

      console.log(`Table ${tableName} created successfully`);
      resolve();
    } catch (error) {
      console.error(`Error creating table ${tableName}:`, error);
      reject(error);
    }
  });
}

/**
 * Delete one or more records from a specified table by id(s).
 * @param {string} table - Table name (must be in allowed list).
 * @param {number|number[]} ids - Single id or array of ids to delete.
 * @returns {Promise<number>} Number of rows deleted.
 */
function deleteRecordsById(table, ids) {
  // Only allow deletion from known tables
  const allowedTables = ['users', 'admins', 'deleted_users']; // Add more table names as needed
  if (!allowedTables.includes(table)) {
      return Promise.reject(new Error('Invalid table name'));
  }

  return new Promise((resolve, reject) => {
      let placeholders, params;
      if (Array.isArray(ids)) {
          if (ids.length === 0) return resolve(0);
          placeholders = ids.map(() => '?').join(',');
          params = ids;
      } else {
          placeholders = '?';
          params = [ids];
      }
      const sql = `DELETE FROM ${table} WHERE id IN (${placeholders})`;
      db.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve(this.changes);
      });
  });
}

module.exports = {
  db: () => connect(), // Always get the singleton instance
  dbPath,
  createTable,
  alterTable,
  deleteRecordsById
};

