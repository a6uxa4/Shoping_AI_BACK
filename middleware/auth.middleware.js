const jwt = require("jsonwebtoken");
const { User } = require("../models/auth.model");
const { ROLES } = require("../models/auth.model");

/**
 * Verifies JWT and sets req.user.
 *
 * If the user is required to change their password on first login
 * (mustChangePassword === true), every request is blocked with a 403
 * MUST_CHANGE_PASSWORD error, except for the whitelisted endpoints used
 * by the change-password flow itself (GET /me, POST /change-password).
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
          "Authorization required. Pass the token in the Authorization: Bearer <token> header",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }

    req.user = user;

    if (user.mustChangePassword) {
      const isWhitelisted =
        (req.method === "GET" && req.path === "/me") ||
        (req.method === "POST" && req.path === "/change-password");

      if (!isWhitelisted) {
        return res.status(403).json({
          success: false,
          message: "You must change your password before continuing",
          code: "MUST_CHANGE_PASSWORD",
        });
      }
    }

    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }
    next(err);
  }
};

/**
 * Optional JWT auth: if a valid token is present sets req.user, otherwise
 * continues without a 401.
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
 * Role-based access control.
 * Pass an array of allowed roles, e.g. ['SUPER_ADMIN'] or ['SUPER_ADMIN', 'ADMIN'].
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Authorization required" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Required role: " + allowedRoles.join(" or "),
      });
    }
    next();
  };
};

module.exports = { authenticate, optionalAuthenticate, requireRole, ROLES };
