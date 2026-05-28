const express = require("express");
const { getGoogleMerchantFeed } = require("../controller/feedController");

const router = express.Router();

// GET /feed/google-merchant.xml
router.get("/google-merchant.xml", getGoogleMerchantFeed);

module.exports = router;