// src/routes/dashboard.routes.js

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getStats,
    getRecentActivities,
    generateReport,
} = require('../controllers/dashboard.controller');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get('/stats', getStats);
router.get('/activities', getRecentActivities);
router.post('/report', generateReport);

module.exports = router;