const express = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");

const router = express.Router();

// Публичные
router.post("/login", authController.login);

// Только для авторизованных
router.get("/me", authenticate, authController.getMe);

module.exports = router;
