// src/routes/board.routes.js
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
    res.json({ success: true, data: {} });
});

module.exports = router;