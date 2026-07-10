// src/controllers/machine.controller.js

const prisma = require('../config/database');
const { getSocket } = require('../config/socket');

const emitMachineEvent = (event, data, initiatedBy) => {
    const io = getSocket();
    if (io) {
        io.emit(`machine:${event}`, { ...data, initiatedBy });
    }
};

// Get all machines (filtered by stage)
const getMachines = async (req, res, next) => {
    try {
        const { stageId, includeInactive } = req.query;
        const where = {};

        if (stageId) where.stageId = stageId;
        // Default to false if not provided
        if (includeInactive !== 'true') {
            where.isActive = true;
        }

        // Filter by assigned machines for operators
        if (req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0) {
            where.id = { in: req.user.assignedMachineIds };
        }

        const machines = await prisma.machine.findMany({
            where,
            include: {
                stage: {
                    include: { area: true },
                },
            },
            orderBy: [
                { sequence: 'asc' },
                { name: 'asc' },
            ],
        });

        res.json({ success: true, data: machines });
    } catch (error) {
        next(error);
    }
};

// Get single machine
const getMachine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const machine = await prisma.machine.findUnique({
            where: { id },
            include: {
                stage: {
                    include: { area: true },
                },
            },
        });

        if (!machine) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Machine not found' },
            });
        }

        // Check if user has access to this machine
        if (req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0) {
            if (!req.user.assignedMachineIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this machine' },
                });
            }
        }

        res.json({ success: true, data: machine });
    } catch (error) {
        next(error);
    }
};

// Create machine
const createMachine = async (req, res, next) => {
    try {
        const { stageId, name, code, status, sequence, description } = req.body;

        if (!stageId || !name) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Stage ID and name are required' },
            });
        }

        const stage = await prisma.stage.findUnique({
            where: { id: stageId, isActive: true },
        });

        if (!stage) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Stage not found' },
            });
        }

        const existing = await prisma.machine.findFirst({
            where: {
                stageId,
                name: name.trim(),
            },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: { code: 'DUPLICATE', message: 'Machine with this name already exists in this stage' },
            });
        }

        const machine = await prisma.machine.create({
            data: {
                stageId,
                name: name.trim(),
                code: code?.trim() || null,
                status: status || 'IDLE',
                sequence: sequence || 0,
                description: description?.trim() || null,
            },
            include: {
                stage: {
                    include: { area: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entity: 'Machine',
                entityId: machine.id,
                changes: machine,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitMachineEvent('created', machine, req.user.id);

        res.status(201).json({
            success: true,
            data: machine,
            message: 'Machine created successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Update machine
const updateMachine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, code, status, sequence, description, isActive } = req.body;

        const existing = await prisma.machine.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Machine not found' },
            });
        }

        // Check if user has access to this machine
        if (req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0) {
            if (!req.user.assignedMachineIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this machine' },
                });
            }
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (code !== undefined) updateData.code = code?.trim() || null;
        if (status !== undefined) updateData.status = status;
        if (sequence !== undefined) updateData.sequence = sequence;
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (isActive !== undefined) updateData.isActive = isActive;

        const machine = await prisma.machine.update({
            where: { id },
            data: updateData,
            include: {
                stage: {
                    include: { area: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE',
                entity: 'Machine',
                entityId: machine.id,
                changes: updateData,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitMachineEvent('updated', machine, req.user.id);

        res.json({
            success: true,
            data: machine,
            message: 'Machine updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Update machine status (for operators/supervisors)
const updateMachineStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, note } = req.body;

        const validStatuses = ['IDLE', 'RUNNING', 'CLEANING', 'DOWN'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Invalid status' },
            });
        }

        const existing = await prisma.machine.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Machine not found' },
            });
        }

        // Check if user has access to this machine
        if (req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0) {
            if (!req.user.assignedMachineIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this machine' },
                });
            }
        }

        const machine = await prisma.machine.update({
            where: { id },
            data: { status },
            include: {
                stage: {
                    include: { area: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'STATUS_CHANGE',
                entity: 'Machine',
                entityId: machine.id,
                changes: { status, note },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        // Emit status change event for live board
        const io = getSocket();
        if (io) {
            io.emit('board:machineStatus', {
                machineId: machine.id,
                status: machine.status,
                initiatedBy: req.user.id,
            });
        }

        emitMachineEvent('statusChanged', machine, req.user.id);

        res.json({
            success: true,
            data: machine,
            message: 'Machine status updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Delete machine (HARD DELETE)
const deleteMachine = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existing = await prisma.machine.findUnique({
            where: { id },
            include: {
                placements: {
                    where: { active: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Machine not found' },
            });
        }

        // Check if user has access to this machine
        if (req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0) {
            if (!req.user.assignedMachineIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this machine' },
                });
            }
        }

        // Check if machine has active placement
        if (existing.placements.length > 0) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'HAS_ACTIVE_BATCH',
                    message: 'Cannot delete machine with active batch. Please complete or cancel the batch first.',
                },
            });
        }

        // HARD DELETE
        await prisma.machine.delete({
            where: { id },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'DELETE',
                entity: 'Machine',
                entityId: id,
                changes: { deleted: true, name: existing.name },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitMachineEvent('deleted', { id, name: existing.name }, req.user.id);

        res.json({
            success: true,
            message: 'Machine deleted successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Reorder machines
const reorderMachines = async (req, res, next) => {
    try {
        const { stageId } = req.params;
        const { machineIds } = req.body;

        if (!Array.isArray(machineIds) || machineIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Valid machine IDs array is required' },
            });
        }

        const updates = machineIds.map((id, index) =>
            prisma.machine.update({
                where: { id },
                data: { sequence: index },
            })
        );

        await prisma.$transaction(updates);

        const machines = await prisma.machine.findMany({
            where: { stageId, isActive: true },
            orderBy: { sequence: 'asc' },
        });

        emitMachineEvent('reordered', { stageId, machines }, req.user.id);

        res.json({
            success: true,
            data: machines,
            message: 'Machines reordered successfully',
        });
    } catch (error) {
        next(error);
    }
};

const toggleMachineStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (isActive === undefined || isActive === null) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'isActive field is required' },
            });
        }

        const existing = await prisma.machine.findUnique({
            where: { id },
            include: {
                placements: {
                    where: { active: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Machine not found' },
            });
        }

        // Check if user has access to this machine
        if (req.user.role === 'OPERATOR' && req.user.assignedMachineIds?.length > 0) {
            if (!req.user.assignedMachineIds.includes(id)) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Access denied to this machine' },
                });
            }
        }

        // If disabling, check for active placement
        if (isActive === false && existing.placements.length > 0) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'HAS_ACTIVE_BATCH',
                    message: 'Cannot disable machine with active batch. Please complete or cancel the batch first.',
                },
            });
        }

        const machine = await prisma.machine.update({
            where: { id },
            data: { isActive },
            include: {
                stage: {
                    include: { area: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'STATUS_CHANGE',
                entity: 'Machine',
                entityId: machine.id,
                changes: { isActive },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitMachineEvent('updated', machine, req.user.id);

        res.json({
            success: true,
            data: machine,
            message: `Machine ${isActive ? 'enabled' : 'disabled'} successfully`,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMachines,
    getMachine,
    createMachine,
    updateMachine,
    updateMachineStatus,
    deleteMachine,
    reorderMachines,
    toggleMachineStatus,
};