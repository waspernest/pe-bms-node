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

// Simple REST progress endpoint for polling
router.get('/progress-rest', (req, res) => {
    try {
        const progress = getImportProgress();
        res.json({
            success: true,
            progress
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get progress'
        });
    }
});

module.exports = router;
