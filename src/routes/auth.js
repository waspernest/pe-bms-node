const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../utils/jwt');

// Public routes
router.post('/login', authController.login);

// Protected routes (require authentication)
router.get('/me', authenticateToken, authController.getCurrentUser);
router.get('/initial-setup', authController.initialSetup);
router.get('/config', authController.getCurrentConfig);
router.post('/logout', authenticateToken, authController.logout);
router.post('/save-config', authController.saveConfig);
router.post('/test-db-connection', authController.testDbConnection);
router.post('/test-zk-connection', authController.testZKConnection);

module.exports = router;