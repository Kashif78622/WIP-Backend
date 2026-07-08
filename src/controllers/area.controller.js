const prisma = require('../config/database');
const { getSocket } = require('../config/socket');

const emitAreaEvent = (event, data, initiatedBy) => {
    const io = getSocket();
    if (io) {
        io.emit(`area:${event}`, { ...data, initiatedBy });
    }
};

// Get all areas
const getAreas = async (req, res, next) => {
    try {
        const { includeInactive } = req.query;
        // Default to false if not provided, but include all when true
        const where = {};
        if (includeInactive !== 'true') {
            where.isActive = true;
        }

        const areas = await prisma.area.findMany({
            where,
            include: {
                stages: {
                    include: {
                        machines: {
                            // Always include all machines regardless of status
                        },
                    },
                },
            },
            orderBy: { name: 'asc' },
        });

        res.json({ success: true, data: areas });
    } catch (error) {
        next(error);
    }
};

// Get single area
const getArea = async (req, res, next) => {
    try {
        const { id } = req.params;
        const area = await prisma.area.findUnique({
            where: { id },
            include: {
                stages: {
                    include: { machines: true },
                },
            },
        });

        if (!area) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        res.json({ success: true, data: area });
    } catch (error) {
        next(error);
    }
};

// Create area
const createArea = async (req, res, next) => {
    try {
        const { name, code, description } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
            });
        }

        const existing = await prisma.area.findFirst({
            where: { name: name.trim() },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: { code: 'DUPLICATE', message: 'Area with this name already exists' },
            });
        }

        const area = await prisma.area.create({
            data: {
                name: name.trim(),
                code: code?.trim() || null,
                description: description?.trim() || null,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entity: 'Area',
                entityId: area.id,
                changes: area,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitAreaEvent('created', area, req.user.id);

        res.status(201).json({
            success: true,
            data: area,
            message: 'Area created successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Update area
const updateArea = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, code, description, isActive } = req.body;

        const existing = await prisma.area.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (code !== undefined) updateData.code = code?.trim() || null;
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (isActive !== undefined) updateData.isActive = isActive;

        const area = await prisma.area.update({
            where: { id },
            data: updateData,
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE',
                entity: 'Area',
                entityId: area.id,
                changes: updateData,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitAreaEvent('updated', area, req.user.id);

        res.json({
            success: true,
            data: area,
            message: 'Area updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Delete area (soft delete)
const deleteArea = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existing = await prisma.area.findUnique({
            where: { id },
            include: {
                stages: {
                    include: { machines: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        // Soft delete - just deactivate
        const area = await prisma.area.update({
            where: { id },
            data: { isActive: false },
        });

        // Also deactivate all stages and machines in this area
        await prisma.stage.updateMany({
            where: { areaId: id },
            data: { isActive: false },
        });

        await prisma.machine.updateMany({
            where: { stage: { areaId: id } },
            data: { isActive: false },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'DELETE',
                entity: 'Area',
                entityId: id,
                changes: { deleted: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitAreaEvent('deleted', { id }, req.user.id);

        res.json({
            success: true,
            message: 'Area deactivated successfully',
        });
    } catch (error) {
        next(error);
    }
};
const toggleAreaStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (isActive === undefined || isActive === null) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'isActive field is required' },
            });
        }

        const existing = await prisma.area.findUnique({
            where: { id },
            include: {
                stages: {
                    include: { machines: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        // If disabling, also disable all stages and machines in this area
        if (isActive === false) {
            await prisma.stage.updateMany({
                where: { areaId: id },
                data: { isActive: false },
            });
            await prisma.machine.updateMany({
                where: { stage: { areaId: id } },
                data: { isActive: false },
            });
        }

        const area = await prisma.area.update({
            where: { id },
            data: { isActive },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'STATUS_CHANGE',
                entity: 'Area',
                entityId: area.id,
                changes: { isActive },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitAreaEvent('updated', area, req.user.id);

        res.json({
            success: true,
            data: area,
            message: `Area ${isActive ? 'enabled' : 'disabled'} successfully`,
        });
    } catch (error) {
        next(error);
    }
};
module.exports = {
    getAreas,
    getArea,
    createArea,
    updateArea,
    deleteArea,
    toggleAreaStatus,
};