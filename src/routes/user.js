const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

router.get("/", userController.getAllUsers);
router.get("/get-users-new", userController.getUsersNew);
router.get("/sync", userController.syncUser);
router.get("/export", userController.exportUserAttendance);
router.get("/export/word", userController.exportUserAttendanceToWord);
router.get("/:id", userController.getUserById);
router.post("/create", userController.createUser);
router.post("/create-new", userController.createUserNew);
router.post("/new_sync", userController.syncUsersNew);
router.put("/:id", userController.updateUser);
router.put("/update-new/:id", userController.updateUserNew);
router.put("/:id/password", userController.updatePassword);
router.delete("/:id", userController.deleteUser);
router.delete("/:id/permanent", userController.removeUser);

module.exports = router;