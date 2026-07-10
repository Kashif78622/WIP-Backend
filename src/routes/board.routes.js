// src/routes/board.routes.js
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getBoard,
    getAreaBoard,
    getMachineHistory,
    getBoardSnapshot,
    takeSnapshot,
} = require('../controllers/board.controller');

const router = express.Router();

router.use(authenticate);

// Board routes
router.get('/', getBoard);
router.get('/area/:areaId', getAreaBoard);
router.get('/machine/:machineId/history', getMachineHistory);
router.get('/snapshot/:areaId', getBoardSnapshot);

// Snapshot - Supervisor+
router.post('/snapshot', requireRole('SUPERVISOR'), takeSnapshot);

module.exports = router;