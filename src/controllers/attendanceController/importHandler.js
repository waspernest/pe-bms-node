const xlsx = require('xlsx');
const { Readable } = require('stream');
const csv = require('csv-parser');
const { query } = require('../../mysql');

class AttendanceImportHandler {
    async processExcelFile(buffer) {
        const workbook = xlsx.read(buffer, { 
            type: 'buffer',
            cellDates: true,
            cellText: true,
            cellNF: true,
            dateNF: 'yyyy-mm-dd',
            raw: false
        });
        
        const sheetName = workbook.SheetNames[0];
        const ws = workbook.Sheets[sheetName];
        
        const data = xlsx.utils.sheet_to_json(ws, {
            raw: false,
            dateNF: 'yyyy-mm-dd',
            defval: ''
        });
        
        return data.map(row => this.formatExcelRow(row));
    }
    
    async processCsvFile(buffer) {
        return new Promise((resolve, reject) => {
            const results = [];
            const bufferStream = new Readable();
            bufferStream.push(buffer);
            bufferStream.push(null);
            
            bufferStream
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', () => resolve(results))
                .on('error', reject);
        });
    }
    
    formatExcelRow(row) {
        const formattedRow = { ...row };
        
        // Format LOG_DATE if it exists
        if (formattedRow.LOG_DATE) {
            if (formattedRow.LOG_DATE instanceof Date) {
                formattedRow.LOG_DATE = formattedRow.LOG_DATE.toISOString().split('T')[0];
            } else if (typeof formattedRow.LOG_DATE === 'number') {
                const date = new Date((formattedRow.LOG_DATE - 25569) * 86400 * 1000);
                formattedRow.LOG_DATE = date.toISOString().split('T')[0];
            }
        }
        
        // Format TIME_IN and TIME_OUT if they exist
        ['TIME_IN', 'TIME_OUT'].forEach(field => {
            if (formattedRow[field] !== undefined) {
                if (typeof formattedRow[field] === 'number') {
                    const totalSeconds = Math.round(formattedRow[field] * 86400);
                    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
                    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
                    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
                    formattedRow[field] = `${hours}:${minutes}:${seconds}`;
                }
            }
        });
        
        return formattedRow;
    }
    
    async importToDatabase(rows) {
        const insertedRows = [];
        const errors = [];
        
        for (const row of rows) {
            try {
                const { ZK_ID, LOG_DATE, TIME_IN, TIME_OUT } = row;
                
                if (!ZK_ID || !LOG_DATE || !TIME_IN) {
                    errors.push({
                        row,
                        error: 'Missing required fields (ZK_ID, LOG_DATE, and TIME_IN are required)'
                    });
                    continue;
                }
                
                const existingRecord = await query(
                    `SELECT id FROM attendance_logs 
                    WHERE zk_id = ? 
                    AND log_date = ? 
                    AND time_in = ? 
                    AND (time_out = ? OR (time_out IS NULL AND ? IS NULL))`,
                    [ZK_ID, LOG_DATE, TIME_IN, TIME_OUT || null, TIME_OUT || null]
                );

                if (existingRecord.length > 0) {
                    insertedRows.push({
                        ...row,
                        id: existingRecord[0].id,
                        status: 'skipped',
                        message: 'Duplicate record found'
                    });
                } else {
                    const result = await query(
                        `INSERT INTO attendance_logs 
                        (zk_id, log_date, time_in, time_out, created_at) 
                        VALUES (?, ?, ?, ?, NOW())
                        ON DUPLICATE KEY UPDATE 
                            time_out = COALESCE(VALUES(time_out), time_out),
                            updated_at = NOW()`,
                        [ZK_ID, LOG_DATE, TIME_IN, TIME_OUT || null]
                    );
                    
                    insertedRows.push({
                        ...row,
                        id: result.insertId,
                        status: 'inserted'
                    });
                }
            } catch (error) {
                console.error('Error inserting row:', error);
                errors.push({
                    row,
                    error: error.message
                });
            }
        }
        
        return { insertedRows, errors };
    }
    
    generateResultMessage({ insertedRows, errors }) {
        const successMessage = `Successfully processed ${insertedRows.length} records`;
        const errorMessage = errors.length > 0 ? `, ${errors.length} failed` : '';
        return successMessage + errorMessage;
    }
}

module.exports = new AttendanceImportHandler();
