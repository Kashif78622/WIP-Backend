// src/routes/user.routes.js

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const {
    getUsers,
    getUser,
    createUser,
    updateUser,
    toggleUserStatus,
    deleteUser,
    getProfile,
    updateProfile,
    updateAvatar,
    removeAvatar,
    getPermissions,
} = require('../controllers/user.controller');

const router = express.Router();

// ==================== PUBLIC PERMISSION ROUTE ====================
router.get('/permissions', getPermissions);

// ==================== PROFILE ROUTES ====================
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.patch('/profile/avatar', authenticate, updateAvatar);
router.delete('/profile/avatar', authenticate, removeAvatar);

// ==================== ADMIN ROUTES ====================
router.use(authenticate);
router.use(requireRole('ADMIN'));

// Users CRUD - requires user_management permission
router.get('/', requirePermission('user_management'), getUsers);
router.get('/:id', requirePermission('user_management'), getUser);
router.post('/', requirePermission('user_management'), createUser);
router.put('/:id', requirePermission('user_management'), updateUser);
router.patch('/:id/status', requirePermission('user_management'), toggleUserStatus);
router.delete('/:id', requirePermission('user_management'), deleteUser);

module.exports = router;