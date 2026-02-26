const { connect } = require('./src/mysql');

async function test() {
    const pool = connect();
    const connection = await pool.getConnection();
    try {
        console.log('=== DETAILED ATTENDANCE DEBUG ===');
        
        // Check total attendance records in the date range
        const [attendance] = await connection.query(
            'SELECT COUNT(*) as count FROM attendance WHERE DATE(log_date) BETWEEN ? AND ?',
            ['2026-02-01', '2026-02-15']
        );
        console.log('Total attendance records (Feb 1-15, 2026):', attendance[0].count);
        
        // Check ALL attendance records for debugging
        const [allAttendance] = await connection.query(
            'SELECT COUNT(*) as count FROM attendance'
        );
        console.log('Total attendance records in database:', allAttendance[0].count);
        
        // Get sample users from coal_handling
        const [users] = await connection.query(
            'SELECT id, zk_id, first_name, last_name FROM users WHERE department = ? LIMIT 3',
            ['coal_handling']
        );
        console.log('Sample coal_handling users:', users);
        
        if (users.length > 0) {
            const firstUser = users[0];
            console.log(`\n=== Checking user: ${firstUser.first_name} (zk_id: ${firstUser.zk_id}) ===`);
            
            // Check attendance for this user in Feb 2026
            const [userAttendance] = await connection.query(
                'SELECT id, zk_id, log_date, time_in, time_out FROM attendance WHERE zk_id = ? AND DATE(log_date) BETWEEN ? AND ?',
                [firstUser.zk_id, '2026-02-01', '2026-02-15']
            );
            console.log(`Attendance for ${firstUser.first_name} in Feb 2026:`, userAttendance);
            
            // Check ALL attendance records for this user
            const [allUserAttendance] = await connection.query(
                'SELECT id, zk_id, log_date, time_in, time_out FROM attendance WHERE zk_id = ? ORDER BY log_date DESC LIMIT 10',
                [firstUser.zk_id]
            );
            console.log(`Last 10 attendance records for ${firstUser.first_name}:`, allUserAttendance);
            
            // Check attendance count for this user
            const [userAttendanceCount] = await connection.query(
                'SELECT COUNT(*) as count FROM attendance WHERE zk_id = ?',
                [firstUser.zk_id]
            );
            console.log(`Total attendance records for ${firstUser.first_name}:`, userAttendanceCount[0].count);
        }
        
        // Check attendance date range in database
        const [dateRange] = await connection.query(
            'SELECT MIN(log_date) as min_date, MAX(log_date) as max_date FROM attendance'
        );
        console.log('\nAttendance date range in database:', dateRange[0]);
        
        // Check recent attendance records
        const [recentAttendance] = await connection.query(
            'SELECT zk_id, log_date, time_in, time_out FROM attendance ORDER BY log_date DESC LIMIT 5'
        );
        console.log('Recent attendance records:', recentAttendance);
        
    } catch (error) {
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        connection.release();
        process.exit(0);
    }
}

test();
