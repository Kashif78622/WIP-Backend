const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getStages,
    getStage,
    createStage,
    updateStage,
    deleteStage,
    reorderStages,
    toggleStageStatus,
} = require('../controllers/stage.controller');

const router = express.Router();

router.use(authenticate);

// GET routes - all authenticated users
router.get('/', getStages);
router.get('/:id', getStage);

// POST, PUT, DELETE - Admin only
router.use(requireRole('ADMIN'));
router.post('/', createStage);
router.put('/:id', updateStage);
router.delete('/:id', deleteStage);
router.post('/area/:areaId/reorder', reorderStages);
router.patch('/:id/status', toggleStageStatus);

module.exports = router;