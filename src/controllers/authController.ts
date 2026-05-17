import { Request, Response } from 'express';
import { Role } from '../enums';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

/**
 * Helper to format user response consistently
 */
const formatUserResponse = (user: any) => {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const defaultModules = ['LIVE_CHAT', 'CRM', 'BOOKINGS', 'AUTOMATION', 'ANALYTICS', 'LINKS', 'SUB_USERS', 'BILLING', 'PLANS', 'FORMS', 'WHATSAPP', 'EMAIL'];
    
    let userModules: string[] = [];
    if (isSuperAdmin) {
        userModules = defaultModules;
    } else {
        const planModules = user.plan?.enabledModules || [];
        const manualModules = user.moduleConfig?.enabledModules || [];
        // Use Set to remove duplicates
        const combined = new Set([...planModules, ...manualModules]);
        userModules = combined.size > 0 ? Array.from(combined) : defaultModules; // fallback to default if both empty
    }

    return {
        id: user.id,
        username: user.username,
        name: user.name,
        logoUrl: user.logoUrl,
        role: user.role,
        parentId: user.parentId || null,
        isFirstLogin: user.isFirstLogin,
        mustChangePassword: user.mustChangePassword,
        hasSeenTour: user.hasSeenTour,
        assignedLinks: user.assignedLinks,
        enabledModules: userModules,
        whatsappConfig: user.whatsappConfig,
        emailConfig: user.emailConfig,
        createdAt: user.createdAt,
        // Only include plan-related info for non-super-admins
        ...(!isSuperAdmin && {
            plan: user.plan,
            subUsersLimit: user.subUsersLimit,
            linksLimit: user.linksLimit,
            upgradeRequests: user.upgradeRequests
        })
    };
};

export const login = async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const user = await prisma.user.findUnique({
            where: { username },
            include: {
                moduleConfig: true,
                assignedLinks: { select: { id: true, title: true } },
                plan: true,
                upgradeRequests: {
                    where: { status: 'PENDING' },
                    select: { planId: true, status: true }
                },
                subscriptions: {
                    orderBy: { endDate: 'desc' },
                    take: 1,
                    include: { payment: true }
                }
            }
        });

        if (!user || !(await comparePassword(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user.id);
        res.status(200).json({
            token,
            user: formatUserResponse(user)
        });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getMe = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: {
                moduleConfig: true,
                assignedLinks: { select: { id: true, title: true } },
                plan: true,
                upgradeRequests: {
                    where: { status: 'PENDING' },
                    select: { planId: true, status: true }
                },
                subscriptions: {
                    orderBy: { endDate: 'desc' },
                    take: 1,
                    include: { payment: true }
                }
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let subscriptionInfo: any = null;

        // Include subscription info for ADMIN users
        if (user.role === Role.ADMIN) {
            const latestSub = user.subscriptions?.[0];

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
            ...formatUserResponse(user),
            subscription: subscriptionInfo
        });
    } catch (e) {
        console.error('getMe error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const changePassword = async (req: AuthRequest, res: Response) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }

        const hashedPassword = await hashPassword(newPassword);
        await prisma.user.update({
            where: { id: req.user!.userId },
            data: {
                password: hashedPassword,
                isFirstLogin: false,
                mustChangePassword: false
            }
        });
        res.status(200).json({ message: 'Password updated successfully' });
    } catch (e) {
        console.error('changePassword error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getSubUsers = async (req: AuthRequest, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;

        const parentId = req.user!.parentId || req.user!.userId;

        const [subUsers, total] = await Promise.all([
            prisma.user.findMany({
                where: { parentId },
                include: { assignedLinks: { select: { id: true, title: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.user.count({ where: { parentId } })
        ]);

        const formatted = subUsers.map(u => ({
            id: u.id,
            username: u.username,
            name: u.name,
            logoUrl: u.logoUrl,
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
        console.error('getSubUsers error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createSubUser = async (req: AuthRequest, res: Response) => {
    try {
        const { username, password, assignedLinkIds } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const currentUser = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            include: { subUsers: true }
        });

        if (!currentUser) {
            return res.status(404).json({ error: 'Current user not found' });
        }

        if (currentUser.role === Role.SUB_USER) {
            return res.status(403).json({ error: 'Sub-users cannot create other sub-users' });
        }

        // Check sub-users limit
        const subUsersLimit = currentUser.subUsersLimit || 3;
        if (currentUser.subUsers.length >= subUsersLimit) {
            return res.status(400).json({
                error: `You have reached your sub-users limit (${subUsersLimit}). Please upgrade your plan.`
            });
        }

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) {
            return res.status(400).json({ error: 'Username is already taken' });
        }

        const validLinks = await prisma.shortLink.findMany({
            where: {
                id: { in: assignedLinkIds || [] },
                creatorId: req.user!.userId
            }
        });

        const hashedPassword = await hashPassword(password);
        const user = await prisma.user.create({
            data: {
                username,
                password: hashedPassword,
                role: Role.SUB_USER,
                isFirstLogin: true,
                parentId: req.user!.userId,
                assignedLinks: {
                    connect: validLinks.map(l => ({ id: l.id }))
                },
                subscriptionAmount: 0 // Sub-users don't pay subscription
            },
            include: { assignedLinks: { select: { id: true, title: true } } }
        });

        res.status(201).json({
            id: user.id,
            username: user.username,
            assignedLinks: user.assignedLinks
        });
    } catch (e) {
        console.error('createSubUser error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteSubUser = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const currentUser = await prisma.user.findUnique({ where: { id: req.user!.userId } });
        if (!currentUser || currentUser.role === Role.SUB_USER) {
            return res.status(403).json({ error: 'Not allowed' });
        }

        const subUser = await prisma.user.findFirst({
            where: { id, parentId: req.user!.userId }
        });
        if (!subUser) {
            return res.status(404).json({ error: 'Sub-user not found' });
        }

        await prisma.user.delete({
            where: { id }
        });

        res.json({ message: 'Sub-user deleted successfully' });
    } catch (e) {
        console.error('deleteSubUser error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateSubUser = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { password, assignedLinkIds } = req.body;

        const currentUser = await prisma.user.findUnique({ where: { id: req.user!.userId } });
        if (!currentUser || currentUser.role === Role.SUB_USER) {
            return res.status(403).json({ error: 'Not allowed' });
        }

        const subUser = await prisma.user.findFirst({
            where: { id, parentId: req.user!.userId }
        });
        if (!subUser) {
            return res.status(404).json({ error: 'Sub-user not found' });
        }

        const updateData: any = {};
        if (password) {
            updateData.password = await hashPassword(password);
        }

        if (assignedLinkIds) {
            const validLinks = await prisma.shortLink.findMany({
                where: {
                    id: { in: assignedLinkIds },
                    creatorId: req.user!.userId
                }
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
        console.error('updateSubUser error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

import { verifySesIdentity } from '../utils/email';

export const updateMe = async (req: AuthRequest, res: Response) => {
    try {
        const { name, logoUrl, password, whatsappConfig, emailConfig } = req.body;
        const updateData: any = {};

        // Only update fields that are explicitly provided
        if (name !== undefined) updateData.name = name;
        if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
        if (whatsappConfig !== undefined) updateData.whatsappConfig = whatsappConfig;
        
        if (emailConfig !== undefined) {
            updateData.emailConfig = emailConfig;
            // If email is provided, trigger SES verification request
            if (emailConfig.fromEmail) {
                try {
                    await verifySesIdentity(emailConfig.fromEmail);
                } catch (sesError) {
                    console.error("[SES] Identity verification request failed:", sesError);
                    // We don't block the profile update even if SES fails
                }
            }
        }
        if (password) {
            updateData.password = await hashPassword(password);
        }

        const user = await prisma.user.update({
            where: { id: req.user!.userId },
            data: updateData,
            include: {
                moduleConfig: true,
                assignedLinks: { select: { id: true, title: true } },
                plan: true,
                upgradeRequests: {
                    where: { status: 'PENDING' },
                    select: { planId: true, status: true }
                },
                subscriptions: {
                    orderBy: { endDate: 'desc' },
                    take: 1,
                    include: { payment: true }
                }
            }
        });

        res.json(formatUserResponse(user));
    } catch (e) {
        console.error('updateMe error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const updateTourStatus = async (req: AuthRequest, res: Response) => {
    try {
        await prisma.user.update({
            where: { id: req.user!.userId },
            data: { hasSeenTour: true }
        });
        res.json({ success: true });
    } catch (e) {
        console.error('updateTourStatus error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
