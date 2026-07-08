const prisma = require('../config/database');

// Get live board
const getBoard = async (req, res, next) => {
    try {
        const { areaId } = req.query;

        const where = {};
        if (areaId) where.areaId = areaId;

        const stages = await prisma.stage.findMany({
            where: {
                ...where,
                isActive: true,
            },
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
        });

        // Transform data for frontend
        const boardData = stages.map(stage => ({
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
                        batchSizeText: activePlacement.batch.batchSizeText,
                        status: activePlacement.batch.status,
                    } : null,
                };
            }),
        }));

        res.json({
            success: true,
            data: boardData,
        });
    } catch (error) {
        next(error);
    }
};

// Get single machine with current batch
const getMachineWithBatch = async (req, res, next) => {
    try {
        const { id } = req.params;

        const machine = await prisma.machine.findUnique({
            where: { id },
            include: {
                stage: {
                    include: { area: true },
                },
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
        });

        if (!machine) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Machine not found' },
            });
        }

        const activePlacement = machine.placements[0];
        const result = {
            ...machine,
            activeBatch: activePlacement ? {
                id: activePlacement.batch.id,
                batchNo: activePlacement.batch.batchNo,
                productName: activePlacement.batch.product.name,
                batchSizeText: activePlacement.batch.batchSizeText,
                status: activePlacement.batch.status,
            } : null,
        };

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getBoard,
    getMachineWithBatch,
};