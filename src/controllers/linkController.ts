import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const generateSlug = (): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(8);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
};

const generateUniqueSlug = async (): Promise<string> => {
    for (let i = 0; i < 5; i++) {
        const slug = generateSlug();
        const existing = await prisma.shortLink.findUnique({ where: { slug } });
        if (!existing) return slug;
    }
    throw new Error('Failed to generate a unique slug');
};

export const getAllLinks = async (req: any, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [links, total] = await Promise.all([
            prisma.shortLink.findMany({
                where: { creatorId: req.user.userId },
                include: { _count: { select: { conversations: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.shortLink.count({ where: { creatorId: req.user.userId } })
        ]);

        res.json({
            data: links,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createLink = async (req: any, res: Response) => {
    try {
        const { title, welcomeMessage, whatsappLink, whatsappThreshold } = req.body;
        if (!title) return res.status(400).json({ error: 'Title is required' });

        const slug = await generateUniqueSlug();

        const link = await prisma.shortLink.create({
            data: {
                title,
                slug,
                welcomeMessage,
                whatsappLink,
                whatsappThreshold: whatsappThreshold ? Number(whatsappThreshold) : undefined,
                creatorId: req.user.userId
            }
        });
        res.status(201).json(link);
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateLink = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const { title, welcomeMessage, whatsappLink, whatsappThreshold } = req.body;

        const link = await prisma.shortLink.findUnique({ where: { id } });
        if (!link || link.creatorId !== req.user.userId) return res.status(401).json({ error: 'Unauthorized' });

        const updated = await prisma.shortLink.update({
            where: { id },
            data: {
                title,
                welcomeMessage,
                whatsappLink,
                whatsappThreshold: whatsappThreshold !== undefined ? Number(whatsappThreshold) : undefined
            }
        });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteLink = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const link = await prisma.shortLink.findUnique({ where: { id } });
        if (!link || link.creatorId !== req.user.userId) return res.status(401).json({ error: 'Unauthorized' });

        await prisma.shortLink.delete({ where: { id } });
        res.json({ message: 'Link deleted' });
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const getLinkReports = async (req: any, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [links, total, globalConvs, globalRedirects] = await Promise.all([
            prisma.shortLink.findMany({
                where: { creatorId: req.user.userId },
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    _count: {
                        select: { conversations: true }
                    }
                } as any,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.shortLink.count({ where: { creatorId: req.user.userId } }),
            prisma.conversation.count({
                where: { link: { creatorId: req.user.userId } }
            }),
            prisma.conversation.count({
                where: { link: { creatorId: req.user.userId }, waRedirected: true }
            })
        ]);

        // Get redirect counts per link for the current page
        const redirectCounts = await prisma.conversation.groupBy({
            by: ['linkId'],
            where: {
                linkId: { in: (links as any[]).map(l => l.id) },
                waRedirected: true
            },
            _count: true
        });

        const redirectMap = new Map(redirectCounts.map(c => [c.linkId, c._count]));

        const reportData = (links as any[]).map(link => {
            const totalConversations = link._count.conversations;
            const waRedirects = redirectMap.get(link.id) || 0;
            const conversionRate = totalConversations > 0 ? (waRedirects / totalConversations) * 100 : 0;

            return {
                id: link.id,
                title: link.title,
                slug: link.slug,
                totalConversations,
                waRedirects,
                conversionRate: conversionRate.toFixed(1)
            };
        });

        const globalTotalConversations = globalConvs;
        const globalWaRedirects = globalRedirects;

        res.json({
            data: reportData,
            globalStats: {
                totalConversations: globalTotalConversations,
                waRedirects: globalWaRedirects
            },
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
