const db = require('../db').db();

async function columnExists(tableName, columnName) {
  return new Promise((resolve) => {
    db.get(
      `SELECT name FROM pragma_table_info('${tableName}') WHERE name = ?`,
      [columnName],
      (err, row) => {
        resolve(!!row);
      }
    );
  });
}

async function runMigration() {
  const columns = [
    {
      name: 'has_fingerprint',
      type: 'BOOLEAN',
      default: '0',
      notNull: true
    },
    {
      name: 'status',
      type: 'BOOLEAN',
      default: '1',
      notNull: true
    },
    {
      name: 'created_at',
      type: 'TIMESTAMP',
      notNull: true
    },
    {
      name: 'updated_at',
      type: 'TIMESTAMP',
      notNull: true
    }
  ];

  try {
    console.log('Starting database migration...');
    
    // Step 1: Add columns as NULLABLE first
    for (const column of columns) {
      const exists = await columnExists('users', column.name);
      if (exists) {
        console.log(`Column ${column.name} already exists, skipping...`);
        continue;
      }

      console.log(`Adding column ${column.name} as nullable...`);
      await new Promise((resolve, reject) => {
        const sql = `ALTER TABLE users ADD COLUMN ${column.name} ${column.type}`;
        console.log(`Executing: ${sql}`);
        db.run(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Step 2: Update existing rows with default values
    console.log('Updating existing rows with default values...');
    await new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      const sql = `
        UPDATE users 
        SET 
          has_fingerprint = COALESCE(has_fingerprint, 0),
          status = COALESCE(status, 1),
          created_at = COALESCE(created_at, ?),
          updated_at = COALESCE(updated_at, ?)
      `;
      db.run(sql, [now, now], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Step 3: Alter columns to be NOT NULL
    for (const column of columns) {
      if (!column.notNull) continue;
      
      console.log(`Altering column ${column.name} to be NOT NULL...`);
      // SQLite doesn't support ALTER COLUMN directly, so we'll skip this step
      // The columns will remain nullable in the schema but will have default values
      console.log(`Note: SQLite doesn't support ALTER COLUMN directly. Please verify constraints in your application code.`);
    }

    console.log('Migration completed successfully');
    console.log('Note: For SQLite, NOT NULL constraints should be enforced in your application code');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration().catch(console.error);