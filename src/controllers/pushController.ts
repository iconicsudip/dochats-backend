import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getVapidPublicKey = (req: Request, res: Response) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
        return res.status(500).json({ error: 'VAPID public key not configured' });
    }
    res.json({ publicKey });
};

export const subscribe = async (req: Request, res: Response) => {
    try {
        const { subscription, conversationId } = req.body;
        
        if (!subscription || !conversationId) {
            return res.status(400).json({ error: 'Missing subscription or conversationId' });
        }

        const endpoint = subscription.endpoint;
        const auth = subscription.keys?.auth;
        const p256dh = subscription.keys?.p256dh;

        if (!endpoint || !auth || !p256dh) {
            return res.status(400).json({ error: 'Invalid subscription object' });
        }

        // Check if conversation exists
        const conv = await prisma.conversation.findUnique({
            where: { id: conversationId }
        });

        if (!conv) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        // Upsert the subscription
        await prisma.pushSubscription.upsert({
            where: { conversationId },
            update: {
                endpoint,
                auth,
                p256dh,
            },
            create: {
                conversationId,
                endpoint,
                auth,
                p256dh
            }
        });

        res.status(201).json({ success: true, message: 'Subscription saved' });
    } catch (error) {
        console.error('Error saving push subscription:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
