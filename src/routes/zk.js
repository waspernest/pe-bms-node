const express = require("express");
const router = express.Router();
const zkController = require("../controllers/zkController");

router.get("/", zkController.testConnection);
router.get("/users", zkController.getUsers);
router.get("/attendance", zkController.getAttendance);
router.post("/user", zkController.createOrUpdateUser);
router.get("/device", zkController.getDevice);
router.post("/test", zkController.testConnection);
router.post("/service", zkController.zkService);

module.exports = router;