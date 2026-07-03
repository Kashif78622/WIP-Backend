// src/middleware/role.middleware.js
const ROLE_HIERARCHY = ['VIEWER', 'OPERATOR', 'SUPERVISOR', 'MANAGER', 'ADMIN'];

const requireRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            });
        }

        const userRoleIndex = ROLE_HIERARCHY.indexOf(req.user.role);
        const requiredRoleIndex = ROLE_HIERARCHY.indexOf(requiredRole);

        if (userRoleIndex < requiredRoleIndex) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
            });
        }

        next();
    };
};

module.exports = { requireRole };