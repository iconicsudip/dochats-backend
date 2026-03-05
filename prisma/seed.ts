import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    const superAdminUsername = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'admin123';

    // Check if Super Admin already exists
    const existingSuperAdmin = await prisma.user.findUnique({
        where: { username: superAdminUsername },
    });

    if (!existingSuperAdmin) {
        const hashedPassword = await bcrypt.hash(superAdminPassword, 10);
        await prisma.user.create({
            data: {
                username: superAdminUsername,
                password: hashedPassword,
                role: 'SUPER_ADMIN',
            },
        });
        console.log(`✅ Super Admin created: ${superAdminUsername}`);
    } else {
        console.log('ℹ️ Super Admin already exists, skipping creation.');
    }

    console.log('✨ Seeding complete!');
}

main()
    .catch((e) => {
        console.error('❌ Error during seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
