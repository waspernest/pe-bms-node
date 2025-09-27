const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");

// Admin routes
router.get("/test-mysql-connection", adminController.testMYSQLConnection);
router.get("/create-test-admin", adminController.createTestAdmin);
router.post("/create-admin-account", adminController.createAdminAccount);

// Commented out until implemented
// router.post("/delete-records", adminController.deleteRecords);

module.exports = router;