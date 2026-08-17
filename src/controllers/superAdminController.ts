import { Response } from 'express';
import { Role } from '../enums';
import { hashPassword } from '../utils/auth';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

export const getAllAdmins = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
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
                    planId: true,
                    plan: true,
                    subUsersLimit: true,
                    linksLimit: true,
                    moduleConfig: true,
                    subUsers: { select: { id: true, username: true } },
                    links: { select: { id: true, slug: true, title: true } }
                },
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
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error('getAllAdmins error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createAdmin = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const {
            username,
            password,
            name,
            logoUrl,
            subscriptionAmount,
            planId,
            billingCycle,
            subUsersLimit,
            linksLimit
        } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) return res.status(400).json({ error: 'Username already exists' });

        let finalSubscriptionAmount: number = 0;
        let finalSubUsersLimit = subUsersLimit !== undefined ? Number(subUsersLimit) : 3;
        let finalLinksLimit = linksLimit !== undefined ? Number(linksLimit) : 5;

        if (planId) {
            const plan = await prisma.plan.findUnique({ where: { id: planId } });
            if (plan) {
                const planPrice = (billingCycle || 'MONTHLY') === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
                finalSubscriptionAmount = subscriptionAmount !== undefined ? Number(subscriptionAmount) : planPrice;
                if (subUsersLimit === undefined) finalSubUsersLimit = plan.subUsersLimit;
                if (linksLimit === undefined) finalLinksLimit = plan.linksLimit;
            }
        } else if (subscriptionAmount !== undefined) {
            finalSubscriptionAmount = Number(subscriptionAmount);
        }

        const hashedPassword = await hashPassword(password);
        const user = await prisma.user.create({
            data: {
                username,
                password: hashedPassword,
                name,
                logoUrl,
                role: Role.ADMIN,
                mustChangePassword: true,
                subscriptionAmount: finalSubscriptionAmount,
                planId,
                billingCycle: billingCycle || 'MONTHLY',
                subUsersLimit: finalSubUsersLimit,
                linksLimit: finalLinksLimit
            }
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

        res.status(201).json({
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name,
            logoUrl: user.logoUrl
        });
    } catch (e) {
        console.error('createAdmin error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateAdmin = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { id } = req.params;
        const {
            name,
            logoUrl,
            password,
            subscriptionAmount,
            planId,
            billingCycle,
            subUsersLimit,
            linksLimit
        } = req.body;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (logoUrl !== undefined) updateData.logoUrl = logoUrl;

        if (password) {
            updateData.password = await hashPassword(password);
        }
        if (subscriptionAmount !== undefined) {
            updateData.subscriptionAmount = Number(subscriptionAmount);
        }
        if (billingCycle !== undefined) {
            updateData.billingCycle = billingCycle;
        }

        if (planId !== undefined) {
            updateData.planId = planId;
            if (planId) {
                const plan = await prisma.plan.findUnique({ where: { id: planId } });
                if (plan) {
                    const currentCycle = billingCycle || updateData.billingCycle || 'MONTHLY';
                    if (subUsersLimit === undefined) updateData.subUsersLimit = plan.subUsersLimit;
                    if (linksLimit === undefined) updateData.linksLimit = plan.linksLimit;
                    if (subscriptionAmount === undefined) {
                        const basePrice = currentCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
                        const linkPrice = currentCycle === 'YEARLY' ? plan.pricePerLinkYearly : plan.pricePerLinkMonthly;
                        const currentUser = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { links: true } } } });
                        const linksCount = currentUser?._count?.links || 0;
                        updateData.subscriptionAmount = basePrice + (linksCount * linkPrice);
                    }
                }
            } else {
                updateData.planId = null;
            }
        }

        if (subUsersLimit !== undefined) {
            updateData.subUsersLimit = Number(subUsersLimit);
        }
        if (linksLimit !== undefined) {
            updateData.linksLimit = Number(linksLimit);
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData
        });

        res.json({ id: user.id, username: user.username, name: user.name, logoUrl: user.logoUrl });
    } catch (e) {
        console.error('updateAdmin error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteAdmin = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { id } = req.params;
        await prisma.user.delete({ where: { id } });
        res.json({ message: 'Admin deleted successfully' });
    } catch (e) {
        console.error('deleteAdmin error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getSuperAdminStats = async (req: AuthRequest, res: Response) => {
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
            recentConversations
        });
    } catch (e) {
        console.error('getSuperAdminStats error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getAllPlans = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || (req.user.role !== Role.SUPER_ADMIN && req.user.role !== Role.ADMIN && req.user.role !== Role.SUB_USER)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const plans = await prisma.plan.findMany({
            where: (req.user.role === Role.ADMIN || req.user.role === Role.SUB_USER) ? { isPublic: true } : {},
            orderBy: { order: 'asc' }
        });

        res.json(plans);
    } catch (e) {
        console.error('getAllPlans error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createPlan = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { name, monthlyPrice, yearlyPrice, order, subUsersLimit, linksLimit, pricePerLinkMonthly, pricePerLinkYearly, leadCaptureEnabled, isPublic, description, enabledModules } = req.body;
        if (!name || monthlyPrice === undefined || yearlyPrice === undefined) {
            return res.status(400).json({ error: 'Name, monthly price and yearly price are required' });
        }

        const plan = await prisma.plan.create({
            data: {
                name,
                monthlyPrice: Number(monthlyPrice),
                yearlyPrice: Number(yearlyPrice),
                order: Number(order) || 0,
                subUsersLimit: Number(subUsersLimit) || 3,
                linksLimit: Number(linksLimit) || 5,
                pricePerLinkMonthly: Number(pricePerLinkMonthly) || 0,
                pricePerLinkYearly: Number(pricePerLinkYearly) || 0,
                leadCaptureEnabled: !!leadCaptureEnabled,
                isPublic: isPublic !== undefined ? !!isPublic : true,
                description,
                enabledModules: enabledModules || []
            }
        });

        res.status(201).json(plan);
    } catch (e) {
        console.error('createPlan error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updatePlan = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { id } = req.params;
        const { name, monthlyPrice, yearlyPrice, order, subUsersLimit, linksLimit, pricePerLinkMonthly, pricePerLinkYearly, leadCaptureEnabled, isPublic, description, enabledModules } = req.body;

        const plan = await prisma.plan.update({
            where: { id },
            data: {
                name,
                monthlyPrice: monthlyPrice !== undefined ? Number(monthlyPrice) : undefined,
                yearlyPrice: yearlyPrice !== undefined ? Number(yearlyPrice) : undefined,
                order: order !== undefined ? Number(order) : undefined,
                subUsersLimit: subUsersLimit !== undefined ? Number(subUsersLimit) : undefined,
                linksLimit: linksLimit !== undefined ? Number(linksLimit) : undefined,
                pricePerLinkMonthly: pricePerLinkMonthly !== undefined ? Number(pricePerLinkMonthly) : undefined,
                pricePerLinkYearly: pricePerLinkYearly !== undefined ? Number(pricePerLinkYearly) : undefined,
                leadCaptureEnabled: leadCaptureEnabled !== undefined ? !!leadCaptureEnabled : undefined,
                isPublic: isPublic !== undefined ? !!isPublic : undefined,
                description,
                enabledModules: enabledModules !== undefined ? enabledModules : undefined
            }
        });

        res.json(plan);
    } catch (e) {
        console.error('updatePlan error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deletePlan = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { id } = req.params;

        // Check if any users are on this plan
        const usersCount = await prisma.user.count({ where: { planId: id } });
        if (usersCount > 0) {
            return res.status(400).json({ error: 'Cannot delete plan as it is assigned to users' });
        }

        await prisma.plan.delete({ where: { id } });

        res.json({ message: 'Plan deleted successfully' });
    } catch (e) {
        console.error('deletePlan error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getUpgradeRequests = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const requests = await prisma.planUpgradeRequest.findMany({
            include: {
                user: { select: { id: true, username: true, name: true, logoUrl: true, plan: true } },
                plan: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(requests);
    } catch (e) {
        console.error('getUpgradeRequests error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const handleUpgradeRequest = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { id } = req.params;
        const { status } = req.body; // APPROVED or REJECTED

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const request = await prisma.planUpgradeRequest.findUnique({
            where: { id },
            include: { plan: true }
        });

        if (!request) return res.status(404).json({ error: 'Request not found' });

        if (request.status !== 'PENDING') {
            return res.status(400).json({ error: 'Request already processed' });
        }

        if (status === 'APPROVED') {
            if (request.planId && request.plan) {
                const basePrice = request.billingCycle === 'YEARLY' ? request.plan.yearlyPrice : request.plan.monthlyPrice;
                const linkPrice = request.billingCycle === 'YEARLY' ? request.plan.pricePerLinkYearly : request.plan.pricePerLinkMonthly;
                const user = await prisma.user.findUnique({ where: { id: request.userId }, include: { _count: { select: { links: true } } } });
                const linksCount = user?._count?.links || 0;
                const amount = basePrice + (linksCount * linkPrice);

                await prisma.user.update({
                    where: { id: request.userId },
                    data: {
                        planId: request.planId,
                        billingCycle: request.billingCycle,
                        subscriptionAmount: amount,
                        subUsersLimit: request.plan.subUsersLimit,
                        linksLimit: request.plan.linksLimit
                    }
                });
            }
        }

        const updatedRequest = await prisma.planUpgradeRequest.update({
            where: { id },
            data: { status }
        });

        res.json({
            success: true,
            message: `Request ${status.toLowerCase()} successfully`,
            data: updatedRequest
        });
    } catch (e) {
        console.error('handleUpgradeRequest error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

