const express = require('express');
const router = express.Router();
const { getImportProgress } = require('../controllers/attendanceController/importHandler');

// Progress endpoint
router.get('/progress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Send initial progress
    res.write(`data: ${JSON.stringify(getImportProgress())}\n\n`);
    
    // Send updates every second
    const interval = setInterval(() => {
        res.write(`data: ${JSON.stringify(getImportProgress())}\n\n`);
    }, 1000);
    
    // Clean up on client disconnect
    req.on('close', () => {
        clearInterval(interval);
        res.end();
    });
});

module.exports = router;
