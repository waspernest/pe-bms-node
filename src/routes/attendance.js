const express = require("express");
const router = express.Router();
const attendanceController = require("../controllers/attendanceController");

router.get("/", attendanceController.getAllAttendance);
router.post("/", attendanceController.logAttendance); // Manual test of logging the attendance

module.exports = router;