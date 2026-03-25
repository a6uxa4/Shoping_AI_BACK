const express = require("express");
const userController = require("../controllers/user.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const { ROLES } = require("../models/auth.model");

const router = express.Router();

// Только super_admin
router.get(
  "/admin",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  userController.getAllAdmins,
);
router.post(
  "/admin",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  userController.createAdmin,
);

router.put(
  "/admin/:id",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  userController.updateAdmin,
);

router.delete(
  "/admin/:id",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  userController.deleteAdmin,
);

module.exports = router;
