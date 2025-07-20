const express = require('express');
const multer = require('multer');
const fs = require('fs');
const xlsx = require('xlsx');
const csv = require('csv-parser');
const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post("/import", upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File uploaded:', req.file);
    
    try {
        // Log file content based on file type
        if (req.file.mimetype.includes('excel') || req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls')) {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
            console.log('Excel file content:', data);
        } else if (req.file.mimetype.includes('csv') || req.file.originalname.endsWith('.csv')) {
            const results = [];
            fs.createReadStream(req.file.path)
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', () => {
                    console.log('CSV file content:', results);
                });
        }
        
        // Clean up the uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({ 
            success: true, 
            filename: req.file.originalname,
            message: 'File processed successfully' 
        });
    } catch (error) {
        console.error('Error processing file:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false, 
            error: 'Error processing file',
            details: error.message 
        });
    }
});

module.exports = router;