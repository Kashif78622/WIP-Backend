// src/routes/settings.routes.js
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getSettings,
    getSetting,
    upsertSettings,
    updateSetting,
    deleteSetting,
    resetSettings,
} = require('../controllers/settings.controller');

const router = express.Router();

// Public routes - no authentication required for reading settings
router.get('/', getSettings);
router.get('/:key', getSetting);

// Protected routes - require authentication and ADMIN role for modifications
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.post('/upsert', upsertSettings);
router.put('/:key', updateSetting);
router.delete('/:key', deleteSetting);
router.post('/reset', resetSettings);

module.exports = router;