const express = require('express');
const router = express.Router();
const { 
  addSchedule, 
  getAllSchedules, 
  deleteSchedule, 
  setSchedule,
  getSchedules,
  getScheduleAssoc
} = require('../controllers/scheduleController');

// Add a new schedule
router.post('/add', addSchedule);
router.post('/:id/set', setSchedule);

// Get all schedules with pagination (admin)
router.get('/', getAllSchedules);
router.get('/assoc/:sid/:month/:year', getScheduleAssoc);

// Get schedules for the current user
router.get('/my-schedules', getSchedules);

// Delete a schedule by ID
router.delete('/:id', deleteSchedule);

module.exports = router;