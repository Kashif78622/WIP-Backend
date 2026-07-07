// src/controllers/user.controller.js - Add Socket.IO emits

const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { getSocket } = require('../config/socket'); // Import socket helper

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

module.exports = {
    getUsers,
    getUser,
    createUser,
    updateUser,
    toggleUserStatus,
    deleteUser,
};