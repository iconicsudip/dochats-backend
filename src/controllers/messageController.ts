import { Request, Response } from 'express';
import { MessageType } from '../enums';
import { encryptMessage, decryptMessage } from '../lib/encryption';
import ogs from 'open-graph-scraper';
import { getIO } from '../socket';
import { prisma } from '../lib/prisma';

const extractUrl = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex)?.[0];
};

export const getMessages = async (req: Request, res: Response) => {
    try {
        const { conversationId, limit, cursor } = req.query;
        if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });

        const rawMessages = await prisma.message.findMany({
            where: { conversationId: conversationId as string },
            take: Number(limit) || 40,
            ...(cursor ? { skip: 1, cursor: { id: cursor as string } } : {}),
            orderBy: { createdAt: 'desc' },
            include: { replyTo: true }
        });

        const messages = rawMessages.map((m) => {
            let decryptedContent = m.content;
            try { decryptedContent = decryptMessage(m.content); } catch (err) { }

            let decryptedReplyContent = m.replyTo?.content;
            if (m.replyTo?.content) {
                try { decryptedReplyContent = decryptMessage(m.replyTo.content); } catch (e) { }
            }

            return {
                ...m,
                content: decryptedContent,
                replyTo: m.replyTo ? { ...m.replyTo, content: decryptedReplyContent } : null
            };
        }).reverse();

        res.json(messages);
    } catch (e: any) {
        console.error('getMessages error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const sendMessage = async (req: Request, res: Response) => {
    try {
        const { conversationId, content, isFromAdmin, tempId, type = MessageType.TEXT, replyToId } = req.body;
        if (!conversationId || !content) return res.status(400).json({ error: 'Missing data' });

        const firstUrl = extractUrl(content);
        const encrypted = encryptMessage(content);

        const message = await prisma.message.create({
            data: {
                conversationId,
                content: encrypted,
                type,
                isFromAdmin: !!isFromAdmin,
                replyToId: replyToId || null
            },
            include: { replyTo: true }
        });

        // Background update for link preview
        if (firstUrl) {
            ogs({ url: firstUrl, timeout: 5000 }).then(async ({ result }) => {
                if (result.success) {
                    const linkPreview = {
                        title: result.ogTitle || result.twitterTitle || null,
                        description: result.ogDescription || result.twitterDescription || null,
                        image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || null,
                        url: firstUrl
                    };
                    await prisma.message.update({
                        where: { id: message.id },
                        data: { linkPreview: linkPreview }
                    });
                }
            }).catch(err => console.error('Background OG Scraper error:', err));
        }

        const updatedConv = await prisma.conversation.update({
            where: { id: conversationId },
            data: { 
                lastMessageAt: new Date(),
                noReplyTriggered: false
            },
            include: { link: true }
        });

        // Decrypt reply for sockets if applicable
        let decryptedReplyContent = (message as any).replyTo?.content;
        if ((message as any).replyTo?.content) {
            try { decryptedReplyContent = decryptMessage((message as any).replyTo.content); } catch (e) { }
        }

        const newMessage = {
            ...message,
            content,
            tempId,
            replyTo: (message as any).replyTo ? { ...(message as any).replyTo, content: decryptedReplyContent } : null
        };

        // Real-time Push
        try {
            const io = getIO();
            // Emit to the specific chat room
            io.to(conversationId).emit('receive_message', newMessage);
            // Alert dashboard to update
            io.to(`admin_${updatedConv.link.creatorId}`).emit('conversation_updated');
        } catch (err) {
            console.error('Socket push error:', err);
        }

        res.status(201).json(newMessage);
    } catch (e: any) {
        console.error('sendMessage error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const markRead = async (req: Request, res: Response) => {
    try {
        const { conversationId, isAdmin } = req.body;
        if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });

        const updateResult = await prisma.message.updateMany({
            where: {
                conversationId,
                isRead: false,
                isFromAdmin: !isAdmin
            },
            data: { isRead: true }
        });

        if (updateResult.count > 0) {
            try {
                const io = getIO();
                io.to(conversationId).emit('messages_read', { byAdmin: isAdmin });
            } catch (err) {
                console.error('Socket notification error (markRead):', err);
            }
        }

        res.json({ success: true, count: updateResult.count });
    } catch (e) {
        console.error('markRead error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

