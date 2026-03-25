const { User, ROLES } = require("../models/auth.model");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * GET /api/users/admin?page=1&limit=10
 * Список всех admin с пагинацией (только super_admin)
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
 * Создать admin (только super_admin)
 * body: { login, password, storeName }
 */
const createAdmin = async (req, res, next) => {
  try {
    const { login, password, storeName } = req.body || {};

    if (!login || !password || !storeName) {
      return res.status(400).json({
        success: false,
        message: "Укажите login, password и storeName",
      });
    }

    const email = String(login).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Некорректный login",
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Пользователь с таким login уже существует",
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
 * Обновить admin (только super_admin)
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
        .json({ success: false, message: "Пользователь не найден" });
    }

    if (user.role !== ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        message: "Можно обновлять только пользователей с ролью admin",
      });
    }

    if (login !== undefined) {
      const email = String(login).trim().toLowerCase();
      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "Некорректный login" });
      }

      const existing = await User.findOne({ email, _id: { $ne: user._id } });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "Пользователь с таким login уже существует",
        });
      }
      user.email = email;
    }

    if (storeName !== undefined) {
      const trimmed = String(storeName).trim();
      if (!trimmed) {
        return res
          .status(400)
          .json({ success: false, message: "Некорректный storeName" });
      }
      user.storeName = trimmed;
    }

    if (password !== undefined) {
      const pwd = String(password);
      if (pwd.length < 6) {
        return res.status(400).json({
          success: false,
          message: "password должен быть минимум 6 символов",
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
 * Удалить admin (только super_admin)
 */
const deleteAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Пользователь не найден" });
    }

    if (user.role !== ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        message: "Можно удалять только пользователей с ролью admin",
      });
    }

    await User.deleteOne({ _id: user._id });
    return res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAllAdmins, createAdmin, updateAdmin, deleteAdmin };
