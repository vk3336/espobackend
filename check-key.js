require("dotenv").config();
console.log("INDEXNOW_KEY:", process.env.INDEXNOW_KEY);
console.log("Key length:", process.env.INDEXNOW_KEY?.length);
console.log(
  "Valid length (8-128):",
  process.env.INDEXNOW_KEY?.length >= 8 &&
    process.env.INDEXNOW_KEY?.length <= 128,
);
