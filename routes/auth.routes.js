const express = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");

const router = express.Router();

// Public
router.post("/register", authController.register);
router.post("/login", authController.login);

// Authenticated only
router.get("/me", authenticate, authController.getMe);
router.post("/change-password", authenticate, authController.changePassword);

module.exports = router;
