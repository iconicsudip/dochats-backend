import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import ogs from 'open-graph-scraper';
import { broadcastConversationUpdate, getFormattedConversation, isAgentOnline } from '../utils/sse';

export const initPublicChat = async (req: Request, res: Response) => {
    try {
        const { slug, visitorToken, visitorName, visitorPhone, visitorEmail } = req.body;
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

        let didCreateOrUpdate = false;

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    linkId: link.id,
                    visitorToken: visitorToken,
                    visitorName: visitorName || null,
                    visitorPhone: visitorPhone || null,
                    visitorEmail: visitorEmail || null
                }
            });
            didCreateOrUpdate = true;
        } else if ((visitorName && visitorName !== conversation.visitorName) || (visitorPhone && visitorPhone !== conversation.visitorPhone) || (visitorEmail && visitorEmail !== conversation.visitorEmail)) {
            // Update existing if name/phone/email has changed or wasn't captured before (e.g. tracking tag appended)
            conversation = await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    visitorName: visitorName || conversation.visitorName,
                    visitorPhone: visitorPhone || conversation.visitorPhone,
                    visitorEmail: visitorEmail || conversation.visitorEmail
                }
            });
            didCreateOrUpdate = true;
        }

        if (didCreateOrUpdate) {
            getFormattedConversation(conversation.id).then(formatted => {
                if (formatted) {
                    broadcastConversationUpdate(formatted);
                }
            }).catch(err => console.error('Error broadcasting conversation update on init:', err));
        }
        const isOnline = true;

        res.json({
            conversationId: conversation.id,
            welcomeMessage: link.welcomeMessage,
            title: link.title,
            adminName: link.title,
            adminLogo: link.creator.logoUrl,
            whatsappLink: link.whatsappLink,
            whatsappThreshold: link.whatsappThreshold,
            visitorName: conversation.visitorName,
            visitorPhone: conversation.visitorPhone,
            visitorEmail: conversation.visitorEmail,
            leadCaptureFormId: link.leadCaptureFormId,
            leadCaptureMessage: link.leadCaptureMessage,
            leadCaptureDelay: link.leadCaptureDelay,
            whatsappOnFormSubmit: link.whatsappOnFormSubmit,
            chatBackgroundImage: link.chatBackgroundImage,
            chatDesign: link.chatDesign,
            trackingPixels: link.trackingPixels,
            menuOptions: link.menuOptions || [],
            isOnline
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

export const getUrlPreview = async (req: Request, res: Response) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'Missing url' });
        const { result } = await ogs({ url, timeout: 5000 });
        if (result.success) {
            res.json({
                title: result.ogTitle || result.twitterTitle || null,
                description: result.ogDescription || result.twitterDescription || null,
                image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || null,
                url
            });
        } else {
            res.status(400).json({ error: 'Failed to scrape' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
};
