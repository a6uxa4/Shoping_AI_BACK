const jwt = require("jsonwebtoken");
const { User, ROLES } = require("../models/auth.model");

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

const toSafeUser = (userDoc) => {
  const obj = typeof userDoc.toObject === "function" ? userDoc.toObject() : { ...userDoc };
  delete obj.password;
  return obj;
};

/**
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateToken(user._id);

    return res.json({
      success: true,
      data: {
        user: toSafeUser(user),
        token,
        mustChangePassword: !!user.mustChangePassword,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/register
 * Customer self-registration.
 */
const register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    const user = await User.create({
      email: normalizedEmail,
      password: String(password),
      name: name != null ? String(name).trim() : "",
      role: ROLES.CUSTOMER,
    });

    const token = generateToken(user._id);

    return res.status(201).json({
      success: true,
      data: {
        user: toSafeUser(user),
        token,
        mustChangePassword: false,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 */
const getMe = async (req, res, next) => {
  try {
    return res.json({
      success: true,
      data: {
        user: req.user,
        mustChangePassword: !!req.user.mustChangePassword,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/change-password
 * Body: { currentPassword, newPassword }
 * Used for forced first-login password change as well as normal updates.
 */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "currentPassword and newPassword are required",
      });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }
    if (String(newPassword) === String(currentPassword)) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from the current one",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const isMatch = await user.comparePassword(String(currentPassword));
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    user.password = String(newPassword);
    user.mustChangePassword = false;
    await user.save();

    return res.json({
      success: true,
      data: {
        user: toSafeUser(user),
        mustChangePassword: false,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  getMe,
  changePassword,
  ROLES,
};
