import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { decryptMessage } from '../lib/encryption';
import { MessageType } from '../enums';

export interface SSEClient {
    id: string;
    res: Response;
    userId?: string;
    role?: string;
    assignedLinkIds?: string[];
    conversationId?: string;
    visitorToken?: string;
}

let clients: SSEClient[] = [];

export const addSSEClient = (client: SSEClient) => {
    clients.push(client);
    console.log(`[SSE] Client connected: ${client.id}. Total clients: ${clients.length}`);
};

export const removeSSEClient = (id: string) => {
    clients = clients.filter(c => c.id !== id);
    console.log(`[SSE] Client disconnected: ${id}. Total clients: ${clients.length}`);
};

export const broadcastMessage = (conversationId: string, linkId: string, creatorId: string, message: any) => {
    const payload = JSON.stringify({ type: 'message', conversationId, message });
    let count = 0;

    clients.forEach(client => {
        let shouldSend = false;

        if (client.conversationId === conversationId) {
            shouldSend = true;
        } else if (client.userId) {
            if (client.role === 'ADMIN' && client.userId === creatorId) {
                shouldSend = true;
            } else if (client.role === 'SUB_USER' && client.assignedLinkIds?.includes(linkId)) {
                shouldSend = true;
            } else if (client.role === 'SUPER_ADMIN') {
                shouldSend = true;
            }
        }

        if (shouldSend) {
            try {
                client.res.write(`data: ${payload}\n\n`);
                count++;
            } catch (err) {
                console.error(`[SSE] Error writing message to client ${client.id}:`, err);
            }
        }
    });

    console.log(`[SSE] Broadcast message to ${count} clients`);
};

export const broadcastMarkRead = (conversationId: string, linkId: string, creatorId: string, isAdmin: boolean) => {
    const payload = JSON.stringify({ type: 'mark_read', conversationId, isAdmin });
    let count = 0;

    clients.forEach(client => {
        let shouldSend = false;

        if (client.conversationId === conversationId) {
            shouldSend = true;
        } else if (client.userId) {
            if (client.role === 'ADMIN' && client.userId === creatorId) {
                shouldSend = true;
            } else if (client.role === 'SUB_USER' && client.assignedLinkIds?.includes(linkId)) {
                shouldSend = true;
            } else if (client.role === 'SUPER_ADMIN') {
                shouldSend = true;
            }
        }

        if (shouldSend) {
            try {
                client.res.write(`data: ${payload}\n\n`);
                count++;
            } catch (err) {
                console.error(`[SSE] Error writing mark_read to client ${client.id}:`, err);
            }
        }
    });

    console.log(`[SSE] Broadcast mark_read to ${count} clients`);
};

export const broadcastConversationUpdate = (conversation: any) => {
    const payload = JSON.stringify({ type: 'conversation_updated', conversation });
    const { linkId, creatorId } = conversation;
    let count = 0;

    clients.forEach(client => {
        let shouldSend = false;

        if (client.userId) {
            if (client.role === 'ADMIN' && client.userId === creatorId) {
                shouldSend = true;
            } else if (client.role === 'SUB_USER' && client.assignedLinkIds?.includes(linkId)) {
                shouldSend = true;
            } else if (client.role === 'SUPER_ADMIN') {
                shouldSend = true;
            }
        }

        if (shouldSend) {
            try {
                client.res.write(`data: ${payload}\n\n`);
                count++;
            } catch (err) {
                console.error(`[SSE] Error writing conversation update to client ${client.id}:`, err);
            }
        }
    });

    console.log(`[SSE] Broadcast conversation update to ${count} clients`);
};

export const broadcastGroupMessage = async (groupId: string, message: any) => {
    try {
        const members = await prisma.chatGroupMember.findMany({
            where: { groupId },
            select: { userId: true }
        });
        const memberIds = new Set(members.map(m => m.userId));

        const payload = JSON.stringify({ type: 'group_message', groupId, message });
        let count = 0;

        clients.forEach(client => {
            if (client.userId && memberIds.has(client.userId)) {
                try {
                    client.res.write(`data: ${payload}\n\n`);
                    count++;
                } catch (err) {
                    console.error(`[SSE] Error writing group message to client ${client.id}:`, err);
                }
            }
        });

        console.log(`[SSE] Broadcast group message to ${count} clients`);
    } catch (err) {
        console.error('[SSE] Error broadcasting group message:', err);
    }
};

export const getFormattedConversation = async (conversationId: string) => {
    try {
        const conv = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                link: {
                    select: {
                        title: true,
                        slug: true,
                        creatorId: true
                    }
                },
                messages: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!conv) return null;

        const lastMsg = conv.messages?.[0];
        const visitorMessages = (conv.messages || []).filter((m: any) => !m.isFromAdmin);
        const unreadCount = visitorMessages.filter((m: any) => !m.isRead).length;

        let lastMessage = 'No messages yet';
        let lastMessageType = MessageType.TEXT;

        if (lastMsg) {
            lastMessageType = (lastMsg.type as unknown as MessageType) || MessageType.TEXT;
            if (lastMsg.type === MessageType.AUDIO) {
                lastMessage = '🎵 Audio Message';
            } else {
                try {
                    lastMessage = decryptMessage(lastMsg.content);
                } catch (e) {
                    lastMessage = lastMsg.content;
                }
            }
        }

        return {
            id: conv.id,
            linkId: conv.linkId,
            linkTitle: conv.link?.title || 'Unknown Link',
            linkSlug: conv.link?.slug || '',
            visitorToken: (conv.visitorToken || '').substring(0, 8),
            visitorName: conv.visitorName || 'Anonymous',
            visitorPhone: conv.visitorPhone || 'N/A',
            lastMessage,
            lastMessageType,
            lastMessageAt: conv.lastMessageAt,
            unreadCount,
            createdAt: conv.createdAt,
            creatorId: conv.link?.creatorId
        };
    } catch (err) {
        console.error('[SSE] Error formatting conversation:', err);
        return null;
    }
};

export const broadcastTypingEvent = (conversationId: string, linkId: string, creatorId: string, isTyping: boolean, isFromAdmin: boolean) => {
    const payload = JSON.stringify({ type: 'typing', conversationId, isTyping, isFromAdmin });
    clients.forEach(client => {
        let shouldSend = false;
        if (client.conversationId === conversationId) {
            shouldSend = true;
        } else if (client.userId) {
            if (client.role === 'ADMIN' && client.userId === creatorId) {
                shouldSend = true;
            } else if (client.role === 'SUB_USER' && client.assignedLinkIds?.includes(linkId)) {
                shouldSend = true;
            }
        }
        if (shouldSend) {
            client.res.write(`data: ${payload}\n\n`);
        }
    });
};

export const isAgentOnline = (linkId: string, creatorId: string): boolean => {
    return clients.some(client => {
        if (!client.userId) return false;
        if (client.role === 'ADMIN' && client.userId === creatorId) return true;
        if (client.role === 'SUB_USER' && client.assignedLinkIds?.includes(linkId)) return true;
        return false;
    });
};
