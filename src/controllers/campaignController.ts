import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { encryptMessage } from '../lib/encryption';
import { broadcastMessage, getFormattedConversation, broadcastConversationUpdate } from '../utils/sse';

const getTargetConversations = async (userId: string, filters: any) => {
    const { linkId, leadStatus } = filters;
    
    let whereClause: any = {
        link: { creatorId: userId }
    };
    
    if (linkId && linkId !== 'all') {
        whereClause.linkId = linkId;
    }
    
    if (leadStatus && leadStatus !== 'all') {
        const matchingLeads = await prisma.crmLead.findMany({
            where: {
                ownerId: userId,
                status: leadStatus
            },
            select: { phone: true }
        });
        const phones = matchingLeads.map(l => l.phone).filter(Boolean);
        whereClause.visitorPhone = { in: phones };
    }
    
    return prisma.conversation.findMany({
        where: whereClause,
        include: { link: true }
    });
};

export const getCampaigns = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const campaigns = await prisma.broadcastCampaign.findMany({
            where: { creatorId: userId },
            orderBy: { createdAt: 'desc' }
        });

        res.json(campaigns);
    } catch (e) {
        console.error('[getCampaigns error]:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { name, targetFilter, content, mediaUrl } = req.body;
        if (!name || !content) return res.status(400).json({ error: 'Missing name or content' });

        const campaign = await prisma.broadcastCampaign.create({
            data: {
                name,
                targetFilter: targetFilter || {},
                content,
                mediaUrl: mediaUrl || null,
                status: 'PENDING',
                creatorId: userId
            }
        });

        res.status(201).json(campaign);
    } catch (e) {
        console.error('[createCampaign error]:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const sendCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        const campaign = await prisma.broadcastCampaign.findFirst({
            where: { id, creatorId: userId }
        });

        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        if (campaign.status === 'SENT') return res.status(400).json({ error: 'Campaign already executed' });

        res.json({ success: true, message: 'Broadcast execution started in background' });

        // Background execution
        (async () => {
            try {
                const conversations = await getTargetConversations(userId, campaign.targetFilter);
                const encryptedContent = encryptMessage(campaign.content);

                for (const conv of conversations) {
                    const message = await prisma.message.create({
                        data: {
                            conversationId: conv.id,
                            content: encryptedContent,
                            isFromAdmin: true,
                            isRead: false
                        }
                    });

                    await prisma.conversation.update({
                        where: { id: conv.id },
                        data: { lastMessageAt: new Date() }
                    });

                    const newMessage = {
                        ...message,
                        content: campaign.content,
                        replyTo: null
                    };

                    broadcastMessage(conv.id, conv.linkId, conv.link.creatorId, newMessage);
                    const formatted = await getFormattedConversation(conv.id);
                    if (formatted) {
                        broadcastConversationUpdate(formatted);
                    }
                }

                await prisma.broadcastCampaign.update({
                    where: { id: campaign.id },
                    data: { status: 'SENT', sentAt: new Date() }
                });
            } catch (err) {
                console.error('[sendCampaign bg error]:', err);
                await prisma.broadcastCampaign.update({
                    where: { id: campaign.id },
                    data: { status: 'FAILED' }
                });
            }
        })();
    } catch (e) {
        console.error('[sendCampaign error]:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        await prisma.broadcastCampaign.delete({
            where: { id, creatorId: userId }
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[deleteCampaign error]:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
