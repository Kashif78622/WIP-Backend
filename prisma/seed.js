// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    try {
        const hashedPassword = await bcrypt.hash('password123', 10);

        // Create Admin User
        const admin = await prisma.user.create({
            data: {
                name: 'Ayesha Zafar',
                email: 'ayesha.zafar@neonweb.pk',
                passwordHash: hashedPassword,
                role: 'ADMIN',
            },
        });
        console.log(`✅ Created admin: ${admin.email}`);

        // Create Supervisor
        const supervisor = await prisma.user.create({
            data: {
                name: 'Bilal Ahmed',
                email: 'bilal.ahmed@neonweb.pk',
                passwordHash: hashedPassword,
                role: 'SUPERVISOR',
            },
        });
        console.log(`✅ Created supervisor: ${supervisor.email}`);

        // Create Operator
        const operator = await prisma.user.create({
            data: {
                name: 'Zara Khan',
                email: 'zara.khan@neonweb.pk',
                passwordHash: hashedPassword,
                role: 'OPERATOR',
            },
        });
        console.log(`✅ Created operator: ${operator.email}`);

        // Create Area
        const area = await prisma.area.create({
            data: {
                name: 'Production Area',
                code: 'PROD',
            },
        });
        console.log(`✅ Created area: ${area.name}`);

        // Create Stages
        const stagesData = [
            { name: 'Wet Granulation', sequence: 1 },
            { name: 'Dry Granulation', sequence: 2 },
            { name: 'Compression', sequence: 3 },
            { name: 'Coating', sequence: 4 },
            { name: 'Semi-Solid', sequence: 5 },
            { name: 'Encapsulation', sequence: 6 },
            { name: 'Sachet', sequence: 7 },
        ];

        const stages = [];
        for (const stageData of stagesData) {
            const stage = await prisma.stage.create({
                data: {
                    ...stageData,
                    areaId: area.id,
                },
            });
            stages.push(stage);
            console.log(`✅ Created stage: ${stage.name}`);
        }

        // Create Machines
        const machinesData = {
            'Wet Granulation': ['FBD-300', 'FBD-120', 'FBD-Nano'],
            'Dry Granulation': ['Sifting Area', 'Compactor 400/100', 'F-Mix-05'],
            Compression: ['RP-07', 'RP-08', 'RP-09', 'RP-11', 'RP-13'],
            Coating: ['Coat-170', 'Coat-150', 'Nano-Coater'],
            'Semi-Solid': ['Mmog9', 'Kentex Fill-08', 'Bicomix', 'Kentex Fill-07'],
            Encapsulation: ['New Bosch', 'Old Bosch', 'Chinyi'],
            Sachet: ['Sachet Line'],
        };

        for (const [stageName, machines] of Object.entries(machinesData)) {
            const stage = stages.find(s => s.name === stageName);
            if (!stage) continue;

            for (let i = 0; i < machines.length; i++) {
                await prisma.machine.create({
                    data: {
                        name: machines[i],
                        stageId: stage.id,
                        sequence: i + 1,
                        status: 'IDLE',
                    },
                });
            }
            console.log(`✅ Created ${machines.length} machines for ${stageName}`);
        }

        // Create Products
        const products = [
            { name: 'Empagar Trio 125/25/1000', code: 'EMP-001' },
            { name: 'Novadol XR 500mg', code: 'NOV-001' },
            { name: 'Ferronex Forte 20/40', code: 'FER-001' },
            { name: 'Capsuline B-12', code: 'CAP-001' },
            { name: 'Rexadyne SR 200', code: 'REX-001' },
            { name: 'Vitazon Chewable', code: 'VIT-001' },
        ];

        for (const product of products) {
            await prisma.product.create({
                data: product,
            });
        }
        console.log(`✅ Created ${products.length} products`);

        console.log('🌱 Seeding complete!');
    } catch (error) {
        console.error('❌ Seeding error:', error);
        throw error;
    }
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });