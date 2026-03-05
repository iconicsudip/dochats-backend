import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Role } from '../enums';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing data' });

        const user = await prisma.user.findUnique({
            where: { username },
            include: { assignedLinks: { select: { id: true, title: true } } }
        });
        if (!user || !(await comparePassword(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user.id);
        res.status(200).json({
            token,
            user: {
                id: user.id,
                username: user.username,
                name: (user as any).name,
                logoUrl: (user as any).logoUrl,
                role: user.role,
                isFirstLogin: (user as any).isFirstLogin,
                mustChangePassword: (user as any).mustChangePassword,
                assignedLinks: (user as any).assignedLinks,
                createdAt: user.createdAt
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getMe = async (req: any, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { assignedLinks: { select: { id: true, title: true } } }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });

        let subscriptionInfo: any = null;

        // Include subscription info for ADMIN users
        if (user.role === Role.ADMIN) {
            const latestSub = await (prisma as any).subscription.findFirst({
                where: { userId: user.id },
                orderBy: { endDate: 'desc' },
                include: { payment: true }
            });

            if (latestSub) {
                const now = new Date();
                const daysRemaining = Math.ceil((latestSub.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                const isOverdue = latestSub.endDate < now;
                const isPaid = latestSub.payment?.status === 'PAID';

                subscriptionInfo = {
                    status: isOverdue ? 'OVERDUE' : latestSub.status,
                    isOverdue: isOverdue || !isPaid,
                    showWarning: daysRemaining <= 3 && daysRemaining > 0,
                    daysRemaining: Math.max(0, daysRemaining),
                    endDate: latestSub.endDate
                };
            } else {
                subscriptionInfo = {
                    status: 'NO_SUBSCRIPTION',
                    isOverdue: true,
                    showWarning: false,
                    daysRemaining: 0,
                    endDate: null
                };
            }
        }

        res.json({
            id: user.id,
            username: user.username,
            name: (user as any).name,
            logoUrl: (user as any).logoUrl,
            role: user.role,
            isFirstLogin: (user as any).isFirstLogin,
            mustChangePassword: (user as any).mustChangePassword,
            assignedLinks: (user as any).assignedLinks,
            createdAt: user.createdAt,
            subscription: subscriptionInfo
        });
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const changePassword = async (req: any, res: Response) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Invalid password' });

        const hashedPassword = await hashPassword(newPassword);
        await prisma.user.update({
            where: { id: req.user.userId },
            data: { password: hashedPassword, isFirstLogin: false, mustChangePassword: false } as any
        });
        res.status(200).json({ message: 'Password updated successfully' });
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const getSubUsers = async (req: any, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [subUsers, total] = await Promise.all([
            prisma.user.findMany({
                where: { parentId: req.user.userId },
                include: { assignedLinks: { select: { id: true, title: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.user.count({ where: { parentId: req.user.userId } })
        ]);

        const formatted = subUsers.map(u => ({
            id: u.id,
            username: u.username,
            name: (u as any).name,
            logoUrl: (u as any).logoUrl,
            assignedLinks: u.assignedLinks
        }));

        res.json({
            data: formatted,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const createSubUser = async (req: any, res: Response) => {
    try {
        const { username, password, assignedLinkIds } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing data' });

        const currentUser = await prisma.user.findUnique({ where: { id: req.user.userId } });
        if (currentUser?.role === Role.SUB_USER) return res.status(403).json({ error: 'Not allowed' });

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) return res.status(400).json({ error: 'Username taken' });

        const validLinks = await prisma.shortLink.findMany({
            where: { id: { in: assignedLinkIds || [] }, creatorId: req.user.userId }
        });

        const hashedPassword = await hashPassword(password);
        const user = await prisma.user.create({
            data: {
                username,
                password: hashedPassword,
                role: Role.SUB_USER,
                isFirstLogin: true,
                parentId: req.user.userId,
                assignedLinks: {
                    connect: validLinks.map(l => ({ id: l.id }))
                }
            },
            include: { assignedLinks: { select: { id: true, title: true } } }
        });

        res.status(201).json({
            id: user.id,
            username: user.username,
            assignedLinks: user.assignedLinks
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const deleteSubUser = async (req: any, res: Response) => {
    try {
        const { id } = req.params;

        const currentUser = await prisma.user.findUnique({ where: { id: req.user.userId } });
        if (currentUser?.role === Role.SUB_USER) return res.status(403).json({ error: 'Not allowed' });

        const subUser = await prisma.user.findFirst({
            where: { id, parentId: req.user.userId }
        });
        if (!subUser) return res.status(404).json({ error: 'Sub-user not found' });

        await prisma.user.delete({
            where: { id }
        });

        res.json({ message: 'Sub-user deleted successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const updateSubUser = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const { password, assignedLinkIds } = req.body;

        const currentUser = await prisma.user.findUnique({ where: { id: req.user.userId } });
        if (currentUser?.role === Role.SUB_USER) return res.status(403).json({ error: 'Not allowed' });

        const subUser = await prisma.user.findFirst({
            where: { id, parentId: req.user.userId }
        });
        if (!subUser) return res.status(404).json({ error: 'Sub-user not found' });

        const updateData: any = {};
        if (password) {
            updateData.password = await hashPassword(password);
        }

        if (assignedLinkIds) {
            const validLinks = await prisma.shortLink.findMany({
                where: { id: { in: assignedLinkIds }, creatorId: req.user.userId }
            });
            updateData.assignedLinks = {
                set: [], // Clear all current associations
                connect: validLinks.map(l => ({ id: l.id }))
            };
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            include: { assignedLinks: { select: { id: true, title: true } } }
        });

        res.json({
            id: updatedUser.id,
            username: updatedUser.username,
            assignedLinks: updatedUser.assignedLinks
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export const updateMe = async (req: any, res: Response) => {
    try {
        const { name, logoUrl, password } = req.body;
        const updateData: any = {};

        // Only update fields that are explicitly provided
        if (name !== undefined) updateData.name = name;
        if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
        if (password) {
            updateData.password = await hashPassword(password);
        }

        const user = await prisma.user.update({
            where: { id: req.user.userId },
            data: updateData
        });

        res.json({
            id: user.id,
            username: user.username,
            name: (user as any).name,
            logoUrl: (user as any).logoUrl,
            role: user.role,
            createdAt: user.createdAt
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
}
