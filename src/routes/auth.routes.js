// src/routes/auth.routes.js
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { login, getMe, refresh, logout } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/login', login);
router.get('/me', authenticate, getMe);
router.post('/refresh', refresh);
router.post('/logout', authenticate, logout);

module.exports = router;