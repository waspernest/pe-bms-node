const { db } = require('./src/db');
const { up } = require('./src/migrations/20250703140613_add_user_work_fields');

async function runMigration() {
    try {
        console.log('Starting migration...');
        await up();
        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

runMigration();
