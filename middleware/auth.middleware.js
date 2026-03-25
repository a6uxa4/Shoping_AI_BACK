const jwt = require("jsonwebtoken");
const { User } = require("../models/auth.model");
const { ROLES } = require("../models/auth.model");

/**
 * Проверяет JWT и кладёт req.user
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader || null;
    if (token && token.startsWith("Bearer ")) token = token.slice(7);

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "Требуется авторизация. Передайте токен в заголовке Authorization: Bearer <token>",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Пользователь не найден" });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Недействительный или истёкший токен",
      });
    }
    next(err);
  }
};

/**
 * Optional JWT auth: if token exists and valid -> sets req.user, else continues without 401.
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader || null;
    if (token && token.startsWith("Bearer ")) token = token.slice(7);
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");
    if (user) req.user = user;
    return next();
  } catch {
    return next();
  }
};

/**
 * Ограничивает доступ по ролям. В allowedRoles передайте массив: ['super_admin'] или ['super_admin', 'admin']
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Требуется авторизация" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message:
          "Доступ запрещён. Требуемая роль: " + allowedRoles.join(" или "),
      });
    }
    next();
  };
};

module.exports = { authenticate, optionalAuthenticate, requireRole, ROLES };
