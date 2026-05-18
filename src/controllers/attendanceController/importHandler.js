const xlsx = require('xlsx');
const { Readable } = require('stream');
const csv = require('csv-parser');
const fs = require('fs').promises;
const path = require('path');
const { query } = require('../../mysql');
const os = require('os'); // Add this at the top

// Global progress tracker
let importProgress = {
  total: 0,
  processed: 0,
  status: 'idle',
  message: '',
  importId: null
};

// Function to get current progress
function getImportProgress() {
  return { ...importProgress };
}

const updateProgress = (current, total) => {
    const percentage = Math.round((current / total) * 100);
    if (process.stdout.clearLine && process.stdout.cursorTo) {
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(`Processing: ${percentage}% (${current}/${total})`);
    } else {
        console.log(`Processing: ${percentage}% (${current}/${total})`);
    }
};

class AttendanceImportHandler {
    async processExcelFile(buffer) {
        console.log('Processing Excel buffer...');
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
        
        console.log(`Found sheet: ${sheetName}`);
        
        const data = xlsx.utils.sheet_to_json(ws, {
            raw: false,
            dateNF: 'yyyy-mm-dd',
            defval: ''
        });
        
        console.log(`Processed ${data.length} rows from Excel`);
        return data.map(row => this.formatExcelRow(row));
    }
    
    async processCsvFile(buffer) {
        console.log('Processing CSV buffer...');
        return new Promise((resolve, reject) => {
            const results = [];
            const bufferStream = new Readable();
            bufferStream.push(buffer);
            bufferStream.push(null);
            
            bufferStream
                .pipe(csv({
                    separator: '\t',
                    skipLines: 0,
                    strict: false,
                    trim: true,
                    skipEmptyLines: true
                }))
                .on('headers', (headers) => {
                    console.log('CSV Headers:', headers);
                })
                .on('data', (data) => {
                    results.push(data);
                    if (results.length % 1000 === 0) {
                        console.log(`Processed ${results.length} rows...`);
                    }
                })
                .on('end', () => {
                    console.log(`Finished processing CSV. Total rows: ${results.length}`);
                    if (results.length > 0) {
                        console.log('First row sample:', JSON.stringify(results[0]));
                    }
                    resolve(results);
                })
                .on('error', (error) => {
                    console.error('Error parsing CSV:', error);
                    reject(error);
                });
        });
    }
    
    formatExcelRow(row) {
        const formattedRow = { ...row };
        
        if (formattedRow.LOG_DATE) {
            if (formattedRow.LOG_DATE instanceof Date) {
                const y = formattedRow.LOG_DATE.getFullYear();
                const m = String(formattedRow.LOG_DATE.getMonth() + 1).padStart(2, '0');
                const d = String(formattedRow.LOG_DATE.getDate()).padStart(2, '0');
                formattedRow.LOG_DATE = `${y}-${m}-${d}`;
            }
        }
        
        return formattedRow;
    }
    
    async processDatFile(buffer) {
        console.log('Processing DAT file buffer...');
        const content = buffer.toString('utf8');
        
        try {
            // Write the raw content to dat_log.txt
            //const logPath = path.join(__dirname, 'dat_log.txt');
            const logPath = path.join(os.tmpdir(), 'dat_log.txt');

            await fs.writeFile(logPath, content, 'utf8');
            console.log(`DAT file content written to: ${logPath}`);
            
            // Parse the DAT file
            const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
            console.log(`Found ${lines.length} lines in DAT file`);
            
            if (lines.length === 0) {
                throw new Error('DAT file is empty');
            }
            
            // Parse each line into { employeeId, timestamp }
            const records = [];

            const parseDatTimestampToLocalDate = (timestamp) => {
                const raw = (timestamp || '').toString().trim();
                if (!raw) return null;

                // Parse only the leading local date/time portion and ignore any trailing content
                // (e.g. milliseconds, timezone suffix like Z/+08:00, extra columns).
                // This prevents JS Date(string) timezone conversion from shifting the calendar date.
                const m = raw.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
                if (m) {
                    const year = Number(m[1]);
                    const month = Number(m[2]);
                    const day = Number(m[3]);
                    const hour = m[4] != null ? Number(m[4]) : 0;
                    const minute = m[5] != null ? Number(m[5]) : 0;
                    const second = m[6] != null ? Number(m[6]) : 0;

                    const dt = new Date(year, month - 1, day, hour, minute, second);
                    if (Number.isNaN(dt.getTime())) return null;
                    return dt;
                }

                return null;
            };

            const formatLocalDate = (dt) => {
                const y = dt.getFullYear();
                const mo = String(dt.getMonth() + 1).padStart(2, '0');
                const da = String(dt.getDate()).padStart(2, '0');
                return `${y}-${mo}-${da}`;
            };

            const formatLocalTime = (dt) => {
                const hh = String(dt.getHours()).padStart(2, '0');
                const mm = String(dt.getMinutes()).padStart(2, '0');
                const ss = String(dt.getSeconds()).padStart(2, '0');
                return `${hh}:${mm}:${ss}`;
            };

            for (const line of lines) {
                const parts = line.split('\t').map(part => part.trim());
                if (parts.length >= 2) {
                    const employeeId = parts[0];
                    const timestamp = parts[1];
                    
                    // Parse the timestamp
                    const date = parseDatTimestampToLocalDate(timestamp);
                    if (!date) {
                        console.error(`Invalid timestamp format: ${timestamp}`);
                        continue;
                    }
                    
                    // Format date and time without external dependencies
                    const dateStr = formatLocalDate(date); // YYYY-MM-DD (local)
                    const timeStr = formatLocalTime(date); // HH:MM:SS (local)
                    
                    records.push({
                        employeeId,
                        timestamp: date,
                        date: dateStr,
                        time: timeStr
                    });
                }
            }
            
            // Sort records by employee ID, date, and time
            records.sort((a, b) => {
                if (a.employeeId !== b.employeeId) {
                    return a.employeeId.localeCompare(b.employeeId);
                }
                if (a.date !== b.date) {
                    return a.date.localeCompare(b.date);
                }
                return a.time.localeCompare(b.time);
            });
            
            // Group by employee and date
            const attendanceMap = new Map();
            
            for (const record of records) {
                const key = `${record.employeeId}_${record.date}`;
                
                if (!attendanceMap.has(key)) {
                    // First entry for this employee/date
                    attendanceMap.set(key, {
                        zk_id: record.employeeId,
                        log_date: record.date,
                        time_in: record.time,
                        time_out: record.time  // Initialize time_out with first time
                    });
                } else {
                    const attendance = attendanceMap.get(key);
                    // Update time_out if this is a later time
                    if (record.time > attendance.time_out) {
                        attendance.time_out = record.time;
                    }
                    // Update time_in if this is an earlier time
                    if (record.time < attendance.time_in) {
                        attendance.time_in = record.time;
                    }
                }
            }
            
            // Convert map to array for processing
            const attendanceRecords = Array.from(attendanceMap.values());
            
            console.log(`Processed ${attendanceRecords.length} attendance records`);
            if (attendanceRecords.length > 0) {
                console.log('Sample record:', JSON.stringify(attendanceRecords[0]));
            }
            
            return attendanceRecords;
            
        } catch (error) {
            console.error('Error in DAT file processing:', error);
            throw error;
        }
    }
    
    async importToDatabase(rows, importId = Date.now().toString()) {
        const insertedRows = [];
        const updatedRows = [];
        const skippedRows = [];
        const errors = [];
        const totalRows = rows.length;
        const startTime = Date.now();
        
        // Initialize progress
        importProgress = {
          total: totalRows,
          processed: 0,
          status: 'processing',
          message: 'Starting import...',
          importId
        };
        
        console.log(`Starting database import for ${totalRows} attendance records...`);
        
        // Function to update progress
        // const updateProgress = (current, total) => {
        //     const percentage = Math.round((current / total) * 100);
        //     process.stdout.clearLine();
        //     process.stdout.cursorTo(0);
        //     process.stdout.write(`Processing: ${percentage}% (${current}/${total})`);
        // };
        
        for (const [index, row] of rows.entries()) {
            // Update progress
            if (index % 10 === 0 || index === totalRows - 1) {
                importProgress.processed = index + 1;
                importProgress.message = `Processing record ${index + 1} of ${totalRows}...`;
                updateProgress(index + 1, totalRows);
            }
            
            try {
                const { zk_id, log_date, time_in, time_out } = row;
                
                if (!zk_id || !log_date || !time_in) {
                    errors.push({
                        row,
                        error: 'Missing required fields (zk_id, log_date, and time_in are required)',
                        status: 'error'
                    });
                    continue;
                }
                
                // Check for existing record for this employee and date
                const existingResult = await query(
                    `SELECT id, time_in, time_out FROM attendance 
                    WHERE zk_id = ? AND log_date = ?`,
                    [zk_id, log_date]
                );
                
                const existing = existingResult && existingResult[0] ? existingResult[0] : null;
                
                if (existing) {
                    // Always update with the new data from the log file
                    const updates = [
                        `time_in = '${time_in}'`,
                        time_out ? `time_out = '${time_out}'` : 'time_out = NULL',
                        'updated_at = NOW()'
                    ];
                    
                    await query(
                        `UPDATE attendance 
                        SET ${updates.join(', ')} 
                        WHERE id = ?`,
                        [existing.id]
                    );
                    updatedRows.push({ ...row, id: existing.id, status: 'updated' });
                } else {
                    // Insert new record
                    try {
                        const result = await query(
                            `INSERT INTO attendance 
                            (zk_id, log_date, time_in, time_out, straight_shift_id, created_at, updated_at)
                            VALUES (?, ?, ?, ?, NULL, NOW(), NOW())`,
                            [zk_id, log_date, time_in, time_out || null]
                        );
                        
                        insertedRows.push({
                            ...row,
                            id: result.insertId,
                            status: 'inserted'
                        });
                    } catch (error) {
                        const errorMsg = `Error inserting record: ${error.message}`;
                        console.error(errorMsg);
                        importProgress.message = errorMsg;
                        errors.push({
                            row,
                            error: error.message,
                            status: 'error'
                        });
                    }
                }
                
            } catch (error) {
                const errorMsg = `Error processing record ${index + 1}: ${error.message}`;
                console.error(errorMsg);
                importProgress.message = errorMsg;
                errors.push({
                    row,
                    error: error.message,
                    status: 'error'
                });
            }
        }
        
        return { 
            insertedRows,
            updatedRows,
            skippedRows,
            errors,
            totalProcessed: rows.length,
            totalInserted: insertedRows.length,
            totalUpdated: updatedRows.length,
            totalSkipped: skippedRows.length,
            totalFailed: errors.length,
            time: `${((Date.now() - startTime) / 1000).toFixed(1)}s`
        };
    }
}

// Export individual functions for direct usage
module.exports = {
  processExcelFile: (buffer) => new AttendanceImportHandler().processExcelFile(buffer),
  processCsvFile: (buffer) => new AttendanceImportHandler().processCsvFile(buffer),
  processDatFile: (buffer) => new AttendanceImportHandler().processDatFile(buffer),
  importToDatabase: (data) => new AttendanceImportHandler().importToDatabase(data),
  getImportProgress,
  handler: new AttendanceImportHandler()
};
