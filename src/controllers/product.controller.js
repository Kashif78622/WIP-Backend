const prisma = require('../config/database');
const { getSocket } = require('../config/socket');

const emitProductEvent = (event, data, initiatedBy) => {
    const io = getSocket();
    if (io) {
        io.emit(`product:${event}`, { ...data, initiatedBy });
    }
};

// Get all products
const getProducts = async (req, res, next) => {
    try {
        const { search, includeInactive } = req.query;
        const where = {};

        if (includeInactive !== 'true') where.isActive = true;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
            ];
        }

        const products = await prisma.product.findMany({
            where,
            include: {
                batches: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                },
            },
            orderBy: { name: 'asc' },
        });

        res.json({ success: true, data: products });
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

        const existing = await prisma.product.findFirst({
            where: { name: name.trim() },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: { code: 'DUPLICATE', message: 'Product with this name already exists' },
            });
        }

        const product = await prisma.product.create({
            data: {
                name: name.trim(),
                code: code?.trim() || null,
                description: description?.trim() || null,
                defaultStageId: defaultStageId || null,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entity: 'Product',
                entityId: product.id,
                changes: product,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
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

        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
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
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE',
                entity: 'Product',
                entityId: product.id,
                changes: updateData,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
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

// Delete product (soft delete)
const deleteProduct = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existing = await prisma.product.findUnique({
            where: { id },
            include: {
                batches: {
                    take: 1,
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
        }

        if (existing.batches.length > 0) {
            return res.status(409).json({
                success: false,
                error: { code: 'HAS_BATCHES', message: 'Cannot deactivate product with existing batches' },
            });
        }

        const product = await prisma.product.update({
            where: { id },
            data: { isActive: false },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'DELETE',
                entity: 'Product',
                entityId: id,
                changes: { deleted: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitProductEvent('deleted', { id }, req.user.id);

        res.json({
            success: true,
            message: 'Product deactivated successfully',
        });
    } catch (error) {
        next(error);
    }
};
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
                batches: {
                    take: 1,
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
        if (isActive === false && existing.batches.length > 0) {
            return res.status(409).json({
                success: false,
                error: { code: 'HAS_BATCHES', message: 'Cannot disable product with existing batches' },
            });
        }

        const product = await prisma.product.update({
            where: { id },
            data: { isActive },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'STATUS_CHANGE',
                entity: 'Product',
                entityId: product.id,
                changes: { isActive },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
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

module.exports = {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    toggleProductStatus,
};