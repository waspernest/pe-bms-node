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
    // Terminal progress spam intentionally silenced - see importToDatabase().
};

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
                .pipe(csv({
                    separator: '\t',
                    skipLines: 0,
                    strict: false,
                    trim: true,
                    skipEmptyLines: true
                }))
                .on('data', (data) => {
                    results.push(data);
                })
                .on('end', () => {
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
    
    // Shared timestamp/format helpers used by both the raw parser and grouping logic
    _parseDatTimestampToLocalDate(timestamp) {
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
    }

    _formatLocalDate(dt) {
        const y = dt.getFullYear();
        const mo = String(dt.getMonth() + 1).padStart(2, '0');
        const da = String(dt.getDate()).padStart(2, '0');
        return `${y}-${mo}-${da}`;
    }

    _formatLocalTime(dt) {
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        const ss = String(dt.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }

    // Returns the number of minutes between two "HH:MM:SS" times on the same day.
    // Always non-negative (assumes timeA <= timeB, which holds for time_in/time_out here).
    _minutesBetween(timeA, timeB) {
        const toMinutes = (t) => {
            const [h, m, s] = t.split(':').map(Number);
            return (h * 60) + m + (s / 60);
        };
        return Math.abs(toMinutes(timeB) - toMinutes(timeA));
    }

    // Parses the raw DAT buffer into individual punch records: { employeeId, timestamp, date, time }
    // Sorted by employeeId, date, time. This is the single source of truth for raw punches -
    // both processDatFile() and analyzeDatFileTimeMatches() build on top of this so the
    // "test" path can never drift from the real import path.
    _parseRawDatPunches(buffer) {
        const content = buffer.toString('utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

        if (lines.length === 0) {
            throw new Error('DAT file is empty');
        }

        const records = [];

        for (const line of lines) {
            const parts = line.split('\t').map(part => part.trim());
            if (parts.length >= 2) {
                const employeeId = parts[0];
                const timestamp = parts[1];

                const date = this._parseDatTimestampToLocalDate(timestamp);
                if (!date) {
                    console.error(`Invalid timestamp format: ${timestamp}`);
                    continue;
                }

                const dateStr = this._formatLocalDate(date); // YYYY-MM-DD (local)
                const timeStr = this._formatLocalTime(date); // HH:MM:SS (local)

                records.push({
                    employeeId,
                    timestamp: date,
                    date: dateStr,
                    time: timeStr
                });
            }
        }

        records.sort((a, b) => {
            if (a.employeeId !== b.employeeId) {
                return a.employeeId.localeCompare(b.employeeId);
            }
            if (a.date !== b.date) {
                return a.date.localeCompare(b.date);
            }
            return a.time.localeCompare(b.time);
        });

        return records;
    }

    async processDatFile(buffer) {
        try {
            const logPath = path.join(os.tmpdir(), 'dat_log.txt');
            await fs.writeFile(logPath, buffer.toString('utf8'), 'utf8');

            const records = this._parseRawDatPunches(buffer);

            // Group by employee and date
            const attendanceMap = new Map();
            
            for (const record of records) {
                const key = `${record.employeeId}_${record.date}`;
                
                if (!attendanceMap.has(key)) {
                    // First entry for this employee/date. time_out stays null until
                    // a second, distinct punch shows up that day - a single scan is
                    // NOT a time_in/time_out pair and must never be stored as one.
                    attendanceMap.set(key, {
                        zk_id: record.employeeId,
                        log_date: record.date,
                        time_in: record.time,
                        time_out: null
                    });
                } else {
                    const attendance = attendanceMap.get(key);
                    // Update time_out if this is a later time (or the first second punch of the day)
                    if (attendance.time_out === null || record.time > attendance.time_out) {
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

            // ============================================================
            // The ONLY terminal log this file produces: every record
            // parsed from the DAT file, one line each.
            // ============================================================
            console.log(`\n=== DAT FILE RECORDS (${attendanceRecords.length}) ===`);
            attendanceRecords.forEach((r, i) => {
                console.log(`${i + 1}. zk_id=${r.zk_id} log_date=${r.log_date} time_in=${r.time_in} time_out=${r.time_out ?? 'NULL'}`);
            });
            console.log(`=== END DAT FILE RECORDS ===\n`);

            return attendanceRecords;
            
        } catch (error) {
            console.error('Error in DAT file processing:', error);
            throw error;
        }
    }

    /**
     * TEST / VERIFICATION ONLY - does not write to the database.
     *
     * Parses a DAT buffer exactly like processDatFile() and, for every employee/date
     * group, checks the gap between the earliest and latest punch that day. A real
     * time_in/time_out pair should be separated by roughly a full workday. If two
     * punches on the same log_date are closer together than SUSPICIOUS_GAP_MINUTES,
     * that's very likely a duplicate/accidental double-scan rather than a genuine
     * arrival + departure - even if the two timestamps aren't byte-for-byte identical
     * (e.g. 07:02:36 and 07:02:43 are 7 seconds apart, not equal, but still clearly
     * the same real-world event).
     *
     * @param {Buffer} buffer - raw .dat file contents
     * @param {Object} [options]
     * @param {number} [options.suspiciousGapMinutes] - override the default threshold (minutes)
     * @returns {Object} summary + full list of groups (for further inspection)
     */
    analyzeDatFileTimeMatches(buffer, options = {}) {
        // Half a 9am-5pm (8-hour) workday. Two punches closer together than this on the
        // same log_date can't reasonably be a real morning-arrival + evening-departure pair.
        const SUSPICIOUS_GAP_MINUTES = 240;
        const thresholdMinutes = options.suspiciousGapMinutes || SUSPICIOUS_GAP_MINUTES;

        const rawPunches = this._parseRawDatPunches(buffer);

        // Group raw punches by employee/date so we can see every punch in the day,
        // not just the collapsed time_in/time_out.
        const groups = new Map();
        for (const punch of rawPunches) {
            const key = `${punch.employeeId}_${punch.date}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    zk_id: punch.employeeId,
                    log_date: punch.date,
                    punches: []
                });
            }
            groups.get(key).punches.push(punch.time);
        }

        const allGroups = Array.from(groups.values()).map(g => {
            const time_in = g.punches[0];
            const time_out = g.punches[g.punches.length - 1];
            const gapMinutes = this._minutesBetween(time_in, time_out);

            let category;
            if (g.punches.length === 1) {
                category = 'single_punch'; // only 1 scan that day - time_in === time_out is expected
            } else if (gapMinutes < thresholdMinutes) {
                category = 'suspicious_gap'; // multiple scans, but too close together to be a real in/out pair
            } else {
                category = 'normal_pair'; // multiple scans with a plausible workday gap
            }

            return {
                zk_id: g.zk_id,
                log_date: g.log_date,
                time_in,
                time_out,
                punch_count: g.punches.length,
                all_punches: g.punches,
                gapMinutes,
                category
            };
        });

        const singlePunchGroups = allGroups.filter(g => g.category === 'single_punch');
        const suspiciousGroups = allGroups.filter(g => g.category === 'suspicious_gap');
        const normalGroups = allGroups.filter(g => g.category === 'normal_pair');

        return {
            thresholdMinutes,
            totalRawPunches: rawPunches.length,
            totalGroups: allGroups.length,
            singlePunchCount: singlePunchGroups.length,
            suspiciousGapCount: suspiciousGroups.length,
            normalPairCount: normalGroups.length,
            singlePunchGroups,
            suspiciousGroups,
            normalGroups,
            allGroups
        };
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

        // ============================================================
        // KILL SWITCH - DATABASE WRITES DISABLED
        // No INSERT/UPDATE will run no matter what route, dryRun flag,
        // or caller reaches this function. The full record list is
        // already logged by processDatFile() - this just confirms
        // nothing was saved. Flip DB_WRITES_ENABLED back to true when
        // it's safe to resume real imports.
        // ============================================================
        const DB_WRITES_ENABLED = true;
        if (!DB_WRITES_ENABLED) {
            importProgress = {
                total: totalRows,
                processed: totalRows,
                status: 'completed',
                message: 'Database writes disabled - logged only, nothing saved.',
                importId
            };

            return {
                insertedRows: [],
                updatedRows: [],
                skippedRows: rows,
                errors: [],
                totalProcessed: totalRows,
                totalInserted: 0,
                totalUpdated: 0,
                totalSkipped: totalRows,
                totalFailed: 0,
                time: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
                dbWritesDisabled: true
            };
        }
        
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
  // TEST ONLY - logs analysis to terminal, never writes to the database
  analyzeDatFileTimeMatches: (buffer) => new AttendanceImportHandler().analyzeDatFileTimeMatches(buffer),
  getImportProgress,
  handler: new AttendanceImportHandler()
};