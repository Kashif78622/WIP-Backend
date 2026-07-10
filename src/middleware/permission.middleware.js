// src/middleware/permission.middleware.js

const prisma = require('../config/database');

/**
 * Middleware to check if user has a specific permission
 * Super Admin has all permissions by default
 */
const requirePermission = (permissionKey) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            });
        }

        // Super Admin has all permissions
        if (req.user.isSuperAdmin === true) {
            return next();
        }

        // Check if user has the required permission
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { permissions: true },
        });

        if (!user || !user.permissions.includes(permissionKey)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'You do not have permission to perform this action',
                    permission: permissionKey,
                },
            });
        }

        next();
    };
};

/**
 * Check if user has any of the given permissions
 */
const requireAnyPermission = (permissionKeys) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            });
        }

        // Super Admin has all permissions
        if (req.user.isSuperAdmin === true) {
            return next();
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { permissions: true },
        });

        if (!user) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'User not found' },
            });
        }

        const hasPermission = permissionKeys.some(key => user.permissions.includes(key));

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'You do not have permission to perform this action',
                    requiredPermissions: permissionKeys,
                },
            });
        }

        next();
    };
};

/**
 * Middleware to get user's assigned resources
 */
const getUserAssignments = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
    }

    // Super Admin has all assignments (no filtering)
    if (req.user.isSuperAdmin === true) {
        req.userAssignments = {
            areaIds: [],
            stageIds: [],
            machineIds: [],
            role: req.user.role,
            isSuperAdmin: true,
        };
        return next();
    }

    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
            assignedAreaIds: true,
            assignedStageIds: true,
            assignedMachineIds: true,
            role: true,
        },
    });

    req.userAssignments = {
        areaIds: user.assignedAreaIds || [],
        stageIds: user.assignedStageIds || [],
        machineIds: user.assignedMachineIds || [],
        role: user.role,
        isSuperAdmin: false,
    };

    next();
};

/**
 * Filter query to only show assigned resources
 */
const filterByAssignments = (req, model) => {
    const { areaIds, stageIds, machineIds, role, isSuperAdmin } = req.userAssignments || {};

    // Super Admin sees everything
    if (isSuperAdmin) return {};

    switch (model) {
        case 'Area':
            return areaIds.length > 0 ? { id: { in: areaIds } } : { id: { in: [] } };
        case 'Stage':
            return stageIds.length > 0 ? { id: { in: stageIds } } : { id: { in: [] } };
        case 'Machine':
            return machineIds.length > 0 ? { id: { in: machineIds } } : { id: { in: [] } };
        default:
            return {};
    }
};

module.exports = {
    requirePermission,
    requireAnyPermission,
    getUserAssignments,
    filterByAssignments,
};