import { Response } from 'express';
import { MessageType } from '../enums';
import { encryptMessage, decryptMessage } from '../lib/encryption';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { broadcastGroupMessage } from '../utils/sse';
import ogs from 'open-graph-scraper';

const getWorkspaceOwnerId = (req: AuthRequest) => req.user?.parentId || req.user?.userId;

const extractUrl = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex)?.[0];
};

const isGroupMember = async (groupId: string, userId: string) => {
    const member = await prisma.chatGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } }
    });
    return !!member;
};

const canAccessGroup = async (req: AuthRequest, groupId: string) => {
    const ownerId = getWorkspaceOwnerId(req)!;
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';

    const group = await prisma.chatGroup.findFirst({
        where: { id: groupId, ownerId }
    });
    if (!group) return null;

    if (isAdmin) return group;
    const member = await isGroupMember(groupId, userId);
    return member ? group : null;
};

export const getChatGroups = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = getWorkspaceOwnerId(req)!;
        const userId = req.user!.userId;
        const isAdmin = req.user!.role === 'ADMIN';

        const groups = await prisma.chatGroup.findMany({
            where: isAdmin
                ? { ownerId }
                : { ownerId, members: { some: { userId } } },
            include: {
                members: {
                    include: {
                        user: { select: { id: true, name: true, username: true, logoUrl: true, role: true } }
                    }
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    include: { sender: { select: { id: true, name: true, username: true } } }
                },
                _count: { select: { messages: true, members: true } }
            },
            orderBy: { lastMessageAt: 'desc' }
        });

        const formatted = groups.map((g) => {
            const lastMsg = g.messages[0];
            let preview = '';
            if (lastMsg) {
                try {
                    preview = lastMsg.systemLink
                        ? `📎 ${(lastMsg.systemLink as any).label}`
                        : decryptMessage(lastMsg.content);
                } catch {
                    preview = 'New message';
                }
            }
            return {
                id: g.id,
                name: g.name,
                memberCount: g._count.members,
                messageCount: g._count.messages,
                lastMessageAt: g.lastMessageAt,
                lastMessagePreview: preview,
                lastMessageSender: lastMsg?.sender?.name || lastMsg?.sender?.username || null,
                avatarUrl: g.avatarUrl,
                members: g.members.map((m) => ({
                    id: m.user.id,
                    name: m.user.name || m.user.username,
                    username: m.user.username,
                    logoUrl: m.user.logoUrl,
                    role: m.user.role
                }))
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error('getChatGroups error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createChatGroup = async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only admins can create chat groups' });
        }

        const ownerId = getWorkspaceOwnerId(req)!;
        const { name, memberIds } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });

        const ids: string[] = Array.isArray(memberIds) ? memberIds : [];
        const validMembers = await prisma.user.findMany({
            where: {
                id: { in: ids },
                OR: [{ id: ownerId }, { parentId: ownerId }]
            },
            select: { id: true }
        });
        const memberUserIds = new Set(validMembers.map((u) => u.id));
        memberUserIds.add(ownerId);

        const avatarUrl = `https://api.dicebear.com/7.x/shapes/svg?seed=${name.replace(/\s+/g, '')}-${Date.now()}`;

        const group = await prisma.chatGroup.create({
            data: {
                name: name.trim(),
                ownerId,
                avatarUrl,
                members: {
                    create: Array.from(memberUserIds).map((userId) => ({ userId }))
                }
            },
            include: {
                members: {
                    include: {
                        user: { select: { id: true, name: true, username: true, logoUrl: true, role: true } }
                    }
                }
            }
        });

        res.status(201).json({
            id: group.id,
            name: group.name,
            avatarUrl: group.avatarUrl,
            members: group.members.map((m) => ({
                id: m.user.id,
                name: m.user.name || m.user.username,
                username: m.user.username,
                logoUrl: m.user.logoUrl,
                role: m.user.role
            }))
        });
    } catch (e) {
        console.error('createChatGroup error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateChatGroup = async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only admins can update chat groups' });
        }

        const ownerId = getWorkspaceOwnerId(req)!;
        const { id } = req.params;
        const { name, memberIds } = req.body;

        const group = await prisma.chatGroup.findFirst({ where: { id, ownerId } });
        if (!group) return res.status(404).json({ error: 'Group not found' });

        if (name?.trim()) {
            await prisma.chatGroup.update({
                where: { id },
                data: { name: name.trim() }
            });
        }

        if (Array.isArray(memberIds)) {
            const validMembers = await prisma.user.findMany({
                where: {
                    id: { in: memberIds },
                    OR: [{ id: ownerId }, { parentId: ownerId }]
                },
                select: { id: true }
            });
            const memberUserIds = new Set(validMembers.map((u) => u.id));
            memberUserIds.add(ownerId);

            await prisma.chatGroupMember.deleteMany({ where: { groupId: id } });
            await prisma.chatGroupMember.createMany({
                data: Array.from(memberUserIds).map((userId) => ({ groupId: id, userId }))
            });
        }

        const updated = await prisma.chatGroup.findUnique({
            where: { id },
            include: {
                members: {
                    include: {
                        user: { select: { id: true, name: true, username: true, logoUrl: true, role: true } }
                    }
                }
            }
        });

        res.json({
            id: updated!.id,
            name: updated!.name,
            members: updated!.members.map((m) => ({
                id: m.user.id,
                name: m.user.name || m.user.username,
                username: m.user.username,
                logoUrl: m.user.logoUrl,
                role: m.user.role
            }))
        });
    } catch (e) {
        console.error('updateChatGroup error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteChatGroup = async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Only admins can delete chat groups' });
        }

        const ownerId = getWorkspaceOwnerId(req)!;
        const { id } = req.params;

        const group = await prisma.chatGroup.findFirst({ where: { id, ownerId } });
        if (!group) return res.status(404).json({ error: 'Group not found' });

        await prisma.chatGroup.delete({ where: { id } });
        res.json({ success: true });
    } catch (e) {
        console.error('deleteChatGroup error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const leaveChatGroup = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { id } = req.params;

        const deleted = await prisma.chatGroupMember.deleteMany({
            where: { groupId: id, userId }
        });

        if (deleted.count === 0) {
            return res.status(404).json({ error: 'You are not a member of this group' });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('leaveChatGroup error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getGroupMessages = async (req: AuthRequest, res: Response) => {
    try {
        const { groupId } = req.params;
        const { limit, cursor } = req.query;

        const group = await canAccessGroup(req, groupId);
        if (!group) return res.status(403).json({ error: 'Access denied' });

        const rawMessages = await prisma.groupMessage.findMany({
            where: { groupId },
            take: Number(limit) || 50,
            ...(cursor ? { skip: 1, cursor: { id: cursor as string } } : {}),
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { id: true, name: true, username: true, logoUrl: true, role: true } },
                replyTo: { include: { sender: { select: { id: true, name: true, username: true } } } }
            }
        });

        const messages = rawMessages.map((m) => {
            let content = m.content;
            try { content = decryptMessage(m.content); } catch { }

            let replyContent = m.replyTo?.content;
            if (m.replyTo?.content) {
                try { replyContent = decryptMessage(m.replyTo.content); } catch { }
            }

            return {
                ...m,
                content,
                replyTo: m.replyTo
                    ? { ...m.replyTo, content: replyContent }
                    : null,
                isOwn: m.senderId === req.user!.userId
            };
        }).reverse();

        res.json(messages);
    } catch (e) {
        console.error('getGroupMessages error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const sendGroupMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { groupId } = req.params;
        const { content, type = MessageType.TEXT, replyToId, systemLink, tempId } = req.body;

        const group = await canAccessGroup(req, groupId);
        if (!group) return res.status(403).json({ error: 'Access denied' });

        if (!content?.trim() && !systemLink) {
            return res.status(400).json({ error: 'Message content or system link required' });
        }

        const textContent = content?.trim() || (systemLink ? `Shared: ${systemLink.label}` : '');
        const encrypted = encryptMessage(textContent);
        const firstUrl = extractUrl(textContent);

        const message = await prisma.groupMessage.create({
            data: {
                groupId,
                senderId: req.user!.userId,
                content: encrypted,
                type,
                systemLink: systemLink || null,
                replyToId: replyToId || null
            },
            include: {
                sender: { select: { id: true, name: true, username: true, logoUrl: true, role: true } },
                replyTo: { include: { sender: { select: { id: true, name: true, username: true } } } }
            }
        });

        if (firstUrl) {
            ogs({ url: firstUrl, timeout: 5000 }).then(async ({ result }) => {
                if (result.success) {
                    await prisma.groupMessage.update({
                        where: { id: message.id },
                        data: {
                            linkPreview: {
                                title: result.ogTitle || result.twitterTitle || null,
                                description: result.ogDescription || result.twitterDescription || null,
                                image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || null,
                                url: firstUrl
                            }
                        }
                    });
                }
            }).catch(() => {});
        }

        await prisma.chatGroup.update({
            where: { id: groupId },
            data: { lastMessageAt: new Date() }
        });

        let replyContent = message.replyTo?.content;
        if (message.replyTo?.content) {
            try { replyContent = decryptMessage(message.replyTo.content); } catch { }
        }

        const responseData = {
            ...message,
            content: textContent,
            tempId,
            isOwn: true,
            replyTo: message.replyTo
                ? { ...message.replyTo, content: replyContent }
                : null
        };

        broadcastGroupMessage(groupId, responseData);

        res.status(201).json(responseData);
    } catch (e) {
        console.error('sendGroupMessage error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getLinkableEntities = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = getWorkspaceOwnerId(req)!;
        const { q } = req.query;
        const search = (q as string)?.trim().toLowerCase();

        const leadWhere: any = { ownerId };
        const bookingWhere: any = { ownerId };
        const formWhere: any = { ownerId };
        const linkWhere: any = { creatorId: ownerId };

        if (search) {
            leadWhere.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ];
            bookingWhere.OR = [
                { clientName: { contains: search, mode: 'insensitive' } },
                { service: { contains: search, mode: 'insensitive' } }
            ];
            formWhere.title = { contains: search, mode: 'insensitive' };
            linkWhere.title = { contains: search, mode: 'insensitive' };
        }

        const [leads, bookings, forms, links] = await Promise.all([
            prisma.crmLead.findMany({
                where: leadWhere,
                take: 15,
                orderBy: { updatedAt: 'desc' },
                select: { id: true, name: true, phone: true, company: true }
            }),
            prisma.booking.findMany({
                where: bookingWhere,
                take: 15,
                orderBy: { date: 'desc' },
                select: { id: true, clientName: true, service: true, date: true, status: true }
            }),
            prisma.customForm.findMany({
                where: formWhere,
                take: 15,
                orderBy: { updatedAt: 'desc' },
                select: { id: true, title: true }
            }),
            prisma.shortLink.findMany({
                where: linkWhere,
                take: 15,
                orderBy: { updatedAt: 'desc' },
                select: { id: true, title: true, slug: true }
            })
        ]);

        res.json({
            contacts: leads.map((l) => ({
                type: 'contact',
                id: l.id,
                label: l.name,
                subtitle: l.company || l.phone,
                path: `/dashboard/crm/contact/${l.id}`
            })),
            bookings: bookings.map((b) => ({
                type: 'booking',
                id: b.id,
                label: `${b.clientName} — ${b.service}`,
                subtitle: new Date(b.date).toLocaleDateString(),
                path: `/dashboard/bookings`
            })),
            forms: forms.map((f) => ({
                type: 'form',
                id: f.id,
                label: f.title,
                path: `/dashboard/forms/edit/${f.id}`
            })),
            links: links.map((l) => ({
                type: 'link',
                id: l.id,
                label: l.title,
                subtitle: `/chat/${l.slug}`,
                path: `/dashboard/links`
            }))
        });
    } catch (e) {
        console.error('getLinkableEntities error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
