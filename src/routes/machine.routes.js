const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getMachines,
    getMachine,
    createMachine,
    updateMachine,
    updateMachineStatus,
    deleteMachine,
    reorderMachines,
    toggleMachineStatus,
} = require('../controllers/machine.controller');

const router = express.Router();

router.use(authenticate);

// GET routes - all authenticated users
router.get('/', getMachines);
router.get('/:id', getMachine);

// Status update - Operators+ (anyone with access)
router.patch('/:id/status', updateMachineStatus);

// POST, PUT, DELETE - Admin only
router.use(requireRole('ADMIN'));
router.post('/', createMachine);
router.put('/:id', updateMachine);
router.delete('/:id', deleteMachine);
router.post('/stage/:stageId/reorder', reorderMachines);
router.patch('/:id/toggle', toggleMachineStatus);

module.exports = router;