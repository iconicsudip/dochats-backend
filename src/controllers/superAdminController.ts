import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Role } from '../enums';
import { hashPassword } from '../utils/auth';

const prisma = new PrismaClient();

export const getAllAdmins = async (req: any, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [admins, total] = await Promise.all([
            prisma.user.findMany({
                where: { role: Role.ADMIN },
                select: {
                    id: true,
                    username: true,
                    name: true,
                    logoUrl: true,
                    role: true,
                    isFirstLogin: true,
                    mustChangePassword: true,
                    createdAt: true,
                    subscriptionAmount: true,
                    subUsers: { select: { id: true, username: true } },
                    links: { select: { id: true, slug: true, title: true } }
                } as any,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.user.count({ where: { role: Role.ADMIN } })
        ]);

        res.json({
            data: admins,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            defaultAmount: Number(process.env.DEFAULT_SUBSCRIPTION_AMOUNT) || 999
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createAdmin = async (req: any, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { username, password, name, logoUrl, subscriptionAmount } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing data' });

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) return res.status(400).json({ error: 'Username already exists' });

        const defaultAmount = Number(process.env.DEFAULT_SUBSCRIPTION_AMOUNT) || 999;
        const finalSubscriptionAmount = subscriptionAmount ? Number(subscriptionAmount) : defaultAmount;

        const hashedPassword = await hashPassword(password);
        const user = await prisma.user.create({
            data: {
                username,
                password: hashedPassword,
                name,
                logoUrl,
                role: Role.ADMIN,
                mustChangePassword: true,
                subscriptionAmount: finalSubscriptionAmount
            } as any
        });

        // Auto-create first 30-day subscription (complimentary first month)
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30);

        const subscription = await prisma.subscription.create({
            data: {
                userId: user.id,
                startDate: now,
                endDate,
                amount: finalSubscriptionAmount,
                status: 'ACTIVE'
            }
        });

        // Mark first payment as PAID (complimentary)
        await prisma.payment.create({
            data: {
                subscriptionId: subscription.id,
                amount: finalSubscriptionAmount,
                status: 'PAID',
                paidAt: now
            }
        });

        res.status(201).json({ id: user.id, username: user.username, role: user.role, name: (user as any).name, logoUrl: (user as any).logoUrl });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateAdmin = async (req: any, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { id } = req.params;
        const { name, logoUrl, password, subscriptionAmount } = req.body;

        const updateData: any = { name, logoUrl };
        if (password) {
            updateData.password = await hashPassword(password);
        }
        if (subscriptionAmount !== undefined) {
            updateData.subscriptionAmount = Number(subscriptionAmount);
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData
        });

        res.json({ id: user.id, username: user.username, name: (user as any).name, logoUrl: (user as any).logoUrl });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteAdmin = async (req: any, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { id } = req.params;

        // Important: Sub-users depend on the admin. Decide if we cascade delete or just reassign.
        // For now, let's just delete the admin and their associations.
        await prisma.user.delete({ where: { id } });

        res.json({ message: 'Admin deleted successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getSuperAdminStats = async (req: any, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const [totalStats, recentConversations] = await Promise.all([
            Promise.all([
                prisma.user.count({ where: { role: Role.ADMIN } }),
                prisma.user.count({ where: { role: Role.SUB_USER } }),
                prisma.shortLink.count(),
                prisma.conversation.count(),
                prisma.message.count(),
            ]),
            prisma.conversation.findMany({
                take: 10,
                orderBy: { lastMessageAt: 'desc' },
                include: {
                    link: { select: { title: true } }
                }
            })
        ]);

        const [totalAdmins, totalSubUsers, totalLinks, totalConversations, totalMessages] = totalStats;

        res.json({
            totalAdmins,
            totalSubUsers,
            totalLinks,
            totalConversations,
            totalMessages,
            recentConversations,
            defaultAmount: Number(process.env.DEFAULT_SUBSCRIPTION_AMOUNT) || 999
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
