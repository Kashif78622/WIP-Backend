// src/routes/audit.routes.js
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const AuditService = require('../services/audit.service');

const router = express.Router();

// All audit routes require authentication
router.use(authenticate);

// Get audit logs with filters - Available to Supervisor+
router.get('/', requireRole('SUPERVISOR'), async (req, res, next) => {
    try {
        const {
            entity,
            entityId,
            action,
            userId,
            from,
            to,
            search,
            page = 1,
            limit = 20,
            orderBy = 'desc',
        } = req.query;

        const result = await AuditService.getLogs({
            entity,
            entityId,
            action,
            userId,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            search,
            page,
            limit,
            orderBy,
        });

        res.json({
            success: true,
            data: result.items,
            meta: {
                total: result.total,
                page: result.page,
                limit: result.limit,
                pages: result.pages,
            },
        });
    } catch (error) {
        next(error);
    }
});

// Get audit stats - Available to Manager+
router.get('/stats', requireRole('MANAGER'), async (req, res, next) => {
    try {
        const { from, to, entity } = req.query;
        const stats = await AuditService.getActionStats({
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            entity,
        });

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
});

// Get recent activities for dashboard - Available to all authenticated users
router.get('/recent', async (req, res, next) => {
    try {
        const { limit = 20 } = req.query;
        const activities = await AuditService.getRecentActivities(parseInt(limit));

        // Format for dashboard display
        const formattedActivities = activities.map(activity => ({
            id: activity.id,
            action: activity.action,
            entity: activity.entity,
            entityId: activity.entityId,
            user: activity.user?.name || 'System',
            userId: activity.userId,
            time: activity.createdAt,
            details: activity.details,
            changes: activity.changes,
        }));

        res.json({
            success: true,
            data: formattedActivities,
        });
    } catch (error) {
        next(error);
    }
});

// Get audit log by ID - Available to Supervisor+
router.get('/:id', requireRole('SUPERVISOR'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const log = await prisma.auditLog.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
            },
        });

        if (!log) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Audit log not found' },
            });
        }

        res.json({
            success: true,
            data: log,
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;