// src/routes/user.routes.js
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getUsers,
    getUser,
    createUser,
    updateUser,
    toggleUserStatus,
    deleteUser,
} = require('../controllers/user.controller');

const router = express.Router();

// All user routes require authentication and ADMIN role
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get('/', getUsers);
router.get('/:id', getUser);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/status', toggleUserStatus);
router.delete('/:id', deleteUser);

module.exports = router;