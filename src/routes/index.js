const express = require("express");
const router = express.Router();

// For testing connection of API
router.get("/", (req, res) => {
    res.send("Hello World!");
});

// Mount Auth routes
router.use("/auth", require("./auth"));

// Mount Admin routes
router.use("/admin", require("./admin"));

// Mount ZK routes
router.use("/zk", require("./zk"));

// Mount User routes
router.use("/user", require("./user"));

// Mount Attendance routes
router.use("/attendance", require("./attendance"));

module.exports = router;