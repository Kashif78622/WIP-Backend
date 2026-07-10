// src/services/audit.service.js
const prisma = require('../config/database');

class AuditService {
    /**
     * Create an audit log entry
     * @param {Object} params - Audit parameters
     * @param {string} params.userId - ID of the user performing the action
     * @param {string} params.action - Action type (CREATE, UPDATE, DELETE, etc.)
     * @param {string} params.entity - Entity type (User, Batch, Machine, etc.)
     * @param {string} [params.entityId] - ID of the affected entity
     * @param {Object} [params.changes] - Summary of changes
     * @param {Object} [params.before] - State before change
     * @param {Object} [params.after] - State after change
     * @param {string} [params.ip] - IP address of the requester
     * @param {string} [params.userAgent] - User agent of the requester
     * @param {string} [params.details] - Additional notes/details
     * @returns {Promise<Object>} Created audit log entry
     */
    static async log({
        userId,
        action,
        entity,
        entityId,
        changes,
        before,
        after,
        ip,
        userAgent,
        details,
    }) {
        try {
            // Clean up before/after to remove sensitive data
            const cleanData = (data) => {
                if (!data) return data;
                const cleaned = { ...data };
                // Remove sensitive fields
                delete cleaned.passwordHash;
                delete cleaned.refreshToken;
                delete cleaned.password;
                return cleaned;
            };

            const auditLog = await prisma.auditLog.create({
                data: {
                    userId,
                    action,
                    entity,
                    entityId,
                    changes: changes || null,
                    before: before ? cleanData(before) : null,
                    after: after ? cleanData(after) : null,
                    ip: ip || null,
                    userAgent: userAgent || null,
                    details: details || null,
                },
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

            return auditLog;
        } catch (error) {
            console.error('Failed to create audit log:', error);
            // Don't throw - audit logging should not break the main flow
            return null;
        }
    }

    /**
     * Get audit logs with filtering and pagination
     * @param {Object} params - Query parameters
     * @param {string} [params.entity] - Filter by entity type
     * @param {string} [params.entityId] - Filter by entity ID
     * @param {string} [params.action] - Filter by action
     * @param {string} [params.userId] - Filter by user ID
     * @param {Date} [params.from] - Filter by date range start
     * @param {Date} [params.to] - Filter by date range end
     * @param {string} [params.search] - Search across fields
     * @param {number} [params.page=1] - Page number
     * @param {number} [params.limit=20] - Items per page
     * @param {string} [params.orderBy='desc'] - Sort order
     * @returns {Promise<Object>} Paginated audit logs
     */
    static async getLogs({
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
    }) {
        const where = {};

        if (entity) where.entity = entity;
        if (entityId) where.entityId = entityId;
        if (action) where.action = action;
        if (userId) where.userId = userId;
        if (from || to) {
            where.createdAt = {};
            if (from) where.createdAt.gte = from;
            if (to) where.createdAt.lte = to;
        }
        if (search) {
            where.OR = [
                { entity: { contains: search, mode: 'insensitive' } },
                { action: { contains: search, mode: 'insensitive' } },
                { details: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [items, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
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
                orderBy: { createdAt: orderBy === 'desc' ? 'desc' : 'asc' },
                skip,
                take: parseInt(limit),
            }),
            prisma.auditLog.count({ where }),
        ]);

        return {
            items,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit)),
        };
    }

    /**
     * Get action types with counts for dashboard
     * @param {Object} params - Filter parameters
     * @returns {Promise<Object>} Action type counts
     */
    static async getActionStats(params = {}) {
        const { from, to, entity } = params;
        const where = {};
        if (entity) where.entity = entity;
        if (from || to) {
            where.createdAt = {};
            if (from) where.createdAt.gte = from;
            if (to) where.createdAt.lte = to;
        }

        const actions = await prisma.auditLog.groupBy({
            by: ['action'],
            where,
            _count: {
                action: true,
            },
            orderBy: {
                _count: {
                    action: 'desc',
                },
            },
        });

        return actions.map(a => ({
            action: a.action,
            count: a._count.action,
        }));
    }

    /**
     * Get recent activity for dashboard
     * @param {number} limit - Number of items to return
     * @returns {Promise<Array>} Recent activities
     */
    static async getRecentActivities(limit = 20) {
        return prisma.auditLog.findMany({
            take: limit,
            orderBy: { createdAt: 'desc' },
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
    }
}

module.exports = AuditService;