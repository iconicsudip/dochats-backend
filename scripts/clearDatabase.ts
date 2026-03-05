import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('⚠️  Clearing all tables in the database...');

    try {
        // Delete in order to respect foreign key constraints
        // 1. Messages (references Conversations)
        await prisma.message.deleteMany();
        console.log('✅ Cleared Messages');

        // 2. Conversations (references ShortLinks)
        await prisma.conversation.deleteMany();
        console.log('✅ Cleared Conversations');

        // 3. ShortLinks (references Users)
        await prisma.shortLink.deleteMany();
        console.log('✅ Cleared ShortLinks');

        // 4. Users (Self-referential parentId)
        // We might need to clear parentId first if there are cycles, 
        // but Prisma deleteMany usually handles top-level deletes well in this schema.
        await prisma.user.deleteMany();
        console.log('✅ Cleared Users');

        console.log('✨ All tables cleared successfully!');
    } catch (error) {
        console.error('❌ Error clearing tables:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
