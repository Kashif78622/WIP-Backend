// src/controllers/area.controller.js

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
        const where = {};
        if (includeInactive !== 'true') {
            where.isActive = true;
        }

        // Filter by assigned areas for non-admin users
        if (req.user.role !== 'ADMIN' && req.user.assignedAreaIds?.length > 0) {
            where.id = { in: req.user.assignedAreaIds };
        }

        const areas = await prisma.area.findMany({
            where,
            include: {
                stages: {
                    include: {
                        machines: {
                            // Filter machines by assigned machine IDs for operators
                            ...(req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0
                                ? { where: { id: { in: req.user.assignedMachineIds } } }
                                : {}),
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

        // Check if user has access to this area
        if (req.user.role !== 'ADMIN' && req.user.assignedAreaIds?.length > 0) {
            if (!req.user.assignedAreaIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this area' },
                });
            }
        }

        const area = await prisma.area.findUnique({
            where: { id },
            include: {
                stages: {
                    include: {
                        machines: {
                            // Filter machines by assigned machine IDs for operators
                            ...(req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0
                                ? { where: { id: { in: req.user.assignedMachineIds } } }
                                : {}),
                        },
                    },
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

        // Check if user has access to this area
        if (req.user.role !== 'ADMIN' && req.user.assignedAreaIds?.length > 0) {
            if (!req.user.assignedAreaIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this area' },
                });
            }
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

// Delete area (HARD DELETE)
const deleteArea = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existing = await prisma.area.findUnique({
            where: { id },
            include: {
                stages: {
                    include: {
                        machines: {
                            include: {
                                placements: {
                                    where: { active: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        // Check if user has access to this area
        if (req.user.role !== 'ADMIN' && req.user.assignedAreaIds?.length > 0) {
            if (!req.user.assignedAreaIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this area' },
                });
            }
        }

        // Check if any machine in this area has active placements
        let hasActivePlacements = false;
        for (const stage of existing.stages) {
            for (const machine of stage.machines) {
                if (machine.placements.length > 0) {
                    hasActivePlacements = true;
                    break;
                }
            }
            if (hasActivePlacements) break;
        }

        if (hasActivePlacements) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'HAS_ACTIVE_BATCHES',
                    message: 'Cannot delete area with active batches. Please complete or cancel all batches first.',
                },
            });
        }

        // HARD DELETE: Delete all machines first, then stages, then area
        for (const stage of existing.stages) {
            // Delete all machines in this stage
            await prisma.machine.deleteMany({
                where: { stageId: stage.id },
            });
        }

        // Delete all stages in this area
        await prisma.stage.deleteMany({
            where: { areaId: id },
        });

        // Delete the area
        await prisma.area.delete({
            where: { id },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'DELETE',
                entity: 'Area',
                entityId: id,
                changes: { deleted: true, name: existing.name },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitAreaEvent('deleted', { id, name: existing.name }, req.user.id);

        res.json({
            success: true,
            message: 'Area deleted successfully',
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

        // Check if user has access to this area
        if (req.user.role !== 'ADMIN' && req.user.assignedAreaIds?.length > 0) {
            if (!req.user.assignedAreaIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this area' },
                });
            }
        }

        // If disabling, check for active machines
        if (isActive === false) {
            let hasActiveMachines = false;
            for (const stage of existing.stages) {
                for (const machine of stage.machines) {
                    if (machine.status === 'RUNNING') {
                        hasActiveMachines = true;
                        break;
                    }
                }
                if (hasActiveMachines) break;
            }

            if (hasActiveMachines) {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'HAS_ACTIVE_MACHINES',
                        message: 'Cannot disable area with active machines. Please complete or cancel all batches first.',
                    },
                });
            }

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