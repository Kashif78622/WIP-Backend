// src/middleware/audit.middleware.js
const AuditService = require('../services/audit.service');

/**
 * Middleware to automatically audit CRUD operations
 * Use this with Prisma's $use or as a wrapper around service methods
 */
class AuditMiddleware {
    /**
     * Create an audit wrapper for a service method
     * @param {Function} method - The service method to wrap
     * @param {Object} context - Context containing user info
     * @param {string} context.userId - ID of the current user
     * @param {string} context.ip - IP address
     * @param {string} context.userAgent - User agent
     * @returns {Function} Wrapped method
     */
    static wrapMethod(method, context) {
        return async (...args) => {
            // Execute the method
            const result = await method(...args);

            // Audit is handled by the service layer
            return result;
        };
    }

    /**
     * Get audit context from request
     * @param {Object} req - Express request object
     * @returns {Object} Audit context
     */
    static getContext(req) {
        return {
            userId: req.user?.id,
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.get('user-agent'),
        };
    }
}

module.exports = AuditMiddleware;