const prisma = require('../config/database');
const { getSocket } = require('../config/socket');

const emitBatchEvent = (event, data, initiatedBy) => {
    const io = getSocket();
    if (io) {
        io.emit(`batch:${event}`, { ...data, initiatedBy });
    }
};

// Get all batches
const getBatches = async (req, res, next) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = {};
        if (status) where.status = status;
        if (search) {
            where.OR = [
                { batchNo: { contains: search, mode: 'insensitive' } },
                { product: { name: { contains: search, mode: 'insensitive' } } },
            ];
        }

        const [batches, total] = await Promise.all([
            prisma.batch.findMany({
                where,
                include: {
                    product: true,
                    createdBy: {
                        select: { id: true, name: true },
                    },
                    placements: {
                        where: { active: true },
                        include: {
                            stage: true,
                            machine: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.batch.count({ where }),
        ]);

        res.json({
            success: true,
            data: batches,
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

// Get single batch
const getBatch = async (req, res, next) => {
    try {
        const { id } = req.params;
        const batch = await prisma.batch.findUnique({
            where: { id },
            include: {
                product: true,
                createdBy: {
                    select: { id: true, name: true },
                },
                placements: {
                    include: {
                        stage: true,
                        machine: true,
                        placedBy: {
                            select: { id: true, name: true },
                        },
                    },
                    orderBy: { placedAt: 'desc' },
                },
            },
        });

        if (!batch) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            });
        }

        res.json({ success: true, data: batch });
    } catch (error) {
        next(error);
    }
};

// Create batch
const createBatch = async (req, res, next) => {
    try {
        const { batchNo, productId, batchSizeText, batchSizeValue, remarks } = req.body;

        if (!batchNo || !productId || !batchSizeText) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Batch number, product, and size are required' },
            });
        }

        const existing = await prisma.batch.findUnique({
            where: { batchNo: batchNo.trim() },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: { code: 'DUPLICATE', message: 'Batch number already exists' },
            });
        }

        const product = await prisma.product.findUnique({
            where: { id: productId, isActive: true },
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Product not found' },
            });
        }

        const batch = await prisma.batch.create({
            data: {
                batchNo: batchNo.trim(),
                productId,
                batchSizeText: batchSizeText.trim(),
                batchSizeValue: batchSizeValue || null,
                remarks: remarks?.trim() || null,
                createdById: req.user.id,
                status: 'CREATED',
            },
            include: {
                product: true,
                createdBy: {
                    select: { id: true, name: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entity: 'Batch',
                entityId: batch.id,
                changes: batch,
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitBatchEvent('created', batch, req.user.id);

        res.status(201).json({
            success: true,
            data: batch,
            message: 'Batch created successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Place/Move batch to a machine
const placeBatch = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { stageId, machineId, remarks } = req.body;

        if (!stageId || !machineId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Stage and machine are required' },
            });
        }

        const batch = await prisma.batch.findUnique({ where: { id } });
        if (!batch) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            });
        }

        // Check batch status
        if (batch.status === 'COMPLETED' || batch.status === 'CANCELLED') {
            return res.status(409).json({
                success: false,
                error: { code: 'BATCH_FROZEN', message: 'Completed/Cancelled batches cannot be moved' },
            });
        }

        // Check machine exists and is active
        const machine = await prisma.machine.findUnique({
            where: { id: machineId, isActive: true },
            include: {
                stage: true,
            },
        });

        if (!machine) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Machine not found' },
            });
        }

        // Check if machine is available
        if (machine.status === 'DOWN' || machine.status === 'CLEANING') {
            return res.status(409).json({
                success: false,
                error: { code: 'MACHINE_UNAVAILABLE', message: `Machine is ${machine.status.toLowerCase()}` },
            });
        }

        // Check if machine is occupied
        const activePlacement = await prisma.placement.findFirst({
            where: {
                machineId,
                active: true,
            },
            include: {
                batch: true,
            },
        });

        if (activePlacement) {
            return res.status(409).json({
                success: false,
                error: { code: 'MACHINE_OCCUPIED', message: `Machine already has batch ${activePlacement.batch.batchNo}` },
            });
        }

        // Check if batch has active placement
        const currentPlacement = await prisma.placement.findFirst({
            where: {
                batchId: id,
                active: true,
            },
            include: {
                machine: true,
            },
        });

        let freedMachineId = null;
        let oldMachineId = null;

        // Start transaction
        const result = await prisma.$transaction(async (tx) => {
            // If batch has active placement, close it
            if (currentPlacement) {
                oldMachineId = currentPlacement.machineId;
                await tx.placement.update({
                    where: { id: currentPlacement.id },
                    data: {
                        active: false,
                        removedAt: new Date(),
                        removedById: req.user.id,
                    },
                });

                // Free the old machine
                await tx.machine.update({
                    where: { id: currentPlacement.machineId },
                    data: {
                        status: 'IDLE',
                        activePlacementId: null,
                    },
                });
                freedMachineId = currentPlacement.machineId;
            }

            // Create new placement
            const placement = await tx.placement.create({
                data: {
                    batchId: id,
                    stageId,
                    machineId,
                    placedAt: new Date(),
                    placedById: req.user.id,
                    remarks: remarks?.trim() || null,
                },
                include: {
                    batch: true,
                    stage: true,
                    machine: true,
                    placedBy: {
                        select: { id: true, name: true },
                    },
                },
            });

            // Update machine status to RUNNING
            await tx.machine.update({
                where: { id: machineId },
                data: {
                    status: 'RUNNING',
                    activePlacementId: placement.id,
                },
            });

            // Update batch status to IN_PROGRESS if not already
            if (batch.status === 'CREATED' || batch.status === 'ON_HOLD') {
                await tx.batch.update({
                    where: { id },
                    data: {
                        status: 'IN_PROGRESS',
                        currentStageId: stageId,
                        currentMachineId: machineId,
                        startedAt: batch.status === 'CREATED' ? new Date() : undefined,
                    },
                });
            } else {
                await tx.batch.update({
                    where: { id },
                    data: {
                        currentStageId: stageId,
                        currentMachineId: machineId,
                    },
                });
            }

            return placement;
        });

        // Get updated batch
        const updatedBatch = await prisma.batch.findUnique({
            where: { id },
            include: {
                product: true,
                createdBy: {
                    select: { id: true, name: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'PLACE',
                entity: 'Batch',
                entityId: id,
                changes: { stageId, machineId, remarks },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        // Emit events
        const io = getSocket();
        if (io) {
            io.emit('board:placement', {
                machineId,
                batchId: id,
                batchNo: updatedBatch.batchNo,
                stageId,
                productName: updatedBatch.product.name,
                batchSizeText: updatedBatch.batchSizeText,
                initiatedBy: req.user.id,
            });

            if (freedMachineId) {
                io.emit('board:freed', {
                    machineId: freedMachineId,
                    initiatedBy: req.user.id,
                });
            }
        }

        emitBatchEvent('placed', {
            batchId: id,
            placement: result,
            freedMachineId,
        }, req.user.id);

        res.json({
            success: true,
            data: {
                batch: updatedBatch,
                placement: result,
                freedMachineId,
            },
            message: `Batch ${updatedBatch.batchNo} placed on ${result.machine.name}`,
        });
    } catch (error) {
        next(error);
    }
};

// Hold batch
const holdBatch = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const batch = await prisma.batch.findUnique({
            where: { id },
            include: {
                placements: {
                    where: { active: true },
                    include: { machine: true },
                },
            },
        });

        if (!batch) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            });
        }

        if (batch.status === 'COMPLETED' || batch.status === 'CANCELLED') {
            return res.status(409).json({
                success: false,
                error: { code: 'BATCH_FROZEN', message: 'Cannot hold completed/cancelled batch' },
            });
        }

        if (batch.status === 'ON_HOLD') {
            return res.status(409).json({
                success: false,
                error: { code: 'ALREADY_ON_HOLD', message: 'Batch is already on hold' },
            });
        }

        const updatedBatch = await prisma.batch.update({
            where: { id },
            data: {
                status: 'ON_HOLD',
                remarks: reason ? `${batch.remarks || ''}\nHold: ${reason}`.trim() : batch.remarks,
            },
            include: {
                product: true,
                createdBy: {
                    select: { id: true, name: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'HOLD',
                entity: 'Batch',
                entityId: id,
                changes: { reason },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        const io = getSocket();
        if (io) {
            io.emit('board:batchStatus', {
                batchId: id,
                status: 'ON_HOLD',
                initiatedBy: req.user.id,
            });
        }

        res.json({
            success: true,
            data: updatedBatch,
            message: 'Batch placed on hold',
        });
    } catch (error) {
        next(error);
    }
};

// Resume batch
const resumeBatch = async (req, res, next) => {
    try {
        const { id } = req.params;

        const batch = await prisma.batch.findUnique({ where: { id } });
        if (!batch) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            });
        }

        if (batch.status !== 'ON_HOLD') {
            return res.status(409).json({
                success: false,
                error: { code: 'NOT_ON_HOLD', message: 'Batch is not on hold' },
            });
        }

        const updatedBatch = await prisma.batch.update({
            where: { id },
            data: { status: 'IN_PROGRESS' },
            include: {
                product: true,
                createdBy: {
                    select: { id: true, name: true },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'RESUME',
                entity: 'Batch',
                entityId: id,
                changes: { resumed: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        const io = getSocket();
        if (io) {
            io.emit('board:batchStatus', {
                batchId: id,
                status: 'IN_PROGRESS',
                initiatedBy: req.user.id,
            });
        }

        res.json({
            success: true,
            data: updatedBatch,
            message: 'Batch resumed',
        });
    } catch (error) {
        next(error);
    }
};

// Complete batch
const completeBatch = async (req, res, next) => {
    try {
        const { id } = req.params;

        const batch = await prisma.batch.findUnique({
            where: { id },
            include: {
                placements: {
                    where: { active: true },
                    include: { machine: true },
                },
            },
        });

        if (!batch) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            });
        }

        if (batch.status === 'COMPLETED') {
            return res.status(409).json({
                success: false,
                error: { code: 'ALREADY_COMPLETED', message: 'Batch is already completed' },
            });
        }

        if (batch.status === 'CANCELLED') {
            return res.status(409).json({
                success: false,
                error: { code: 'CANCELLED', message: 'Cancelled batch cannot be completed' },
            });
        }

        // Close active placement
        const activePlacement = batch.placements.find(p => p.active);
        let machineId = null;

        const result = await prisma.$transaction(async (tx) => {
            if (activePlacement) {
                machineId = activePlacement.machineId;
                await tx.placement.update({
                    where: { id: activePlacement.id },
                    data: {
                        active: false,
                        removedAt: new Date(),
                        removedById: req.user.id,
                    },
                });

                await tx.machine.update({
                    where: { id: activePlacement.machineId },
                    data: {
                        status: 'IDLE',
                        activePlacementId: null,
                    },
                });
            }

            const updatedBatch = await tx.batch.update({
                where: { id },
                data: {
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    currentStageId: null,
                    currentMachineId: null,
                },
                include: {
                    product: true,
                    createdBy: {
                        select: { id: true, name: true },
                    },
                },
            });

            return updatedBatch;
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'COMPLETE',
                entity: 'Batch',
                entityId: id,
                changes: { completed: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        const io = getSocket();
        if (io) {
            if (machineId) {
                io.emit('board:freed', {
                    machineId,
                    initiatedBy: req.user.id,
                });
            }
            io.emit('board:batchStatus', {
                batchId: id,
                status: 'COMPLETED',
                initiatedBy: req.user.id,
            });
        }

        emitBatchEvent('completed', result, req.user.id);

        res.json({
            success: true,
            data: result,
            message: 'Batch completed successfully',
        });
    } catch (error) {
        next(error);
    }
};

// Cancel batch
const cancelBatch = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const batch = await prisma.batch.findUnique({
            where: { id },
            include: {
                placements: {
                    where: { active: true },
                    include: { machine: true },
                },
            },
        });

        if (!batch) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Batch not found' },
            });
        }

        if (batch.status === 'COMPLETED') {
            return res.status(409).json({
                success: false,
                error: { code: 'ALREADY_COMPLETED', message: 'Cannot cancel completed batch' },
            });
        }

        if (batch.status === 'CANCELLED') {
            return res.status(409).json({
                success: false,
                error: { code: 'ALREADY_CANCELLED', message: 'Batch is already cancelled' },
            });
        }

        // Close active placement
        const activePlacement = batch.placements.find(p => p.active);
        let machineId = null;

        const result = await prisma.$transaction(async (tx) => {
            if (activePlacement) {
                machineId = activePlacement.machineId;
                await tx.placement.update({
                    where: { id: activePlacement.id },
                    data: {
                        active: false,
                        removedAt: new Date(),
                        removedById: req.user.id,
                    },
                });

                await tx.machine.update({
                    where: { id: activePlacement.machineId },
                    data: {
                        status: 'IDLE',
                        activePlacementId: null,
                    },
                });
            }

            const updatedBatch = await tx.batch.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    currentStageId: null,
                    currentMachineId: null,
                    remarks: reason ? `${batch.remarks || ''}\nCancelled: ${reason}`.trim() : batch.remarks,
                },
                include: {
                    product: true,
                    createdBy: {
                        select: { id: true, name: true },
                    },
                },
            });

            return updatedBatch;
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CANCEL',
                entity: 'Batch',
                entityId: id,
                changes: { reason },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        const io = getSocket();
        if (io) {
            if (machineId) {
                io.emit('board:freed', {
                    machineId,
                    initiatedBy: req.user.id,
                });
            }
            io.emit('board:batchStatus', {
                batchId: id,
                status: 'CANCELLED',
                initiatedBy: req.user.id,
            });
        }

        res.json({
            success: true,
            data: result,
            message: 'Batch cancelled',
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getBatches,
    getBatch,
    createBatch,
    placeBatch,
    holdBatch,
    resumeBatch,
    completeBatch,
    cancelBatch,
};