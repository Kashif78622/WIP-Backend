// src/controllers/product.controller.js
const prisma = require('../config/database');
const { getSocket } = require('../config/socket');
const AuditService = require('../services/audit.service');

const emitProductEvent = (event, data, initiatedBy) => {
    const io = getSocket();
    if (io) {
        io.emit(`product:${event}`, { ...data, initiatedBy });
    }
};

// Get all products
const getProducts = async (req, res, next) => {
    try {
        const { search, includeInactive, page = 1, limit = 20 } = req.query;
        const where = {};

        if (includeInactive !== 'true') where.isActive = true;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                include: {
                    batches: {
                        take: 1,
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true,
                            batchNo: true,
                            status: true,
                            createdAt: true,
                        },
                    },
                    _count: {
                        select: { batches: true },
                    },
                },
                orderBy: { name: 'asc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.product.count({ where }),
        ]);

        res.json({
            success: true,
            data: products,
            meta: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        next(error);
    }
};

// Get single product
const getProduct = async (req, res, next) => {
    try {
        const { id } = req.params;
        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                batches: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    include: {
                        createdBy: {
                            select: { id: true, name: true },
                        },
                    },
                },
                _count: {
                    select: { batches: true },
                },
            },
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
        }

        res.json({ success: true, data: product });
    } catch (error) {
        next(error);
    }
};

// Create product
const createProduct = async (req, res, next) => {
    try {
        const { name, code, description, defaultStageId } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
            });
        }

        // Check for duplicate name
        const existing = await prisma.product.findFirst({
            where: { name: name.trim() },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: { code: 'DUPLICATE', message: 'Product with this name already exists' },
            });
        }

        // Check for duplicate code
        if (code) {
            const existingCode = await prisma.product.findFirst({
                where: { code: code.trim() },
            });
            if (existingCode) {
                return res.status(409).json({
                    success: false,
                    error: { code: 'DUPLICATE_CODE', message: 'Product with this code already exists' },
                });
            }
        }

        const product = await prisma.product.create({
            data: {
                name: name.trim(),
                code: code?.trim() || null,
                description: description?.trim() || null,
                defaultStageId: defaultStageId || null,
            },
            include: {
                _count: {
                    select: { batches: true },
                },
            },
        });

        // Audit log
        await AuditService.log({
            userId: req.user.id,
            action: 'CREATE',
            entity: 'Product',
            entityId: product.id,
            changes: { name: product.name, code: product.code, description: product.description },
            ip: req.ip,
            userAgent: req.get('user-agent'),
            details: `Product "${product.name}" created`,
        });

        emitProductEvent('created', product, req.user.id);

        res.status(201).json({
            success: true,
            data: product,
            message: 'Product created successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Update product
const updateProduct = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, code, description, defaultStageId, isActive } = req.body;

        const existing = await prisma.product.findUnique({
            where: { id },
            include: {
                _count: {
                    select: { batches: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
        }

        // Check for duplicate name (excluding current product)
        if (name && name.trim() !== existing.name) {
            const duplicate = await prisma.product.findFirst({
                where: {
                    name: name.trim(),
                    id: { not: id },
                },
            });
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    error: { code: 'DUPLICATE', message: 'Product with this name already exists' },
                });
            }
        }

        // Check for duplicate code (excluding current product)
        if (code && code.trim() !== existing.code) {
            const duplicate = await prisma.product.findFirst({
                where: {
                    code: code.trim(),
                    id: { not: id },
                },
            });
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    error: { code: 'DUPLICATE_CODE', message: 'Product with this code already exists' },
                });
            }
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (code !== undefined) updateData.code = code?.trim() || null;
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (defaultStageId !== undefined) updateData.defaultStageId = defaultStageId || null;
        if (isActive !== undefined) updateData.isActive = isActive;

        const product = await prisma.product.update({
            where: { id },
            data: updateData,
            include: {
                _count: {
                    select: { batches: true },
                },
            },
        });

        // Audit log
        await AuditService.log({
            userId: req.user.id,
            action: 'UPDATE',
            entity: 'Product',
            entityId: product.id,
            before: { name: existing.name, code: existing.code, description: existing.description },
            after: { name: product.name, code: product.code, description: product.description },
            changes: updateData,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            details: `Product "${product.name}" updated`,
        });

        emitProductEvent('updated', product, req.user.id);

        res.json({
            success: true,
            data: product,
            message: 'Product updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Toggle product status
const toggleProductStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (isActive === undefined || isActive === null) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'isActive field is required' },
            });
        }

        const existing = await prisma.product.findUnique({
            where: { id },
            include: {
                _count: {
                    select: { batches: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
        }

        // Check if product has existing batches before disabling
        if (isActive === false && existing._count.batches > 0) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'HAS_BATCHES',
                    message: `Cannot disable product with ${existing._count.batches} existing batches. Archive or complete all batches first.`
                },
            });
        }

        const product = await prisma.product.update({
            where: { id },
            data: { isActive },
            include: {
                _count: {
                    select: { batches: true },
                },
            },
        });

        await AuditService.log({
            userId: req.user.id,
            action: 'STATUS_CHANGE',
            entity: 'Product',
            entityId: product.id,
            changes: { isActive: product.isActive },
            ip: req.ip,
            userAgent: req.get('user-agent'),
            details: `Product "${product.name}" ${isActive ? 'enabled' : 'disabled'}`,
        });

        emitProductEvent('updated', product, req.user.id);

        res.json({
            success: true,
            data: product,
            message: `Product ${isActive ? 'enabled' : 'disabled'} successfully`,
        });
    } catch (error) {
        next(error);
    }
};

// Delete product (soft delete - only if no batches)
const deleteProduct = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existing = await prisma.product.findUnique({
            where: { id },
            include: {
                _count: {
                    select: { batches: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
        }

        if (existing._count.batches > 0) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'HAS_BATCHES',
                    message: `Cannot delete product with ${existing._count.batches} existing batches. Archive or complete all batches first.`
                },
            });
        }

        const product = await prisma.product.update({
            where: { id },
            data: { isActive: false },
        });

        await AuditService.log({
            userId: req.user.id,
            action: 'DELETE',
            entity: 'Product',
            entityId: id,
            changes: { deleted: true, name: existing.name },
            ip: req.ip,
            userAgent: req.get('user-agent'),
            details: `Product "${existing.name}" deleted (soft delete)`,
        });

        emitProductEvent('deleted', { id, name: existing.name }, req.user.id);

        res.json({
            success: true,
            message: 'Product deleted successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Get product statistics
const getProductStats = async (req, res, next) => {
    try {
        const { id } = req.params;

        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                batches: {
                    where: {
                        status: { in: ['IN_PROGRESS', 'ON_HOLD'] },
                    },
                    select: {
                        id: true,
                        batchNo: true,
                        status: true,
                        currentMachineId: true,
                        currentStageId: true,
                        startedAt: true,
                    },
                },
                _count: {
                    select: {
                        batches: true,
                    },
                },
            },
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
        }

        const completedBatches = await prisma.batch.count({
            where: {
                productId: id,
                status: 'COMPLETED',
            },
        });

        const cancelledBatches = await prisma.batch.count({
            where: {
                productId: id,
                status: 'CANCELLED',
            },
        });

        res.json({
            success: true,
            data: {
                ...product,
                stats: {
                    totalBatches: product._count.batches,
                    activeBatches: product.batches.length,
                    completedBatches,
                    cancelledBatches,
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

// Bulk import products
const bulkImportProducts = async (req, res, next) => {
    try {
        const { products } = req.body;

        if (!Array.isArray(products) || products.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Products array is required' },
            });
        }

        const results = {
            created: [],
            skipped: [],
            errors: [],
        };

        for (const productData of products) {
            try {
                const { name, code, description } = productData;

                if (!name) {
                    results.errors.push({ product: productData, error: 'Name is required' });
                    continue;
                }

                // Check for duplicate
                const existing = await prisma.product.findFirst({
                    where: {
                        OR: [
                            { name: name.trim() },
                            ...(code ? [{ code: code.trim() }] : []),
                        ],
                    },
                });

                if (existing) {
                    results.skipped.push({ name, code, reason: 'Already exists' });
                    continue;
                }

                const product = await prisma.product.create({
                    data: {
                        name: name.trim(),
                        code: code?.trim() || null,
                        description: description?.trim() || null,
                    },
                });

                results.created.push(product);

                await AuditService.log({
                    userId: req.user.id,
                    action: 'CREATE',
                    entity: 'Product',
                    entityId: product.id,
                    changes: { name: product.name, code: product.code },
                    ip: req.ip,
                    userAgent: req.get('user-agent'),
                    details: `Product "${product.name}" imported via bulk import`,
                });
            } catch (error) {
                results.errors.push({ product: productData, error: error.message });
            }
        }

        res.status(201).json({
            success: true,
            data: results,
            message: `Imported ${results.created.length} products, skipped ${results.skipped.length}, ${results.errors.length} errors`,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    toggleProductStatus,
    deleteProduct,
    getProductStats,
    bulkImportProducts,
};