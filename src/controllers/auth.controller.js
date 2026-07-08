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

        // Generate a long-lived access token so the user remains signed in without refresh tokens
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_ACCESS_SECRET,
            { expiresIn: process.env.JWT_ACCESS_EXPIRY || '365d' }
        );

        const lastLoginAt = new Date();
        await prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken: null,
                lastLoginAt,
            },
        });

        emitUserLogin(user.id, lastLoginAt.toISOString());

        // Remove sensitive data
        const { passwordHash, refreshToken: _refreshToken, ...userData } = user;

        res.json({
            success: true,
            data: {
                user: userData,
                accessToken,
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
        return res.status(410).json({
            success: false,
            error: {
                code: 'REFRESH_DISABLED',
                message: 'Refresh tokens are disabled. Please sign in again if your session expires.'
            },
        });
    } catch (error) {
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