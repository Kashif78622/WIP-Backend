// src/controllers/settings.controller.js
const prisma = require('../config/database');

// Default settings
const DEFAULT_SETTINGS = {
    site_name: 'WIP Tracking System',
    site_description: 'Real-Time Work-In-Progress Management',
    timezone: 'Asia/Karachi',
    date_format: 'DD/MM/YYYY',
    time_format: '24h',
    branding_logo: null,
    branding_favicon: null,
    notification_enabled: true,
    notification_sound: true,
    security_session_timeout: 3600,
    security_max_login_attempts: 5,
    integration_api_enabled: false,
    maintenance_mode: false,
    default_language: 'en',
};

// Get all settings
const getSettings = async (req, res, next) => {
    try {
        const { category } = req.query;
        const where = category ? { category } : {};

        const settings = await prisma.systemSetting.findMany({
            where,
            orderBy: { key: 'asc' },
        });

        // Convert to key-value object
        const settingsObject = settings.reduce((acc, setting) => {
            try {
                // Parse the value if it's a string, otherwise use as is
                acc[setting.key] = setting.value !== null && typeof setting.value === 'string'
                    ? JSON.parse(setting.value)
                    : setting.value;
            } catch (e) {
                // If parsing fails, use the raw value
                acc[setting.key] = setting.value;
            }
            return acc;
        }, {});

        res.json({
            success: true,
            data: settingsObject,
            meta: {
                count: settings.length,
                category: category || 'all',
            },
        });
    } catch (error) {
        next(error);
    }
};

// Get single setting
const getSetting = async (req, res, next) => {
    try {
        const { key } = req.params;

        const setting = await prisma.systemSetting.findUnique({
            where: { key },
        });

        if (!setting) {
            if (DEFAULT_SETTINGS[key] !== undefined) {
                return res.json({
                    success: true,
                    data: {
                        key,
                        value: DEFAULT_SETTINGS[key],
                        isDefault: true,
                    },
                });
            }
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: `Setting '${key}' not found` },
            });
        }

        let value;
        try {
            value = setting.value !== null && typeof setting.value === 'string'
                ? JSON.parse(setting.value)
                : setting.value;
        } catch (e) {
            value = setting.value;
        }

        res.json({
            success: true,
            data: {
                key: setting.key,
                value,
                description: setting.description,
                category: setting.category,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Create or update settings (bulk)
const upsertSettings = async (req, res, next) => {
    try {
        const { settings } = req.body;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Settings object is required' },
            });
        }

        const results = [];
        const operations = [];

        for (const [key, value] of Object.entries(settings)) {
            // Skip if value is null or undefined
            if (value === null || value === undefined) continue;

            // Determine category
            let category = 'general';
            if (key.startsWith('branding_')) category = 'branding';
            else if (key.startsWith('notification_')) category = 'notification';
            else if (key.startsWith('security_')) category = 'security';
            else if (key.startsWith('integration_')) category = 'integration';

            // Store as JSON string, but preserve the actual value
            const valueToStore = JSON.stringify(value);

            operations.push(
                prisma.systemSetting.upsert({
                    where: { key },
                    update: {
                        value: valueToStore,
                        category,
                        updatedAt: new Date(),
                    },
                    create: {
                        key,
                        value: valueToStore,
                        category,
                        description: `Setting for ${key}`,
                    },
                })
            );
        }

        const updatedSettings = await prisma.$transaction(operations);

        // Log audit
        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE',
                entity: 'SystemSettings',
                changes: { updatedKeys: Object.keys(settings) },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        // Convert response to key-value format
        const responseObject = updatedSettings.reduce((acc, setting) => {
            try {
                acc[setting.key] = setting.value !== null && typeof setting.value === 'string'
                    ? JSON.parse(setting.value)
                    : setting.value;
            } catch (e) {
                acc[setting.key] = setting.value;
            }
            return acc;
        }, {});

        res.json({
            success: true,
            data: responseObject,
            message: `Updated ${Object.keys(settings).length} settings successfully`,
        });
    } catch (error) {
        next(error);
    }
};

// Update single setting
const updateSetting = async (req, res, next) => {
    try {
        const { key } = req.params;
        const { value, description } = req.body;

        if (value === undefined || value === null) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Value is required' },
            });
        }

        let category = 'general';
        if (key.startsWith('branding_')) category = 'branding';
        else if (key.startsWith('notification_')) category = 'notification';
        else if (key.startsWith('security_')) category = 'security';
        else if (key.startsWith('integration_')) category = 'integration';

        const valueToStore = JSON.stringify(value);

        const setting = await prisma.systemSetting.upsert({
            where: { key },
            update: {
                value: valueToStore,
                description: description || undefined,
                category,
                updatedAt: new Date(),
            },
            create: {
                key,
                value: valueToStore,
                description: description || `Setting for ${key}`,
                category,
            },
        });

        // Log audit
        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'UPDATE',
                entity: 'SystemSetting',
                entityId: setting.id,
                changes: { key, value },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        let parsedValue;
        try {
            parsedValue = setting.value !== null && typeof setting.value === 'string'
                ? JSON.parse(setting.value)
                : setting.value;
        } catch (e) {
            parsedValue = setting.value;
        }

        res.json({
            success: true,
            data: {
                key: setting.key,
                value: parsedValue,
                description: setting.description,
                category: setting.category,
            },
            message: `Setting '${key}' updated successfully`,
        });
    } catch (error) {
        next(error);
    }
};

// Delete setting
const deleteSetting = async (req, res, next) => {
    try {
        const { key } = req.params;

        if (DEFAULT_SETTINGS[key] !== undefined) {
            const valueToStore = JSON.stringify(DEFAULT_SETTINGS[key]);

            const setting = await prisma.systemSetting.upsert({
                where: { key },
                update: {
                    value: valueToStore,
                    updatedAt: new Date(),
                },
                create: {
                    key,
                    value: valueToStore,
                    category: 'general',
                    description: `Default setting for ${key}`,
                },
            });

            return res.json({
                success: true,
                message: `Setting '${key}' reset to default value`,
            });
        }

        const setting = await prisma.systemSetting.delete({
            where: { key },
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'DELETE',
                entity: 'SystemSetting',
                entityId: setting.id,
                changes: { deletedKey: key },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        res.json({
            success: true,
            message: `Setting '${key}' deleted successfully`,
        });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: `Setting '${key}' not found` },
            });
        }
        next(error);
    }
};

// Reset all settings
const resetSettings = async (req, res, next) => {
    try {
        // Delete all existing settings
        await prisma.systemSetting.deleteMany({});

        // Create default settings
        const operations = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => {
            let category = 'general';
            if (key.startsWith('branding_')) category = 'branding';
            else if (key.startsWith('notification_')) category = 'notification';
            else if (key.startsWith('security_')) category = 'security';
            else if (key.startsWith('integration_')) category = 'integration';

            const valueToStore = JSON.stringify(value);

            return prisma.systemSetting.create({
                data: {
                    key,
                    value: valueToStore,
                    category,
                    description: `Default setting for ${key}`,
                },
            });
        });

        await prisma.$transaction(operations);

        // Log audit
        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'RESET',
                entity: 'SystemSettings',
                changes: { reset: true },
                ip: req.ip,
                userAgent: req.get('user-agent'),
            },
        });

        res.json({
            success: true,
            message: 'All settings reset to defaults',
            data: DEFAULT_SETTINGS,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSettings,
    getSetting,
    upsertSettings,
    updateSetting,
    deleteSetting,
    resetSettings,
};