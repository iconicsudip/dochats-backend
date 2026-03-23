import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const initPublicChat = async (req: Request, res: Response) => {
    try {
        const { slug, visitorToken, visitorName, visitorPhone } = req.body;
        if (!slug || !visitorToken) {
            return res.status(400).json({ error: 'Missing slug or visitorToken' });
        }

        const link = await prisma.shortLink.findUnique({
            where: { slug },
            include: {
                creator: {
                    select: {
                        id: true,
                        name: true,
                        logoUrl: true,
                        username: true,
                        plan: { select: { leadCaptureEnabled: true } }
                    }
                }
            }
        });

        if (!link) {
            return res.status(404).json({ error: 'Link not found' });
        }

        // Check if the admin's subscription is active
        const latestSubscription = await prisma.subscription.findFirst({
            where: { userId: link.creatorId },
            orderBy: { endDate: 'desc' },
            include: { payment: true }
        });

        if (latestSubscription) {
            const now = new Date();
            const isOverdue = latestSubscription.endDate < now;
            const isPaid = latestSubscription.payment?.status === 'PAID';

            if (isOverdue || !isPaid) {
                return res.status(403).json({ error: 'subscription_expired' });
            }
        }

        let conversation = await prisma.conversation.findFirst({
            where: {
                linkId: link.id,
                visitorToken: visitorToken
            }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    linkId: link.id,
                    visitorToken: visitorToken,
                    visitorName: visitorName || null,
                    visitorPhone: visitorPhone || null
                }
            });
        } else if ((visitorName && !conversation.visitorName) || (visitorPhone && !conversation.visitorPhone)) {
            // Update existing if name/phone wasn't captured before but is given now
            conversation = await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    visitorName: visitorName || conversation.visitorName,
                    visitorPhone: visitorPhone || conversation.visitorPhone
                }
            });
        }

        res.json({
            conversationId: conversation.id,
            welcomeMessage: link.welcomeMessage,
            title: link.title,
            adminName: link.creator.name || link.creator.username,
            adminLogo: link.creator.logoUrl,
            whatsappLink: link.whatsappLink,
            whatsappThreshold: link.whatsappThreshold,
            visitorName: conversation.visitorName,
            visitorPhone: conversation.visitorPhone,
            leadCaptureEnabled: link.creator.plan?.leadCaptureEnabled ?? false
        });
    } catch (e) {
        console.error('initPublicChat error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const trackWARedirect = async (req: Request, res: Response) => {
    try {
        const { conversationId } = req.body;
        if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });

        await prisma.conversation.update({
            where: { id: conversationId },
            data: { waRedirected: true }
        });

        res.json({ success: true });
    } catch (e) {
        console.error('trackWARedirect error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPublicPlans = async (req: Request, res: Response) => {
    try {
        const plans = await prisma.plan.findMany({
            where: { isPublic: true },
            orderBy: { order: 'asc' }
        });
        res.json(plans);
    } catch (e) {
        console.error('getPublicPlans error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

