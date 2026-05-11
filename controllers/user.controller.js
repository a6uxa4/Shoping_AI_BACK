const { User, ROLES } = require("../models/auth.model");
const { StoreRequest } = require("../models/storeRequest.model");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * GET /api/users/admin?page=1&limit=10
 * List all admins with pagination (SUPER_ADMIN only).
 */
const getAllAdmins = async (req, res, next) => {
  try {
    let page = Math.max(1, parseInt(req.query.page, 10) || DEFAULT_PAGE);
    let limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT),
    );

    const filter = { role: ROLES.ADMIN };
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/users/admin
 * Create an admin (SUPER_ADMIN only).
 * body: { login, password, storeName }
 */
const createAdmin = async (req, res, next) => {
  try {
    const { login, password, storeName } = req.body || {};

    if (!login || !password || !storeName) {
      return res.status(400).json({
        success: false,
        message: "login, password and storeName are required",
      });
    }

    const email = String(login).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Invalid login",
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A user with this login already exists",
      });
    }

    const user = await User.create({
      email,
      password,
      role: ROLES.ADMIN,
      storeName: String(storeName).trim(),
    });

    const userObj = user.toObject();
    delete userObj.password;

    return res.status(201).json({
      success: true,
      data: { user: userObj },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/users/admin/:id
 * Update an admin (SUPER_ADMIN only).
 * body: { login?, password?, storeName? }
 */
const updateAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { login, password, storeName } = req.body || {};

    const user = await User.findById(id).select("+password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.role !== ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        message: "Only users with the admin role can be updated here",
      });
    }

    if (login !== undefined) {
      const email = String(login).trim().toLowerCase();
      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid login" });
      }

      const existing = await User.findOne({ email, _id: { $ne: user._id } });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "A user with this login already exists",
        });
      }
      user.email = email;
    }

    if (storeName !== undefined) {
      const trimmed = String(storeName).trim();
      if (!trimmed) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid storeName" });
      }
      user.storeName = trimmed;
    }

    if (password !== undefined) {
      const pwd = String(password);
      if (pwd.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
      }
      user.password = pwd;
    }

    await user.save();
    const userObj = user.toObject();
    delete userObj.password;

    return res.json({ success: true, data: { user: userObj } });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/users/admin/:id
 * Delete an admin (SUPER_ADMIN only).
 *
 * Also removes any related store applications (matched by email) so the
 * Store applications tab does not show ghost entries after the admin is gone.
 */
const deleteAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.role !== ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        message: "Only users with the admin role can be deleted here",
      });
    }

    await User.deleteOne({ _id: user._id });

    let removedRequests = 0;
    if (user.email) {
      const result = await StoreRequest.deleteMany({
        email: String(user.email).toLowerCase(),
      });
      removedRequests = result?.deletedCount || 0;
    }

    return res.json({
      success: true,
      data: { deleted: true, removedStoreRequests: removedRequests },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllAdmins, createAdmin, updateAdmin, deleteAdmin };
