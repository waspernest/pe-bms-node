const { db } = require('../db');

const up = async () => {
    // Create a backup of users table
    await db.exec(`
        CREATE TABLE users_backup (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            zk_id TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Copy data from old table to backup
    await db.exec(`
        INSERT INTO users_backup (id, first_name, last_name, zk_id, password, role, created_at)
        SELECT id, first_name, last_name, zk_id, password, role, created_at FROM users
    `);
    
    // Drop and recreate the users table with TEXT zk_id
    await db.exec(`DROP TABLE users`);
    
    await db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            zk_id TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Copy data back
    await db.exec(`
        INSERT INTO users (id, first_name, last_name, zk_id, password, role, created_at)
        SELECT id, first_name, last_name, CAST(zk_id AS TEXT), password, role, created_at 
        FROM users_backup
    `);
    
    // Drop the backup table
    await db.exec(`DROP TABLE users_backup`);
    
    // Do the same for deleted_users table
    await db.exec(`
        CREATE TABLE deleted_users_backup (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            zk_id TEXT NOT NULL UNIQUE,
            deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deleted_by INTEGER
        )
    `);
    
    await db.exec(`
        INSERT INTO deleted_users_backup (id, user_id, zk_id, deleted_at, deleted_by)
        SELECT id, user_id, zk_id, deleted_at, deleted_by FROM deleted_users
    `);
    
    await db.exec(`DROP TABLE deleted_users`);
    
    await db.exec(`
        CREATE TABLE deleted_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            zk_id TEXT NOT NULL UNIQUE,
            deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deleted_by INTEGER
        )
    `);
    
    await db.exec(`
        INSERT INTO deleted_users (id, user_id, zk_id, deleted_at, deleted_by)
        SELECT id, user_id, CAST(zk_id AS TEXT), deleted_at, deleted_by 
        FROM deleted_users_backup
    `);
    
    await db.exec(`DROP TABLE deleted_users_backup`);
};

const down = async () => {
    // To revert, you would need to handle the conversion back to INTEGER
    // But since we're not implementing the down migration, we'll leave it empty
    console.warn('No down migration implemented for changing zk_id to TEXT');
};

module.exports = { up, down };
