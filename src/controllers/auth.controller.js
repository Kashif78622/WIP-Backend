// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { getSocket } = require('../config/socket');

const emitUserLogin = (userId, lastLoginAt) => {
    const io = getSocket();
    if (io) {
        io.emit('user:loginUpdated', { id: userId, lastLoginAt });
    }
};

const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Email and password are required'
                },
            });
        }

        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() },
        });

        // Check if user exists
        if (!user) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_CREDENTIALS',
                    message: 'User not found. Please check your email address.',
                    field: 'email',
                    title: 'Login Failed'
                },
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'ACCOUNT_INACTIVE',
                    message: 'Your account is inactive. Please contact your administrator.',
                    field: 'general',
                    title: 'Account Inactive'
                },
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_CREDENTIALS',
                    message: 'Incorrect password. Please try again.',
                    field: 'password',
                    title: 'Login Failed'
                },
            });
        }

        // Generate tokens
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_ACCESS_SECRET,
            { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
        );

        const refreshToken = jwt.sign(
            { userId: user.id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: process.env.JWT_REFRESH_EXPIRY || '24h' }
        );

        const lastLoginAt = new Date();
        await prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken,
                lastLoginAt,
            },
        });

        emitUserLogin(user.id, lastLoginAt.toISOString());

        // Remove sensitive data
        const { passwordHash, refreshToken: _, ...userData } = user;

        res.json({
            success: true,
            data: {
                user: userData,
                accessToken,
                refreshToken,
            },
        });
    } catch (error) {
        next(error);
    }
};

const getMe = (req, res) => {
    res.json({
        success: true,
        data: req.user,
    });
};

const refresh = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_TOKEN',
                    message: 'Refresh token is required'
                },
            });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

        const user = await prisma.user.findFirst({
            where: {
                id: decoded.userId,
                refreshToken: refreshToken,
                isActive: true,
            },
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_TOKEN',
                    message: 'Invalid refresh token'
                },
            });
        }

        const newAccessToken = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_ACCESS_SECRET,
            { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
        );

        res.json({
            success: true,
            data: { accessToken: newAccessToken },
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_TOKEN',
                    message: 'Invalid or expired refresh token'
                },
            });
        }
        next(error);
    }
};

const logout = async (req, res) => {
    try {
        await prisma.user.update({
            where: { id: req.user.id },
            data: { refreshToken: null },
        });
        res.json({
            success: true,
            data: { message: 'Logged out successfully' },
        });
    } catch (error) {
        res.json({
            success: true,
            data: { message: 'Logged out successfully' },
        });
    }
};

module.exports = {
    login,
    getMe,
    refresh,
    logout,
};