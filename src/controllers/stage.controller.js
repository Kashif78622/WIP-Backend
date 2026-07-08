const prisma = require('../config/database');
const { getSocket } = require('../config/socket');

const emitStageEvent = (event, data, initiatedBy) => {
    const io = getSocket();
    if (io) {
        io.emit(`stage:${event}`, { ...data, initiatedBy });
    }
};

// Get all stages for an area
const getStages = async (req, res, next) => {
    try {
        const { areaId, includeInactive } = req.query;
        const where = {};

        if (areaId) where.areaId = areaId;
        // Default to false if not provided
        if (includeInactive !== 'true') {
            where.isActive = true;
        }

        const stages = await prisma.stage.findMany({
            where,
            include: {
                area: true,
                machines: {
                    // Include all machines regardless of status
                },
            },
            orderBy: [
                { sequence: 'asc' },
                { name: 'asc' },
            ],
        });

        res.json({ success: true, data: stages });
    } catch (error) {
        next(error);
    }
};

// Get single stage
const getStage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const stage = await prisma.stage.findUnique({
            where: { id },
            include: {
                area: true,
                machines: true,
            },
        });

        if (!stage) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Stage not found' },
            });
        }

        res.json({ success: true, data: stage });
    } catch (error) {
        next(error);
    }
};

// Create stage
const createStage = async (req, res, next) => {
    try {
        const { areaId, name, sequence, description } = req.body;

        if (!areaId || !name) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Area ID and name are required' },
            });
        }

        const area = await prisma.area.findUnique({
            where: { id: areaId, isActive: true },
        });

        if (!area) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        const existing = await prisma.stage.findFirst({
            where: {
                areaId,
                name: name.trim(),
            },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: { code: 'DUPLICATE', message: 'Stage with this name already exists in this area' },
            });
        }

        const stage = await prisma.stage.create({
            data: {
                areaId,
                name: name.trim(),
                sequence: sequence || 0,
                description: description?.trim() || null,
            },
            include: { area: true },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entity: 'Stage',
                entityId: stage.id,
                changes: stage,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitStageEvent('created', stage, req.user.id);

        res.status(201).json({
            success: true,
            data: stage,
            message: 'Stage created successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Update stage
const updateStage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, sequence, description, isActive } = req.body;

        const existing = await prisma.stage.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Stage not found' },
            });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (sequence !== undefined) updateData.sequence = sequence;
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (isActive !== undefined) updateData.isActive = isActive;

        const stage = await prisma.stage.update({
            where: { id },
            data: updateData,
            include: { area: true },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE',
                entity: 'Stage',
                entityId: stage.id,
                changes: updateData,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitStageEvent('updated', stage, req.user.id);

        res.json({
            success: true,
            data: stage,
            message: 'Stage updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Delete stage (soft delete)
const deleteStage = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existing = await prisma.stage.findUnique({
            where: { id },
            include: { machines: true },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Stage not found' },
            });
        }

        // Soft delete
        const stage = await prisma.stage.update({
            where: { id },
            data: { isActive: false },
        });

        // Also deactivate all machines in this stage
        await prisma.machine.updateMany({
            where: { stageId: id },
            data: { isActive: false },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'DELETE',
                entity: 'Stage',
                entityId: id,
                changes: { deleted: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitStageEvent('deleted', { id }, req.user.id);

        res.json({
            success: true,
            message: 'Stage deactivated successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Reorder stages
const reorderStages = async (req, res, next) => {
    try {
        const { areaId } = req.params;
        const { stageIds } = req.body;

        if (!Array.isArray(stageIds) || stageIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Valid stage IDs array is required' },
            });
        }

        const updates = stageIds.map((id, index) =>
            prisma.stage.update({
                where: { id },
                data: { sequence: index },
            })
        );

        await prisma.$transaction(updates);

        const stages = await prisma.stage.findMany({
            where: { areaId, isActive: true },
            orderBy: { sequence: 'asc' },
        });

        emitStageEvent('reordered', { areaId, stages }, req.user.id);

        res.json({
            success: true,
            data: stages,
            message: 'Stages reordered successfully',
        });
    } catch (error) {
        next(error);
    }
};
const toggleStageStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (isActive === undefined || isActive === null) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'isActive field is required' },
            });
        }

        const existing = await prisma.stage.findUnique({
            where: { id },
            include: { machines: true },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Stage not found' },
            });
        }

        // If disabling, also disable all machines in this stage
        if (isActive === false) {
            await prisma.machine.updateMany({
                where: { stageId: id },
                data: { isActive: false },
            });
        }

        const stage = await prisma.stage.update({
            where: { id },
            data: { isActive },
            include: { area: true },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'STATUS_CHANGE',
                entity: 'Stage',
                entityId: stage.id,
                changes: { isActive },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitStageEvent('updated', stage, req.user.id);

        res.json({
            success: true,
            data: stage,
            message: `Stage ${isActive ? 'enabled' : 'disabled'} successfully`,
        });
    } catch (error) {
        next(error);
    }
};
module.exports = {
    getStages,
    getStage,
    createStage,
    updateStage,
    deleteStage,
    reorderStages,
    toggleStageStatus,
};