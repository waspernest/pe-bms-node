const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");

router.get("/test-mysql-connection", adminController.testMYSQLConnection);
router.get("/create-test-admin", adminController.createTestAdmin);
router.post("/delete-records", adminController.deleteRecords);

module.exports = router;