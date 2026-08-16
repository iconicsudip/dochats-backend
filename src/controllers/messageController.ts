import { Request, Response } from 'express';
import { MessageType } from '../enums';
import { encryptMessage, decryptMessage } from '../lib/encryption';
import ogs from 'open-graph-scraper';
import { prisma } from '../lib/prisma';
import { broadcastMessage, broadcastMarkRead, broadcastConversationUpdate, getFormattedConversation } from '../utils/sse';
import { detectSpamAndIntent, translateMessage, detectLanguage, suggestReply, summarizeChat } from '../utils/nvidia';

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

        // 1. Welcome Chatbot Menu Options Parsing (Visitor only)
        if (!isFromAdmin && updatedConv.link.menuOptions) {
            try {
                const options = updatedConv.link.menuOptions as any[];
                if (options.length > 0) {
                    const choice = options.find(o => 
                        content.trim().toLowerCase() === o.key.toString().toLowerCase() ||
                        content.trim().toLowerCase() === o.label.toLowerCase()
                    );
                    if (choice) {
                        const botResponse = `You selected: ${choice.label}. How can we assist you with this?`;
                        const encryptedBot = encryptMessage(botResponse);
                        const botMsg = await prisma.message.create({
                            data: {
                                conversationId,
                                content: encryptedBot,
                                isFromAdmin: true,
                                isRead: false
                            }
                        });
                        const sseBotMsg = { ...botMsg, content: botResponse, replyTo: null };
                        broadcastMessage(conversationId, updatedConv.linkId, updatedConv.link.creatorId, sseBotMsg);
                    }
                }
            } catch (err) {
                console.error('Welcome menu parsing error:', err);
            }
        }

        // 2. Auto-Assignment Rules (Visitor only)
        if (!isFromAdmin && !(updatedConv as any).assignedUserId && updatedConv.link.assignmentRule !== 'MANUAL') {
            try {
                const assignedUsers = await prisma.user.findMany({
                    where: { assignedLinks: { some: { id: updatedConv.linkId } } }
                });
                if (assignedUsers.length > 0) {
                    let targetAgentId = assignedUsers[0].id;
                    if (updatedConv.link.assignmentRule === 'ROUND_ROBIN') {
                        const totalConvs = await prisma.conversation.count({
                            where: { linkId: updatedConv.linkId }
                        });
                        targetAgentId = assignedUsers[totalConvs % assignedUsers.length].id;
                    } else if (updatedConv.link.assignmentRule === 'LEAST_BUSY') {
                        const agentsWithCounts = await Promise.all(assignedUsers.map(async (u) => {
                            const count = await prisma.conversation.count({
                                where: { assignedUserId: u.id }
                            });
                            return { id: u.id, count };
                        }));
                        agentsWithCounts.sort((a, b) => a.count - b.count);
                        targetAgentId = agentsWithCounts[0].id;
                    }
                    await prisma.conversation.update({
                        where: { id: conversationId },
                        data: { assignedUserId: targetAgentId }
                    });
                    (updatedConv as any).assignedUserId = targetAgentId;
                }
            } catch (err) {
                console.error('Auto assignment error:', err);
            }
        }

        // Decrypt reply for sockets if applicable
        let decryptedReplyContent = (message as any).replyTo?.content;
        if ((message as any).replyTo?.content) {
            try { decryptedReplyContent = decryptMessage((message as any).replyTo.content); } catch (e) { }
        }

        const newMessage: any = {
            ...message,
            content,
            tempId,
            replyTo: (message as any).replyTo ? { ...(message as any).replyTo, content: decryptedReplyContent } : null
        };

        // Real-time Push
        broadcastMessage(conversationId, updatedConv.linkId, updatedConv.link.creatorId, newMessage);
        getFormattedConversation(conversationId).then(formatted => {
            if (formatted) {
                broadcastConversationUpdate(formatted);
            }
        }).catch(err => console.error('Error broadcasting conversation update on sendMessage:', err));

        // 3. NVIDIA AI Insights & Auto-Translation Background Job
        if (!isFromAdmin) {
            (async () => {
                try {
                    // Fetch context messages for summary
                    const messagesForSummary = await prisma.message.findMany({
                        where: { conversationId },
                        take: 10,
                        orderBy: { createdAt: 'asc' }
                    });
                    const formattedContext = messagesForSummary.map(m => {
                        let dec = m.content;
                        try { dec = decryptMessage(m.content); } catch (e) {}
                        return { role: (m.isFromAdmin ? 'assistant' : 'user') as 'assistant' | 'user', content: dec };
                    });

                    // Run AI operations in parallel to optimize response time
                    const [lang, aiResult, summary] = await Promise.all([
                        detectLanguage(content).catch(() => null),
                        detectSpamAndIntent(content).catch(() => null),
                        summarizeChat(formattedContext).catch(() => null)
                    ]);

                    // If language is foreign, auto-translate asynchronously
                    if (lang && lang.toLowerCase() !== 'english') {
                        translateMessage(content, 'English').then(async (trans) => {
                            if (trans) {
                                await prisma.message.update({
                                    where: { id: message.id },
                                    data: { linkPreview: { ...(message.linkPreview as any || {}), translation: trans } }
                                });
                                newMessage.translation = trans;
                                broadcastMessage(conversationId, updatedConv.linkId, updatedConv.link.creatorId, newMessage);
                            }
                        }).catch(err => console.error('[NVIDIA BG Translate] error:', err));
                    }

                    if (updatedConv.visitorPhone || updatedConv.visitorEmail) {
                        const lead = await prisma.crmLead.findFirst({
                            where: { 
                                OR: [
                                    { phone: updatedConv.visitorPhone || '' },
                                    { email: updatedConv.visitorEmail || '' }
                                ],
                                ownerId: updatedConv.link.creatorId 
                            }
                        });
                        if (lead) {
                            await prisma.crmLead.update({
                                where: { id: lead.id },
                                data: {
                                    email: updatedConv.visitorEmail || lead.email,
                                    phone: updatedConv.visitorPhone || lead.phone,
                                    status: aiResult?.spam ? 'LOST' : undefined,
                                    aiSummary: summary || lead.aiSummary,
                                    aiInsights: {
                                        sentiment: aiResult?.sentiment || 'neutral',
                                        intent: aiResult?.intent || 'other',
                                        spam: !!aiResult?.spam
                                    }
                                }
                            });
                        } else {
                            await prisma.crmLead.create({
                                data: {
                                    ownerId: updatedConv.link.creatorId,
                                    name: updatedConv.visitorName || 'Visitor',
                                    phone: updatedConv.visitorPhone || 'N/A',
                                    email: updatedConv.visitorEmail || null,
                                    status: aiResult?.spam ? 'LOST' : 'NEW',
                                    aiSummary: summary || 'No summary yet',
                                    aiInsights: {
                                        sentiment: aiResult?.sentiment || 'neutral',
                                        intent: aiResult?.intent || 'other',
                                        spam: !!aiResult?.spam
                                    }
                                }
                            });
                        }
                    }
                } catch (err) {
                    console.error('[NVIDIA AI BG Job] error:', err);
                }
            })();
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

        // Real-time notification
        prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { link: true }
        }).then(async (conversation) => {
            if (conversation) {
                broadcastMarkRead(conversationId, conversation.linkId, conversation.link.creatorId, isAdmin);
                const formatted = await getFormattedConversation(conversationId);
                if (formatted) {
                    broadcastConversationUpdate(formatted);
                }
            }
        }).catch(err => console.error('Error broadcasting markRead:', err));

        res.json({ success: true, count: updateResult.count });
    } catch (e) {
        console.error('markRead error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getSuggestedReply = async (req: Request, res: Response) => {
    try {
        const { conversationId } = req.params;
        const messages = await prisma.message.findMany({
            where: { conversationId },
            take: 15,
            orderBy: { createdAt: 'asc' }
        });

        const formattedContext = messages.map(m => {
            let dec = m.content;
            try { dec = decryptMessage(m.content); } catch (e) {}
            return { role: (m.isFromAdmin ? 'assistant' : 'user') as 'assistant' | 'user', content: dec };
        });

        const suggestion = await suggestReply(formattedContext);
        res.json({ suggestion });
    } catch (err) {
        console.error('getSuggestedReply error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

