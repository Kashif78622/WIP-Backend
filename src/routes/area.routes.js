const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getAreas,
    getArea,
    createArea,
    updateArea,
    deleteArea,
    toggleAreaStatus,
} = require('../controllers/area.controller');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET routes - accessible to all authenticated users
router.get('/', getAreas);
router.get('/:id', getArea);

// POST, PUT, DELETE - Admin only
router.use(requireRole('ADMIN'));
router.post('/', createArea);
router.put('/:id', updateArea);
router.delete('/:id', deleteArea);
router.patch('/:id/status', toggleAreaStatus);

module.exports = router;