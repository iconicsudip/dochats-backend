import { Request, Response } from 'express';
import { verifyToken } from '../utils/auth';
import { prisma } from '../lib/prisma';
import { addSSEClient, removeSSEClient, broadcastTypingEvent } from '../utils/sse';
import crypto from 'crypto';

export const handleSSERealtime = async (req: Request, res: Response) => {
    // 1. Establish SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // to disable proxy buffering in Nginx/Apache
    });
    
    // Send initial comment to establish connection and satisfy browsers/proxies
    res.write(':ok\n\n');

    const connectionId = crypto.randomUUID();
    let clientInfo: any = { id: connectionId, res };

    const token = req.query.token as string;
    const conversationId = req.query.conversationId as string;
    const visitorToken = req.query.visitorToken as string;

    if (token) {
        // Authenticate admin/sub-user
        try {
            const payload = verifyToken(token) as any;
            if (payload && payload.userId) {
                const user = await prisma.user.findUnique({
                    where: { id: payload.userId },
                    include: { assignedLinks: { select: { id: true } } }
                });

                if (user) {
                    clientInfo.userId = user.id;
                    clientInfo.role = user.role;
                    clientInfo.assignedLinkIds = user.assignedLinks.map(l => l.id);
                } else {
                    res.write('event: error\ndata: {"error": "Unauthorized"}\n\n');
                    res.end();
                    return;
                }
            } else {
                res.write('event: error\ndata: {"error": "Unauthorized"}\n\n');
                res.end();
                return;
            }
        } catch (err) {
            res.write('event: error\ndata: {"error": "Unauthorized"}\n\n');
            res.end();
            return;
        }
    } else if (conversationId && visitorToken) {
        // Authenticate visitor
        try {
            const conversation = await prisma.conversation.findFirst({
                where: {
                    id: conversationId,
                    visitorToken: visitorToken
                }
            });

            if (conversation) {
                clientInfo.conversationId = conversation.id;
                clientInfo.visitorToken = conversation.visitorToken;
            } else {
                res.write('event: error\ndata: {"error": "Unauthorized"}\n\n');
                res.end();
                return;
            }
        } catch (err) {
            res.write('event: error\ndata: {"error": "Internal Error"}\n\n');
            res.end();
            return;
        }
    } else {
        // No authentication details provided
        res.write('event: error\ndata: {"error": "Unauthorized"}\n\n');
        res.end();
        return;
    }

    addSSEClient(clientInfo);

    // Setup ping interval to keep connection alive
    const pingInterval = setInterval(() => {
        try {
            res.write(':ping\n\n');
        } catch (err) {
            console.error('[SSE] Failed to send ping, closing connection');
            clearInterval(pingInterval);
            removeSSEClient(connectionId);
        }
    }, 30000);

    req.on('close', () => {
        clearInterval(pingInterval);
        removeSSEClient(connectionId);
    });
};

export const sendTypingStatus = async (req: Request, res: Response) => {
    try {
        const { conversationId, isTyping, isFromAdmin } = req.body;
        if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });

        const conv = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { link: true }
        });
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        broadcastTypingEvent(conversationId, conv.linkId, conv.link.creatorId, !!isTyping, !!isFromAdmin);
        res.json({ success: true });
    } catch (e) {
        console.error('sendTypingStatus error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
