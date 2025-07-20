const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { Readable } = require('stream');
const csv = require('csv-parser');
const router = express.Router();

// Configure multer to use memory storage instead of disk
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

router.post("/import", upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File received in memory:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
    });
    
    try {
        // Process file from memory buffer
        if (req.file.mimetype.includes('excel') || 
            req.file.originalname.endsWith('.xlsx') || 
            req.file.originalname.endsWith('.xls')) {
            
            // Process Excel file from buffer with raw text for dates
            const workbook = xlsx.read(req.file.buffer, { 
                type: 'buffer',
                cellDates: true,
                cellText: true,
                cellNF: true,
                dateNF: 'yyyy-mm-dd',
                raw: false
            });
            
            const sheetName = workbook.SheetNames[0];
            const ws = workbook.Sheets[sheetName];
            
            // Convert to JSON with formatted dates and times
            const data = xlsx.utils.sheet_to_json(ws, {
                raw: false, // Get formatted strings instead of raw values
                dateNF: 'yyyy-mm-dd',
                defval: ''
            });
            
            // Format times properly (Excel stores times as fractions of a day)
            const formattedData = data.map(row => {
                const formattedRow = { ...row };
                
                // Format LOG_DATE if it exists
                if (formattedRow.LOG_DATE) {
                    if (formattedRow.LOG_DATE instanceof Date) {
                        formattedRow.LOG_DATE = formattedRow.LOG_DATE.toISOString().split('T')[0];
                    } else if (typeof formattedRow.LOG_DATE === 'number') {
                        // Convert Excel date serial number to date string
                        const date = new Date((formattedRow.LOG_DATE - 25569) * 86400 * 1000);
                        formattedRow.LOG_DATE = date.toISOString().split('T')[0];
                    }
                }
                
                // Format TIME_IN and TIME_OUT if they exist
                ['TIME_IN', 'TIME_OUT'].forEach(field => {
                    if (formattedRow[field] !== undefined) {
                        if (typeof formattedRow[field] === 'number') {
                            // Convert Excel time (fraction of a day) to HH:MM:SS
                            const totalSeconds = Math.round(formattedRow[field] * 86400);
                            const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
                            const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
                            const seconds = (totalSeconds % 60).toString().padStart(2, '0');
                            formattedRow[field] = `${hours}:${minutes}:${seconds}`;
                        }
                    }
                });
                
                return formattedRow;
            });
            
            console.log('Excel file content:', formattedData);
            
            return res.json({ 
                success: true, 
                filename: req.file.originalname,
                data: formattedData,
                message: 'Excel file processed successfully' 
            });
            
        } else if (req.file.mimetype.includes('csv') || 
                  req.file.originalname.endsWith('.csv')) {
            
            // Process CSV file from buffer
            const results = [];
            const bufferStream = new Readable();
            bufferStream.push(req.file.buffer);
            bufferStream.push(null); // Signal end of stream
            
            await new Promise((resolve, reject) => {
                bufferStream
                    .pipe(csv())
                    .on('data', (data) => results.push(data))
                    .on('end', resolve)
                    .on('error', reject);
            });
            
            console.log('CSV file content:', results);
            return res.json({ 
                success: true, 
                filename: req.file.originalname,
                data: results,
                message: 'CSV file processed successfully',
                count: results.length
            });
        } else {
            throw new Error('Unsupported file type');
        }
        
    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error processing file',
            details: error.message 
        });
    }
});

module.exports = router;