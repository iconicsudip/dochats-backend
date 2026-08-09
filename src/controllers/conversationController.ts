import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { decryptMessage } from '../lib/encryption';
import { AuthRequest } from '../middleware/auth';
import { Role, MessageType } from '../enums';

export const getConversations = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: User ID missing' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { assignedLinks: { select: { id: true } } }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;

        const whereClause = user.role === Role.SUB_USER
            ? { linkId: { in: user.assignedLinks.map(l => l.id) } }
            : { link: { creatorId: userId } };

        const [conversations, total] = await Promise.all([
            prisma.conversation.findMany({
                where: whereClause,
                include: {
                    link: {
                        select: {
                            title: true,
                            slug: true
                        }
                    },
                    messages: {
                        orderBy: { createdAt: 'desc' }
                    }
                },
                orderBy: { lastMessageAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.conversation.count({ where: whereClause })
        ]);

        // Use any cast to bypass stale/lagging generated types in the environment
        const data = (conversations as any[]).map(c => {
            const lastMsg = c.messages?.[0];
            const visitorMessages = (c.messages || []).filter((m: any) => !m.isFromAdmin);
            const unreadCount = visitorMessages.filter((m: any) => !m.isRead).length;

            let lastMessage = 'No messages yet';
            let lastMessageType = MessageType.TEXT;

            if (lastMsg) {
                lastMessageType = lastMsg.type || MessageType.TEXT;
                if (lastMsg.type === MessageType.AUDIO) {
                    lastMessage = '🎵 Audio Message';
                } else {
                    lastMessage = decryptMessage(lastMsg.content);
                }
            }

            return {
                id: c.id,
                linkId: c.linkId,
                linkTitle: c.link?.title || 'Unknown Link',
                linkSlug: c.link?.slug || '',
                visitorToken: (c.visitorToken || '').substring(0, 8),
                visitorName: c.visitorName || 'Anonymous',
                visitorPhone: c.visitorPhone || 'N/A',
                lastMessage,
                lastMessageType,
                lastMessageAt: c.lastMessageAt,
                unreadCount,
                createdAt: c.createdAt,
                isPinned: !!c.isPinned,
                isArchived: !!c.isArchived
            };
        });

        res.json({
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error('[getConversations Error]:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const downloadLeads = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { assignedLinks: { select: { id: true } } }
        });

        if (!user) return res.status(404).json({ error: 'User not found' });

        const whereClause = user.role === Role.SUB_USER
            ? {
                linkId: { in: user.assignedLinks.map(l => l.id) },
                OR: [{ visitorName: { not: null } }, { visitorPhone: { not: null } }]
            }
            : {
                link: { creatorId: userId },
                OR: [{ visitorName: { not: null } }, { visitorPhone: { not: null } }]
            };

        const conversations = await prisma.conversation.findMany({
            where: whereClause,
            include: {
                link: { select: { title: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const leads = conversations.map(c => ({
            name: c.visitorName || 'Anonymous',
            phone: c.visitorPhone || 'N/A',
            link: c.link.title,
            date: c.createdAt
        }));

        res.json(leads);
    } catch (e) {
        console.error('[downloadLeads Error]:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const togglePinConversation = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { isPinned } = req.body;

        const conversation = await prisma.conversation.update({
            where: { id },
            data: { isPinned: !!isPinned }
        });

        res.json(conversation);
    } catch (err) {
        console.error('togglePinConversation error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const toggleArchiveConversation = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { isArchived } = req.body;

        const conversation = await prisma.conversation.update({
            where: { id },
            data: { isArchived: !!isArchived }
        });

        res.json(conversation);
    } catch (err) {
        console.error('toggleArchiveConversation error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteConversation = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        await prisma.message.deleteMany({
            where: { conversationId: id }
        });

        await prisma.conversation.delete({
            where: { id }
        });

        res.json({ success: true });
    } catch (err) {
        console.error('deleteConversation error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
