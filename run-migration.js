const { db } = require('./src/db');
const { up } = require('./src/migrations/20250702_change_zk_id_to_text');

async function runMigration() {
    try {
        console.log('Starting migration...');
        await up();
        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        db.close();
    }
}

runMigration();
