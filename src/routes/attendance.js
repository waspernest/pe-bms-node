const express = require('express');
const multer = require('multer');
const attendanceController = require('../controllers/attendanceController');
const router = express.Router();

// Configure multer to use memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

router.get("/", attendanceController.getAllAttendance);
router.get("/:userId", attendanceController.getUserAttendance);
router.post("/", attendanceController.logAttendance); // Manual test of logging the attendance
router.post("/import", upload.single('file'), attendanceController.importAttendance); // Route for importing attendance data
router.post("/import/new", upload.single('file'), attendanceController.importAttendanceNew); // Route for importing attendance data
router.post("/add-record", attendanceController.addAttendanceRecord); // Route for adding attendance record
router.put("/update-record/:id", attendanceController.updateAttendanceRecord); // Route for updating attendance record
router.delete("/delete-record/:id", attendanceController.deleteAttendanceRecord); // Route for deleting attendance record
router.delete("/delete-record-manual", attendanceController.deleteAttendanceRecordManual); // Route for manually deleting attendance record

module.exports = router;