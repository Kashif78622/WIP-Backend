// src/controllers/board.controller.js
const prisma = require('../config/database');
const AuditService = require('../services/audit.service');

// Get complete board data with all areas
const getBoard = async (req, res, next) => {
    try {
        const { areaId } = req.query;

        const where = {};
        if (areaId) where.id = areaId;

        // Get all areas with their stages and machines
        const areas = await prisma.area.findMany({
            where: {
                ...where,
                isActive: true,
            },
            include: {
                stages: {
                    where: { isActive: true },
                    include: {
                        machines: {
                            where: { isActive: true },
                            include: {
                                placements: {
                                    where: { active: true },
                                    include: {
                                        batch: {
                                            include: {
                                                product: true,
                                            },
                                        },
                                    },
                                },
                            },
                            orderBy: { sequence: 'asc' },
                        },
                    },
                    orderBy: { sequence: 'asc' },
                },
            },
            orderBy: { name: 'asc' },
        });

        // Transform data for frontend
        const boardData = areas.map(area => ({
            id: area.id,
            name: area.name,
            code: area.code,
            stages: area.stages.map(stage => ({
                id: stage.id,
                name: stage.name,
                sequence: stage.sequence,
                machines: stage.machines.map(machine => {
                    const activePlacement = machine.placements[0];
                    return {
                        id: machine.id,
                        name: machine.name,
                        code: machine.code,
                        status: machine.status,
                        sequence: machine.sequence,
                        isActive: machine.isActive,
                        activeBatch: activePlacement ? {
                            id: activePlacement.batch.id,
                            batchNo: activePlacement.batch.batchNo,
                            productName: activePlacement.batch.product.name,
                            productId: activePlacement.batch.productId,
                            batchSizeText: activePlacement.batch.batchSizeText,
                            status: activePlacement.batch.status,
                            placementId: activePlacement.id,
                        } : null,
                    };
                }),
            })),
        }));

        res.json({
            success: true,
            data: boardData,
        });
    } catch (error) {
        next(error);
    }
};

// Get single area board
const getAreaBoard = async (req, res, next) => {
    try {
        const { areaId } = req.params;

        const area = await prisma.area.findUnique({
            where: { id: areaId, isActive: true },
            include: {
                stages: {
                    where: { isActive: true },
                    include: {
                        machines: {
                            where: { isActive: true },
                            include: {
                                placements: {
                                    where: { active: true },
                                    include: {
                                        batch: {
                                            include: {
                                                product: true,
                                            },
                                        },
                                    },
                                },
                            },
                            orderBy: { sequence: 'asc' },
                        },
                    },
                    orderBy: { sequence: 'asc' },
                },
            },
        });

        if (!area) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        const boardData = {
            id: area.id,
            name: area.name,
            code: area.code,
            stages: area.stages.map(stage => ({
                id: stage.id,
                name: stage.name,
                sequence: stage.sequence,
                machines: stage.machines.map(machine => {
                    const activePlacement = machine.placements[0];
                    return {
                        id: machine.id,
                        name: machine.name,
                        code: machine.code,
                        status: machine.status,
                        sequence: machine.sequence,
                        isActive: machine.isActive,
                        activeBatch: activePlacement ? {
                            id: activePlacement.batch.id,
                            batchNo: activePlacement.batch.batchNo,
                            productName: activePlacement.batch.product.name,
                            productId: activePlacement.batch.productId,
                            batchSizeText: activePlacement.batch.batchSizeText,
                            status: activePlacement.batch.status,
                            placementId: activePlacement.id,
                        } : null,
                    };
                }),
            })),
        };

        res.json({
            success: true,
            data: boardData,
        });
    } catch (error) {
        next(error);
    }
};

// Get board history for a machine
const getMachineHistory = async (req, res, next) => {
    try {
        const { machineId } = req.params;
        const { limit = 20 } = req.query;

        const placements = await prisma.placement.findMany({
            where: { machineId },
            include: {
                batch: {
                    include: {
                        product: true,
                    },
                },
                placedBy: {
                    select: { id: true, name: true },
                },
                removedBy: {
                    select: { id: true, name: true },
                },
                stage: true,
            },
            orderBy: { placedAt: 'desc' },
            take: parseInt(limit),
        });

        res.json({
            success: true,
            data: placements,
        });
    } catch (error) {
        next(error);
    }
};

// Get board snapshot
const getBoardSnapshot = async (req, res, next) => {
    try {
        const { areaId } = req.params;
        const { timestamp } = req.query;

        const where = { areaId };
        if (timestamp) {
            const date = new Date(timestamp);
            where.takenAt = {
                gte: new Date(date.setHours(0, 0, 0, 0)),
                lte: new Date(date.setHours(23, 59, 59, 999)),
            };
        }

        const snapshots = await prisma.snapshot.findMany({
            where,
            include: {
                takenBy: {
                    select: { id: true, name: true },
                },
            },
            orderBy: { takenAt: 'desc' },
            take: 10,
        });

        res.json({
            success: true,
            data: snapshots,
        });
    } catch (error) {
        next(error);
    }
};

// Take board snapshot
const takeSnapshot = async (req, res, next) => {
    try {
        const { areaId } = req.body;

        if (!areaId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Area ID is required' },
            });
        }

        // Get current board state
        const area = await prisma.area.findUnique({
            where: { id: areaId },
            include: {
                stages: {
                    where: { isActive: true },
                    include: {
                        machines: {
                            where: { isActive: true },
                            include: {
                                placements: {
                                    where: { active: true },
                                    include: {
                                        batch: {
                                            include: {
                                                product: true,
                                            },
                                        },
                                    },
                                },
                            },
                            orderBy: { sequence: 'asc' },
                        },
                    },
                    orderBy: { sequence: 'asc' },
                },
            },
        });

        if (!area) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Area not found' },
            });
        }

        // Build board state
        const boardState = {
            areaId: area.id,
            areaName: area.name,
            timestamp: new Date().toISOString(),
            stages: area.stages.map(stage => ({
                id: stage.id,
                name: stage.name,
                sequence: stage.sequence,
                machines: stage.machines.map(machine => {
                    const activePlacement = machine.placements[0];
                    return {
                        id: machine.id,
                        name: machine.name,
                        code: machine.code,
                        status: machine.status,
                        sequence: machine.sequence,
                        activeBatch: activePlacement ? {
                            id: activePlacement.batch.id,
                            batchNo: activePlacement.batch.batchNo,
                            productName: activePlacement.batch.product.name,
                            batchSizeText: activePlacement.batch.batchSizeText,
                            status: activePlacement.batch.status,
                        } : null,
                    };
                }),
            })),
        };

        // Save snapshot
        const snapshot = await prisma.snapshot.create({
            data: {
                areaId,
                takenAt: new Date(),
                takenById: req.user.id,
                type: 'manual',
                board: boardState,
            },
            include: {
                takenBy: {
                    select: { id: true, name: true },
                },
            },
        });

        await AuditService.log({
            userId: req.user.id,
            action: 'CREATE',
            entity: 'Snapshot',
            entityId: snapshot.id,
            changes: { areaId },
            ip: req.ip,
            userAgent: req.get('user-agent'),
            details: `Snapshot taken for area: ${area.name}`,
        });

        // Emit snapshot event
        const io = getSocket();
        if (io) {
            io.emit(`area:${areaId}:snapshot`, {
                snapshot,
                initiatedBy: req.user.id,
            });
        }

        res.status(201).json({
            success: true,
            data: snapshot,
            message: 'Snapshot taken successfully',
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getBoard,
    getAreaBoard,
    getMachineHistory,
    getBoardSnapshot,
    takeSnapshot,
};