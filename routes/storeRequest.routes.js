const express = require("express");
const controller = require("../controllers/storeRequest.controller");
const { authenticate, requireRole } = require("../middleware/auth.middleware");
const { ROLES } = require("../models/auth.model");

const router = express.Router();

router.post("/", controller.createStoreRequest);
router.get(
  "/",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  controller.getAllStoreRequests,
);
router.post(
  "/:id/approve",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  controller.approveStoreRequest,
);
router.post(
  "/:id/reject",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  controller.rejectStoreRequest,
);

module.exports = router;
