const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const links = await prisma.shortLink.findMany();
    console.dir(links.map(l => ({ slug: l.slug, chatDesign: l.chatDesign })), { depth: null });
}
main().catch(console.error).finally(() => prisma.$disconnect());
