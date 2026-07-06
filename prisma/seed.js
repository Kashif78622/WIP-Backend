// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

// Default system settings
const DEFAULT_SETTINGS = [
    {
        key: 'site_name',
        value: JSON.stringify('WIP Tracking System'),
        category: 'general',
        description: 'The name of the site displayed in the header and title',
    },
    {
        key: 'site_description',
        value: JSON.stringify('Real-Time Work-In-Progress Management'),
        category: 'general',
        description: 'The site description used for SEO and meta tags',
    },
    {
        key: 'timezone',
        value: JSON.stringify('Asia/Karachi'),
        category: 'general',
        description: 'Default timezone for the application',
    },
    {
        key: 'date_format',
        value: JSON.stringify('DD/MM/YYYY'),
        category: 'general',
        description: 'Date format used throughout the application',
    },
    {
        key: 'time_format',
        value: JSON.stringify('24h'),
        category: 'general',
        description: 'Time format (12h or 24h)',
    },
    {
        key: 'branding_logo',
        value: JSON.stringify(null),
        category: 'branding',
        description: 'Base64 encoded logo image',
    },
    {
        key: 'branding_favicon',
        value: JSON.stringify(null),
        category: 'branding',
        description: 'Base64 encoded favicon image',
    },
];

async function main() {
    console.log('🌱 Starting database seed...');
    console.log('='.repeat(50));

    try {
        // ============================================
        // 1. Create Admin User
        // ============================================
        console.log('\n📋 Creating admin user...');

        const existingAdmin = await prisma.user.findUnique({
            where: { email: 'admin@gmail.com' },
        });

        if (existingAdmin) {
            console.log('✅ Admin user already exists:');
            console.log(`   Email: ${existingAdmin.email}`);
            console.log(`   Role: ${existingAdmin.role}`);
        } else {
            const hashedPassword = await bcrypt.hash('Admin@123', 10);

            const admin = await prisma.user.create({
                data: {
                    name: 'Admin User',
                    email: 'admin@gmail.com',
                    passwordHash: hashedPassword,
                    role: 'ADMIN',
                    isActive: true,
                },
            });

            console.log('✅ Admin user created successfully:');
            console.log(`   Email: ${admin.email}`);
            console.log(`   Password: Admin@123`);
            console.log(`   Role: ${admin.role}`);
        }

        // ============================================
        // 2. Create Default System Settings
        // ============================================
        console.log('\n📋 Creating default system settings...');

        let settingsCreated = 0;
        let settingsSkipped = 0;

        for (const setting of DEFAULT_SETTINGS) {
            try {
                const existingSetting = await prisma.systemSetting.findUnique({
                    where: { key: setting.key },
                });

                if (!existingSetting) {
                    await prisma.systemSetting.create({
                        data: setting,
                    });
                    settingsCreated++;
                    console.log(`   ✅ Created: ${setting.key}`);
                } else {
                    settingsSkipped++;
                    console.log(`   ⏭️  Skipped (already exists): ${setting.key}`);
                }
            } catch (error) {
                console.error(`   ❌ Error creating setting ${setting.key}:`, error.message);
            }
        }

        console.log(`\n📊 Settings summary:`);
        console.log(`   Created: ${settingsCreated}`);
        console.log(`   Skipped: ${settingsSkipped}`);
        console.log(`   Total: ${DEFAULT_SETTINGS.length}`);

        console.log('\n' + '='.repeat(50));
        console.log('🌱 Seed completed successfully!');
        console.log('\n📝 Login Credentials:');
        console.log(`   Email: admin@gmail.com`);
        console.log(`   Password: Admin@123`);
        console.log(`   Role: ADMIN`);

    } catch (error) {
        console.error('\n❌ Seeding failed:', error.message);
        throw error;
    }
}

main()
    .catch((e) => {
        console.error('❌ Seeding process failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        console.log('\n🔌 Database connection closed.');
    });