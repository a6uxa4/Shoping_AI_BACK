const express = require("express");
const manualController = require("../controllers/manual.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const { ROLES } = require("../models/auth.model");

const router = express.Router();

// Список категорий (справочник) — публично, без токена
router.get("/categories", manualController.getCategories);

// Создать/обновить/удалить категорию — только SUPER_ADMIN
router.post(
  "/categories",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  manualController.createCategory,
);
router.put(
  "/categories/:id",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  manualController.updateCategory,
);
router.delete(
  "/categories/:id",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  manualController.deleteCategory,
);

module.exports = router;
