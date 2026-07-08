const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    toggleProductStatus,
} = require('../controllers/product.controller');

const router = express.Router();

router.use(authenticate);

// GET routes - all authenticated users
router.get('/', getProducts);
router.get('/:id', getProduct);

// POST, PUT, DELETE - Admin/Manager only
router.use(requireRole('MANAGER'));
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);
router.patch('/:id/status', toggleProductStatus);

module.exports = router;