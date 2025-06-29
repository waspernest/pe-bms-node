const express = require("express");
const router = express.Router();

// For testing connection of API
router.get("/", (req, res) => {
    res.send("Hello World!");
});

// Mount ZK routes
router.use("/zk", require("./zk"));

module.exports = router;