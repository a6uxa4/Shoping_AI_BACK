const { StoreRequest } = require("../models/storeRequest.model");
const { User, ROLES } = require("../models/auth.model");
const { sendEmail } = require("../services/email.service");
const { sendSms } = require("../services/sms.service");
const { generateTempPassword } = require("../utils/password.util");

const ALLOWED_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

const sendRejectionNotifications = async ({ request, reason }) => {
  const subject = "Your store application has been rejected";
  const text =
    `Hello ${request.fullName},\n\n` +
    `We are sorry to inform you that your application to open the store ` +
    `"${request.storeName}" has been rejected.\n` +
    (reason ? `\nReason: ${reason}\n` : "") +
    `\nYou can submit a new application later.\n\n` +
    `Best regards,\nThe team`;

  try {
    await sendEmail({ to: request.email, subject, text });
  } catch (e) {
    console.error("Failed to send rejection email:", e.message || e);
  }

  try {
    await sendSms({
      to: request.email,
      subject: "Store application rejected",
      text:
        `Your store application "${request.storeName}" has been rejected.` +
        (reason ? ` Reason: ${reason}` : ""),
    });
  } catch (e) {
    console.error("Failed to send rejection SMS:", e.message || e);
  }
};

/**
 * POST /api/store-requests
 * Public endpoint — anyone can submit a request to open a store.
 *
 * If a user with the same email already exists in the system, the request
 * is created and immediately auto-rejected, and the applicant receives an
 * email + SMS-style email explaining the reason.
 */
const createStoreRequest = async (req, res, next) => {
  try {
    const { fullName, email, phone, storeName, message } = req.body || {};
    if (!fullName || !email || !storeName) {
      return res.status(400).json({
        success: false,
        message: "fullName, email and storeName are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });

    const baseDoc = {
      fullName: String(fullName).trim(),
      email: normalizedEmail,
      phone: phone != null ? String(phone).trim() : "",
      storeName: String(storeName).trim(),
      message: message != null ? String(message).trim() : "",
      status: "PENDING",
    };

    if (existingUser) {
      const reason = "An account with this email already exists.";
      const request = await StoreRequest.create({
        ...baseDoc,
        status: "REJECTED",
        rejectionReason: reason,
      });

      await sendRejectionNotifications({ request, reason });

      return res.status(201).json({
        success: true,
        data: {
          request,
          autoRejected: true,
          message:
            "An account with this email already exists. Your application was automatically rejected.",
        },
      });
    }

    const request = await StoreRequest.create(baseDoc);

    return res.status(201).json({ success: true, data: { request } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/store-requests?status=PENDING|APPROVED|REJECTED
 */
const getAllStoreRequests = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) {
      const status = String(req.query.status).toUpperCase();
      if (ALLOWED_STATUSES.includes(status)) {
        filter.status = status;
      }
    }
    const requests = await StoreRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: { requests } });
  } catch (err) {
    next(err);
  }
};

const approveStoreRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await StoreRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (request.status !== "PENDING") {
      return res
        .status(400)
        .json({ success: false, message: "Request is already processed" });
    }

    const email = request.email.toLowerCase();
    const existing = await User.findOne({ email });

    // If user with such email already exists, automatically reject the request
    // and notify the applicant, instead of returning a 409 error.
    if (existing) {
      const reason = "An account with this email already exists.";
      request.status = "REJECTED";
      request.rejectionReason = reason;
      request.processedBy = req.user._id;
      await request.save();

      await sendRejectionNotifications({ request, reason });

      return res.status(200).json({
        success: true,
        data: {
          request,
          autoRejected: true,
          message:
            "An account with this email already exists. The request was automatically rejected.",
        },
      });
    }

    const tempPassword = generateTempPassword(10);
    await User.create({
      email,
      password: tempPassword,
      role: ROLES.ADMIN,
      storeName: request.storeName,
      name: request.fullName,
      phone: request.phone || "",
      mustChangePassword: true,
    });

    request.status = "APPROVED";
    request.processedBy = req.user._id;
    await request.save();

    const loginUrl = process.env.APP_URL
      ? `${process.env.APP_URL.replace(/\/+$/, "")}/login`
      : "/login";

    const subject = "Your store application has been approved";
    const text =
      `Hello ${request.fullName},\n\n` +
      `Your application to open the store "${request.storeName}" has been approved.\n\n` +
      `You can now log in to the seller dashboard with the credentials below:\n` +
      `Login: ${email}\n` +
      `Temporary password: ${tempPassword}\n\n` +
      `Login URL: ${loginUrl}\n\n` +
      `For security reasons, you will be asked to set a new password on your first login.\n\n` +
      `Best regards,\nThe team`;

    try {
      await sendEmail({ to: email, subject, text });
    } catch (e) {
      console.error("Failed to send approval email:", e.message || e);
    }

    try {
      await sendSms({
        to: email,
        subject: "Store application approved",
        text:
          `Your store "${request.storeName}" has been approved. ` +
          `Login: ${email} Temp password: ${tempPassword}. ` +
          `Please change it after first login.`,
      });
    } catch (e) {
      console.error("Failed to send approval SMS:", e.message || e);
    }

    return res.json({ success: true, data: { request } });
  } catch (err) {
    next(err);
  }
};

const rejectStoreRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const request = await StoreRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (request.status !== "PENDING") {
      return res
        .status(400)
        .json({ success: false, message: "Request is already processed" });
    }

    const finalReason = reason ? String(reason).trim() : "";

    request.status = "REJECTED";
    request.processedBy = req.user._id;
    if (finalReason) request.rejectionReason = finalReason;
    await request.save();

    await sendRejectionNotifications({ request, reason: finalReason });

    return res.json({ success: true, data: { request } });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createStoreRequest,
  getAllStoreRequests,
  approveStoreRequest,
  rejectStoreRequest,
};
