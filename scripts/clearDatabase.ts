import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('⚠️  Clearing all tables in the database...');

    try {
        // Delete in order to respect foreign key constraints

        // 1. Messages (references Conversations and itself)
        await prisma.message.deleteMany();
        console.log('✅ Cleared Messages');

        // 2. Conversations (references ShortLinks)
        await prisma.conversation.deleteMany();
        console.log('✅ Cleared Conversations');

        // 3. Payments (references Subscription)
        await prisma.payment.deleteMany();
        console.log('✅ Cleared Payments');

        // 4. Subscriptions (references User)
        await prisma.subscription.deleteMany();
        console.log('✅ Cleared Subscriptions');

        // 5. ShortLinks (references User)
        await prisma.shortLink.deleteMany();
        console.log('✅ Cleared ShortLinks');

        // 6. PlanUpgradeRequests (references User and Plan)
        await prisma.planUpgradeRequest.deleteMany();
        console.log('✅ Cleared PlanUpgradeRequests');

        // 7. Users (Self-referential parentId)
        // We first clear the parentId relationship to avoid fk issues on self-relation
        await prisma.user.updateMany({
            data: { parentId: null }
        });
        await prisma.user.deleteMany();
        console.log('✅ Cleared Users');

        // 8. Plans
        await prisma.plan.deleteMany();
        console.log('✅ Cleared Plans');

        console.log('✨ All tables cleared successfully!');
    } catch (error) {
        console.error('❌ Error clearing tables:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
