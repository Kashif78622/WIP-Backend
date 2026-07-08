const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const {
    getBoard,
    getMachineWithBatch,
} = require('../controllers/board.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', getBoard);
router.get('/machine/:id', getMachineWithBatch);

module.exports = router;