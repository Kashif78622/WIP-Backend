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

// ==================== EXISTING FUNCTIONS ====================

// Get all users
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

// Get single user
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

// Create new user
const createUser = async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Name, email, password and role are required'
                },
            });
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

        const user = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.toLowerCase().trim(),
                passwordHash: hashedPassword,
                role: role,
                isActive: true,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                avatar: true,
                createdAt: true,
            },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entity: 'User',
                entityId: user.id,
                changes: { name: user.name, email: user.email, role: user.role },
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

// Update user
const updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, email, role, isActive, password } = req.body;

        const existingUser = await prisma.user.findUnique({
            where: { id },
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'User not found' },
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

// Toggle user status
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

// Delete user
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

// Get current user profile
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

// Update profile (name, email, password)
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

        // Update name if provided
        if (name && name.trim() !== user.name) {
            updateData.name = name.trim();
        }

        // Update email if provided and changed
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

        // Update password if provided
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
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        // Log audit
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

        // Emit socket event for profile update
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

// Update avatar
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

        // Validate avatar size (max 2MB)
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
                lastLoginAt: true,
            },
        });

        // Log audit
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

        // Emit socket event
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

// Remove avatar
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
            },
        });

        // Log audit
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

        // Emit socket event
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
};