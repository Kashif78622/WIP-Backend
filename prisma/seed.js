// prisma/seed.js

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting database seed...');
    console.log('==================================================\n');

    // ==================== PERMISSIONS ====================
    console.log('📋 Creating permissions...');

    const permissions = [
        { key: 'user_management', label: 'User Management', description: 'Manage users and roles', category: 'admin' },
        { key: 'system_settings', label: 'System Settings', description: 'Configure system settings', category: 'admin' },
        { key: 'audit_logs', label: 'Audit Logs', description: 'View audit trail', category: 'admin' },
        { key: 'master_data', label: 'Master Data', description: 'Manage areas, stages, machines', category: 'admin' },
        { key: 'products', label: 'Products', description: 'Manage products', category: 'management' },
        { key: 'batch_management', label: 'Batch Management', description: 'Manage all batches', category: 'supervisor' },
        { key: 'reports', label: 'Reports', description: 'Generate reports', category: 'management' },
        { key: 'snapshots', label: 'Snapshots', description: 'Take and view snapshots', category: 'supervisor' },
        { key: 'my_batches', label: 'My Batches', description: 'View own batches', category: 'operator' },
        { key: 'batches', label: 'Batches', description: 'View all batches', category: 'viewer' },
    ];

    let permissionsCreated = 0;
    let permissionsSkipped = 0;

    const allPermissionKeys = permissions.map(p => p.key);

    for (const p of permissions) {
        try {
            const existing = await prisma.permission.findUnique({
                where: { key: p.key },
            });
            if (existing) {
                permissionsSkipped++;
            } else {
                await prisma.permission.create({
                    data: p,
                });
                permissionsCreated++;
            }
        } catch (error) {
            console.error(`   ❌ Failed to create permission ${p.key}:`, error.message);
        }
    }

    console.log(`   ✅ Created: ${permissionsCreated}`);
    console.log(`   ⏭️  Skipped: ${permissionsSkipped}`);
    console.log(`   Total: ${permissions.length}\n`);

    // ==================== SUPER ADMIN USER ====================
    console.log('📋 Creating Super Admin user...');

    const adminEmail = 'admin@gmail.com';
    const adminPassword = 'Admin@123';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    let superAdmin;
    try {
        // Check if super admin exists
        const existingAdmin = await prisma.user.findUnique({
            where: { email: adminEmail },
        });

        if (existingAdmin) {
            // Update existing admin to be super admin with all permissions
            superAdmin = await prisma.user.update({
                where: { email: adminEmail },
                data: {
                    isSuperAdmin: true,
                    permissions: allPermissionKeys,
                    role: 'ADMIN',
                    isActive: true,
                },
            });
            console.log(`✅ Super Admin updated: ${superAdmin.email}`);
        } else {
            // Create new super admin
            superAdmin = await prisma.user.create({
                data: {
                    name: 'System Administrator',
                    email: adminEmail,
                    passwordHash: hashedPassword,
                    role: 'ADMIN',
                    isActive: true,
                    isSuperAdmin: true,
                    permissions: allPermissionKeys,
                },
            });
            console.log(`✅ Super Admin created: ${superAdmin.email}`);
        }
        console.log(`   Role: ${superAdmin.role}`);
        console.log(`   Is Super Admin: ${superAdmin.isSuperAdmin}`);
        console.log(`   Permissions: ${superAdmin.permissions?.length || 0}\n`);
    } catch (error) {
        console.error('❌ Failed to create super admin:', error.message);
    }

    // ==================== SYSTEM SETTINGS ====================
    console.log('📋 Creating default system settings...');

    const settings = [
        { key: 'site_name', value: JSON.stringify('WIP Tracking System'), category: 'general', description: 'Site name' },
        { key: 'site_description', value: JSON.stringify('Real-Time Work-In-Progress Management'), category: 'general', description: 'Site description' },
        { key: 'timezone', value: JSON.stringify('Asia/Karachi'), category: 'general', description: 'Default timezone' },
        { key: 'date_format', value: JSON.stringify('DD/MM/YYYY'), category: 'general', description: 'Date format' },
        { key: 'time_format', value: JSON.stringify('24h'), category: 'general', description: 'Time format' },
        { key: 'branding_logo', value: null, category: 'branding', description: 'Logo image' },
        { key: 'branding_favicon', value: null, category: 'branding', description: 'Favicon image' },
        { key: 'notification_enabled', value: JSON.stringify(true), category: 'notification', description: 'Enable notifications' },
        { key: 'notification_sound', value: JSON.stringify(true), category: 'notification', description: 'Enable notification sounds' },
        { key: 'security_session_timeout', value: JSON.stringify(3600), category: 'security', description: 'Session timeout in seconds' },
        { key: 'security_max_login_attempts', value: JSON.stringify(5), category: 'security', description: 'Max login attempts' },
        { key: 'maintenance_mode', value: JSON.stringify(false), category: 'system', description: 'Maintenance mode' },
        { key: 'default_language', value: JSON.stringify('en'), category: 'system', description: 'Default language' },
    ];

    let settingsCreated = 0;
    let settingsSkipped = 0;

    for (const s of settings) {
        try {
            const existing = await prisma.systemSetting.findUnique({
                where: { key: s.key },
            });
            if (existing) {
                settingsSkipped++;
            } else {
                await prisma.systemSetting.create({
                    data: s,
                });
                settingsCreated++;
            }
        } catch (error) {
            console.error(`   ❌ Failed to create setting ${s.key}:`, error.message);
        }
    }

    console.log(`   ✅ Created: ${settingsCreated}`);
    console.log(`   ⏭️  Skipped: ${settingsSkipped}`);
    console.log(`   Total: ${settings.length}\n`);

    // ==================== SUMMARY ====================
    console.log('==================================================');
    console.log('🌱 Seed completed successfully!');
    console.log('\n📝 Login Credentials:');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log(`   Role: ADMIN (Super Admin)\n`);

    console.log('📋 Available Permissions:');
    permissions.forEach(p => {
        console.log(`   - ${p.label} (${p.key}) [${p.category}]`);
    });
    console.log('\n');

    console.log('🔌 Database connection closed.');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });