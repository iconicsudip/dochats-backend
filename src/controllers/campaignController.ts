import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { encryptMessage } from '../lib/encryption';
import { broadcastMessage, getFormattedConversation, broadcastConversationUpdate } from '../utils/sse';

const getTargetConversations = async (ownerId: string, filters: any) => {
    const { linkId, leadStatus } = filters;
    
    let whereClause: any = {
        link: { creatorId: ownerId }
    };
    
    if (linkId && linkId !== 'all') {
        whereClause.linkId = linkId;
    }
    
    if (leadStatus && leadStatus !== 'all') {
        const matchingLeads = await prisma.crmLead.findMany({
            where: {
                ownerId: ownerId,
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
        const ownerId = req.user?.parentId || req.user?.userId;
        if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

        const campaigns = await prisma.broadcastCampaign.findMany({
            where: { creatorId: ownerId },
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
        const ownerId = req.user?.parentId || req.user?.userId;
        if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

        const { name, targetFilter, content, mediaUrl } = req.body;
        if (!name || !content) return res.status(400).json({ error: 'Missing name or content' });

        const campaign = await prisma.broadcastCampaign.create({
            data: {
                name,
                targetFilter: targetFilter || {},
                content,
                mediaUrl: mediaUrl || null,
                status: 'PENDING',
                creatorId: ownerId
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
        const ownerId = req.user?.parentId || req.user?.userId;
        if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        const campaign = await prisma.broadcastCampaign.findFirst({
            where: { id, creatorId: ownerId }
        });

        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        if (campaign.status === 'SENT') return res.status(400).json({ error: 'Campaign already executed' });

        res.json({ success: true, message: 'Broadcast execution started in background' });

        // Background execution
        (async () => {
            try {
                const conversations = await getTargetConversations(ownerId, campaign.targetFilter);
                const encryptedContent = encryptMessage(campaign.content);
                const log: any[] = [];

                for (const conv of conversations) {
                    try {
                        const lead = await prisma.crmLead.findFirst({
                            where: { ownerId, ...(conv.visitorPhone ? { phone: conv.visitorPhone } : {}) }
                        });

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

                        log.push({
                            name: lead?.name || conv.visitorPhone || 'Unknown Visitor',
                            phone: conv.visitorPhone || 'N/A',
                            status: 'SENT',
                            sentAt: new Date()
                        });
                    } catch (itemErr: any) {
                        log.push({
                            name: conv.visitorPhone || 'Unknown Visitor',
                            phone: conv.visitorPhone || 'N/A',
                            status: 'FAILED',
                            error: itemErr.message || 'Failed to dispatch message'
                        });
                    }
                }

                // If filtering by a CRM status, identify leads without active conversations
                const filters = campaign.targetFilter as any;
                if (filters && filters.leadStatus && filters.leadStatus !== 'all') {
                    const matchingLeads = await prisma.crmLead.findMany({
                        where: {
                            ownerId,
                            status: filters.leadStatus
                        }
                    });

                    for (const lead of matchingLeads) {
                        const processed = log.some(item => item.phone === lead.phone);
                        if (!processed) {
                            log.push({
                                name: lead.name || 'Unknown Lead',
                                phone: lead.phone || 'N/A',
                                status: 'FAILED',
                                error: 'No active chat conversation'
                            });
                        }
                    }
                }

                await prisma.broadcastCampaign.update({
                    where: { id: campaign.id },
                    data: { 
                        status: 'SENT', 
                        sentAt: new Date(),
                        recipientsLog: log
                    }
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
        const ownerId = req.user?.parentId || req.user?.userId;
        if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

        const { id } = req.params;
        await prisma.broadcastCampaign.delete({
            where: { id, creatorId: ownerId }
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[deleteCampaign error]:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
