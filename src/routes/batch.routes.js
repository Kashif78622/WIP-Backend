const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getBatches,
    getBatch,
    createBatch,
    placeBatch,
    holdBatch,
    resumeBatch,
    completeBatch,
    cancelBatch,
} = require('../controllers/batch.controller');

const router = express.Router();

router.use(authenticate);

// GET routes - all authenticated users
router.get('/', getBatches);
router.get('/:id', getBatch);

// Batch creation - Supervisor+
router.post('/', requireRole('SUPERVISOR'), createBatch);

// Batch actions - Operator+ (place, hold, resume)
router.post('/:id/place', requireRole('OPERATOR'), placeBatch);
router.post('/:id/hold', requireRole('OPERATOR'), holdBatch);
router.post('/:id/resume', requireRole('OPERATOR'), resumeBatch);

// Complete/Cancel - Supervisor+
router.post('/:id/complete', requireRole('SUPERVISOR'), completeBatch);
router.post('/:id/cancel', requireRole('SUPERVISOR'), cancelBatch);

module.exports = router;