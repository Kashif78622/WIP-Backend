// src/routes/product.routes.js
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    toggleProductStatus,
    deleteProduct,
    getProductStats,
    bulkImportProducts,
} = require('../controllers/product.controller');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET routes - all authenticated users
router.get('/', getProducts);
router.get('/:id', getProduct);
router.get('/:id/stats', getProductStats);

// POST, PUT, DELETE - Supervisor+ (SUPERVISOR, MANAGER, ADMIN)
router.use(requireRole('SUPERVISOR'));

// Create product
router.post('/', createProduct);

// Update product
router.put('/:id', updateProduct);

// Toggle product status
router.patch('/:id/status', toggleProductStatus);

// Delete product (soft delete)
router.delete('/:id', deleteProduct);

// Bulk import products
router.post('/bulk-import', bulkImportProducts);

module.exports = router;