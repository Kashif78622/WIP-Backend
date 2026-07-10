// src/controllers/user.controller.js

const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { getSocket } = require('../config/socket');

// Helper function to emit user events
const emitUserEvent = (event, data, initiatedBy) => {
    const io = getSocket();
    if (io) {
        io.emit(`user:${event}`, {
            ...data,
            initiatedBy: initiatedBy || null,
        });
    }
};

// ==================== PERMISSION DEFINITIONS ====================
const PERMISSIONS = {
    USER_MANAGEMENT: 'user_management',
    SYSTEM_SETTINGS: 'system_settings',
    AUDIT_LOGS: 'audit_logs',
    MASTER_DATA: 'master_data',
    PRODUCTS: 'products',
    BATCH_MANAGEMENT: 'batch_management',
    REPORTS: 'reports',
    SNAPSHOTS: 'snapshots',
    MY_BATCHES: 'my_batches',
    BATCHES: 'batches',
};

// ==================== GET ALL PERMISSIONS ====================
const getPermissions = async (req, res, next) => {
    try {
        const permissions = await prisma.permission.findMany({
            where: { isActive: true },
            orderBy: { category: 'asc' },
        });
        res.json({ success: true, data: permissions });
    } catch (error) {
        next(error);
    }
};

// ==================== GET ALL USERS ====================
const getUsers = async (req, res, next) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            data: users,
            meta: {
                count: users.length,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ==================== GET SINGLE USER ====================
const getUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        next(error);
    }
};

// ==================== CREATE USER ====================
const createUser = async (req, res, next) => {
    try {
        const {
            name,
            email,
            password,
            role,
            permissions,
            assignedAreaIds,
            assignedStageIds,
            assignedMachineIds
        } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Name, email, password and role are required'
                },
            });
        }

        // Check if user is trying to create another super admin
        // Only the seed-created super admin should exist
        if (role === 'ADMIN') {
            const existingSuperAdmin = await prisma.user.findFirst({
                where: { isSuperAdmin: true },
            });

            // If this is the first admin being created and it's not the seed admin
            // Prevent creating another super admin
            if (existingSuperAdmin && req.user?.id !== existingSuperAdmin.id) {
                // Normal admins created by super admin should not be super admins
                // They get permissions assigned by the super admin
            }
        }

        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() },
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'USER_EXISTS',
                    message: 'User with this email already exists'
                },
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Validate permissions - only allow permissions that exist
        let validPermissionKeys = [];
        if (permissions && permissions.length > 0) {
            const validPermissions = await prisma.permission.findMany({
                where: { key: { in: permissions } },
            });
            validPermissionKeys = validPermissions.map(p => p.key);
        }

        // Non-admin users should not be super admin
        const isSuperAdmin = false;

        const user = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.toLowerCase().trim(),
                passwordHash: hashedPassword,
                role: role,
                isActive: true,
                isSuperAdmin: isSuperAdmin,
                permissions: validPermissionKeys,
                assignedAreaIds: assignedAreaIds || [],
                assignedStageIds: assignedStageIds || [],
                assignedMachineIds: assignedMachineIds || [],
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
                createdAt: true,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entity: 'User',
                entityId: user.id,
                changes: {
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    permissions: user.permissions,
                    assignedAreaIds: user.assignedAreaIds,
                    assignedStageIds: user.assignedStageIds,
                    assignedMachineIds: user.assignedMachineIds,
                },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitUserEvent('created', user, req.user.id);

        res.status(201).json({
            success: true,
            data: user,
            message: 'User created successfully',
        });
    } catch (error) {
        next(error);
    }
};

// ==================== UPDATE USER ====================
const updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            name,
            email,
            role,
            isActive,
            password,
            permissions,
            assignedAreaIds,
            assignedStageIds,
            assignedMachineIds,
        } = req.body;

        const existingUser = await prisma.user.findUnique({
            where: { id },
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }

        // Prevent modifying self
        if (id === req.user.id) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'CANNOT_MODIFY_SELF',
                    message: 'You cannot modify your own account'
                },
            });
        }

        // Prevent modifying super admin (only super admin can modify themselves, but they can't)
        if (existingUser.isSuperAdmin === true && req.user.id !== existingUser.id) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'You cannot modify the super admin account'
                },
            });
        }

        // Prevent modifying other admins (only super admin can)
        if (existingUser.role === 'ADMIN' && !req.user.isSuperAdmin) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Only super admin can modify admin accounts'
                },
            });
        }

        if (email && email !== existingUser.email) {
            const emailExists = await prisma.user.findUnique({
                where: { email: email.toLowerCase().trim() },
            });
            if (emailExists) {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'USER_EXISTS',
                        message: 'User with this email already exists'
                    },
                });
            }
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (email) updateData.email = email.toLowerCase().trim();
        if (role) updateData.role = role;
        if (isActive !== undefined && isActive !== null) updateData.isActive = isActive;
        if (password) {
            updateData.passwordHash = await bcrypt.hash(password, 10);
        }
        if (permissions !== undefined) {
            const validPermissions = await prisma.permission.findMany({
                where: { key: { in: permissions || [] } },
            });
            updateData.permissions = validPermissions.map(p => p.key);
        }
        if (assignedAreaIds !== undefined) updateData.assignedAreaIds = assignedAreaIds || [];
        if (assignedStageIds !== undefined) updateData.assignedStageIds = assignedStageIds || [];
        if (assignedMachineIds !== undefined) updateData.assignedMachineIds = assignedMachineIds || [];

        // Prevent removing super admin status
        // Only the seed-created super admin can have isSuperAdmin = true
        if (existingUser.isSuperAdmin === true) {
            // Keep super admin status
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE',
                entity: 'User',
                entityId: user.id,
                changes: { updatedFields: Object.keys(updateData) },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitUserEvent('updated', user, req.user.id);

        res.json({
            success: true,
            data: user,
            message: 'User updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

// ==================== TOGGLE USER STATUS ====================
const toggleUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (isActive === undefined || isActive === null) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'isActive field is required'
                },
            });
        }

        const existingUser = await prisma.user.findUnique({
            where: { id },
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }

        if (id === req.user.id && isActive === false) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'CANNOT_DISABLE_SELF',
                    message: 'You cannot disable your own account'
                },
            });
        }

        // Prevent disabling super admin
        if (existingUser.isSuperAdmin === true) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'You cannot disable the super admin account'
                },
            });
        }

        const user = await prisma.user.update({
            where: { id },
            data: { isActive },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'STATUS_CHANGE',
                entity: 'User',
                entityId: user.id,
                changes: { isActive: user.isActive },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitUserEvent('statusChanged', user, req.user.id);

        res.json({
            success: true,
            data: user,
            message: `User ${isActive ? 'enabled' : 'disabled'} successfully`,
        });
    } catch (error) {
        next(error);
    }
};

// ==================== DELETE USER ====================
const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existingUser = await prisma.user.findUnique({
            where: { id },
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }

        if (id === req.user.id) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'CANNOT_DELETE_SELF',
                    message: 'You cannot delete your own account'
                },
            });
        }

        // Prevent deleting super admin
        if (existingUser.isSuperAdmin === true) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'You cannot delete the super admin account'
                },
            });
        }

        await prisma.user.delete({
            where: { id },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'DELETE',
                entity: 'User',
                entityId: id,
                changes: { deletedUser: existingUser.email },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        emitUserEvent('deleted', { id }, req.user.id);

        res.json({
            success: true,
            message: 'User deleted successfully',
        });
    } catch (error) {
        next(error);
    }
};

// ==================== PROFILE FUNCTIONS ====================

const getProfile = async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        next(error);
    }
};

const updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { name, email, currentPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }

        const updateData = {};

        if (name && name.trim() !== user.name) {
            updateData.name = name.trim();
        }

        if (email && email.toLowerCase().trim() !== user.email) {
            const emailExists = await prisma.user.findUnique({
                where: { email: email.toLowerCase().trim() },
            });
            if (emailExists) {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'EMAIL_EXISTS',
                        message: 'Email already in use',
                        field: 'email',
                    },
                });
            }
            updateData.email = email.toLowerCase().trim();
        }

        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Current password is required to change password',
                        field: 'currentPassword',
                    },
                });
            }

            const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    error: {
                        code: 'INVALID_PASSWORD',
                        message: 'Current password is incorrect',
                        field: 'currentPassword',
                    },
                });
            }

            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Password must be at least 6 characters',
                        field: 'newPassword',
                    },
                });
            }

            updateData.passwordHash = await bcrypt.hash(newPassword, 10);
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'NO_CHANGES',
                    message: 'No changes to update',
                },
            });
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE_PROFILE',
                entity: 'User',
                entityId: userId,
                changes: { updatedFields: Object.keys(updateData) },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        const io = getSocket();
        if (io) {
            io.emit('user:profileUpdated', {
                userId: updatedUser.id,
                ...updatedUser,
                initiatedBy: req.user.id,
            });
        }

        res.json({
            success: true,
            data: updatedUser,
            message: 'Profile updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

const updateAvatar = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { avatar } = req.body;

        if (!avatar) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Avatar data is required',
                },
            });
        }

        const base64Data = avatar.split(',')[1] || avatar;
        const sizeInBytes = Buffer.from(base64Data, 'base64').length;
        if (sizeInBytes > 2 * 1024 * 1024) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Avatar size exceeds 2MB limit',
                    field: 'avatar',
                },
            });
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: { avatar },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
                lastLoginAt: true,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE_AVATAR',
                entity: 'User',
                entityId: userId,
                changes: { avatarUpdated: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        const io = getSocket();
        if (io) {
            io.emit('user:profileUpdated', {
                userId: user.id,
                ...user,
                initiatedBy: req.user.id,
            });
        }

        res.json({
            success: true,
            data: { avatar: user.avatar },
            message: 'Avatar updated successfully',
        });
    } catch (error) {
        next(error);
    }
};

const removeAvatar = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const user = await prisma.user.update({
            where: { id: userId },
            data: { avatar: null },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                isSuperAdmin: true,
                permissions: true,
                assignedAreaIds: true,
                assignedStageIds: true,
                assignedMachineIds: true,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'REMOVE_AVATAR',
                entity: 'User',
                entityId: userId,
                changes: { avatarRemoved: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        const io = getSocket();
        if (io) {
            io.emit('user:profileUpdated', {
                userId: user.id,
                ...user,
                initiatedBy: req.user.id,
            });
        }

        res.json({
            success: true,
            data: { avatar: null },
            message: 'Avatar removed successfully',
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getUsers,
    getUser,
    createUser,
    updateUser,
    toggleUserStatus,
    deleteUser,
    getProfile,
    updateProfile,
    updateAvatar,
    removeAvatar,
    getPermissions,
    PERMISSIONS,
};