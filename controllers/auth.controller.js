const jwt = require("jsonwebtoken");
const { User, ROLES } = require("../models/auth.model");

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
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
        message: "Укажите email и password",
      });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Неверный email или пароль",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Неверный email или пароль",
      });
    }

    const token = generateToken(user._id);
    const userObj = user.toObject();
    delete userObj.password;

    return res.json({
      success: true,
      data: {
        user: userObj,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 * Текущий пользователь (нужен валидный JWT).
 */
const getMe = async (req, res, next) => {
  try {
    return res.json({
      success: true,
      data: { user: req.user },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  login,
  getMe,
  ROLES,
};
