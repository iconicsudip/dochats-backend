import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { Role } from '../enums';
import crypto from 'crypto';

// Initialize Razorpay
const Razorpay = require('razorpay');

const getRazorpay = () => {
    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
};

// ==================== ADMIN ENDPOINTS ====================

/**
 * Get current subscription status for the logged-in admin
 */
export const getSubscriptionStatus = async (req: any, res: Response) => {
    try {
        const userId = req.user.userId;

        const defaultAmount = Number(process.env.DEFAULT_SUBSCRIPTION_AMOUNT) || 999;

        const [subscription, user] = await Promise.all([
            prisma.subscription.findFirst({
                where: { userId },
                orderBy: { endDate: 'desc' },
                include: { payment: true }
            }),
            prisma.user.findUnique({ where: { id: userId } })
        ]);

        const currentAmount = (user as any)?.subscriptionAmount || defaultAmount;

        if (!subscription) {
            return res.json({
                hasSubscription: false,
                status: 'NO_SUBSCRIPTION',
                defaultAmount: currentAmount
            });
        }

        const now = new Date();
        const daysRemaining = Math.ceil((subscription.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const isOverdue = subscription.endDate < now;

        // Auto-update status if overdue
        if (isOverdue && subscription.status === 'ACTIVE') {
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: { status: 'OVERDUE' }
            });
            subscription.status = 'OVERDUE';
        }

        res.json({
            hasSubscription: true,
            subscription: {
                id: subscription.id,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                amount: subscription.amount,
                status: subscription.status,
                daysRemaining: Math.max(0, daysRemaining),
                isOverdue,
                showWarning: daysRemaining <= 3 && daysRemaining > 0,
                payment: subscription.payment ? {
                    id: subscription.payment.id,
                    status: subscription.payment.status,
                    paidAt: subscription.payment.paidAt
                } : null
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get payment history for the logged-in admin
 */
export const getPaymentHistory = async (req: any, res: Response) => {
    try {
        const userId = req.user.userId;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [subscriptions, total] = await Promise.all([
            prisma.subscription.findMany({
                where: { userId },
                include: { payment: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.subscription.count({ where: { userId } })
        ]);

        const bills = subscriptions.map((sub: any) => ({
            id: sub.id,
            startDate: sub.startDate,
            endDate: sub.endDate,
            amount: sub.amount,
            status: sub.status,
            payment: sub.payment ? {
                id: sub.payment.id,
                status: sub.payment.status,
                paidAt: sub.payment.paidAt,
                razorpayPaymentId: sub.payment.razorpayPaymentId
            } : null
        }));

        res.json({
            data: bills,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Create a Razorpay order for payment
 */
export const createPaymentOrder = async (req: any, res: Response) => {
    try {
        const userId = req.user.userId;

        // Get user's subscription amount
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const defaultAmount = Number(process.env.DEFAULT_SUBSCRIPTION_AMOUNT) || 999;
        const amount = (user as any).subscriptionAmount || defaultAmount;

        // Find the current/latest subscription
        let currentSub = await prisma.subscription.findFirst({
            where: { userId },
            orderBy: { endDate: 'desc' },
            include: { payment: true }
        });

        const now = new Date();
        let subscription: any;

        if (!currentSub || currentSub.payment?.status === 'PAID') {
            // Create new subscription period
            const startDate = now;
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + 30);

            subscription = await prisma.subscription.create({
                data: {
                    userId,
                    startDate,
                    endDate,
                    amount,
                    status: 'ACTIVE'
                }
            });
        } else if (currentSub.payment?.status === 'PENDING') {
            // Re-use the existing pending subscription
            subscription = currentSub;
        } else {
            // Overdue/expired — create new one from today
            const startDate = now;
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + 30);

            subscription = await prisma.subscription.create({
                data: {
                    userId,
                    startDate,
                    endDate,
                    amount,
                    status: 'ACTIVE'
                }
            });
        }

        // Create Razorpay order
        const razorpay = getRazorpay();
        const order = await razorpay.orders.create({
            amount: amount * 100, // Razorpay accepts amount in paise
            currency: 'INR',
            receipt: `sub_${subscription.id}`,
            notes: {
                subscriptionId: subscription.id,
                userId
            }
        });

        // Create or update payment record
        if (subscription.payment) {
            await prisma.payment.update({
                where: { id: subscription.payment.id },
                data: {
                    razorpayOrderId: order.id,
                    amount,
                    status: 'PENDING'
                }
            });
        } else {
            await prisma.payment.create({
                data: {
                    subscriptionId: subscription.id,
                    razorpayOrderId: order.id,
                    amount,
                    status: 'PENDING'
                }
            });
        }

        res.json({
            orderId: order.id,
            amount: amount * 100,
            currency: 'INR',
            subscriptionId: subscription.id,
            keyId: process.env.RAZORPAY_KEY_ID
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
};

/**
 * Verify Razorpay payment and activate subscription
 */
export const verifyPayment = async (req: any, res: Response) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment data' });
        }

        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
            .update(body)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        // Find payment by order ID
        const payment = await prisma.payment.findUnique({
            where: { razorpayOrderId: razorpay_order_id },
            include: { subscription: true }
        });

        if (!payment) {
            return res.status(404).json({ error: 'Payment record not found' });
        }

        const now = new Date();

        // Calculate new period dates
        // If paying early, extend from current end date
        // If paying late (overdue), start from today
        const currentSub = payment.subscription;
        let newStartDate: Date;
        let newEndDate: Date;

        if (currentSub.endDate > now) {
            // Early payment — period is extended by 30 days from current end date
            newStartDate = currentSub.startDate;
            newEndDate = new Date(currentSub.endDate);
            newEndDate.setDate(newEndDate.getDate() + 30);
        } else {
            // Late/overdue payment — start fresh from today
            newStartDate = now;
            newEndDate = new Date(now);
            newEndDate.setDate(newEndDate.getDate() + 30);
        }

        // Update payment as PAID
        await prisma.payment.update({
            where: { id: payment.id },
            data: {
                razorpayPaymentId: razorpay_payment_id,
                status: 'PAID',
                paidAt: now
            }
        });

        // Activate subscription
        await prisma.subscription.update({
            where: { id: currentSub.id },
            data: {
                status: 'ACTIVE',
                startDate: newStartDate,
                endDate: newEndDate
            }
        });

        // Mark any previous overdue/expired subscriptions
        await prisma.subscription.updateMany({
            where: {
                userId: currentSub.userId,
                id: { not: currentSub.id },
                status: { in: ['OVERDUE'] }
            },
            data: { status: 'EXPIRED' }
        });

        res.json({
            success: true,
            subscription: {
                id: currentSub.id,
                startDate: newStartDate,
                endDate: newEndDate,
                status: 'ACTIVE'
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Payment verification failed' });
    }
};

// ==================== SUPER ADMIN ENDPOINTS ====================

/**
 * Get all payments across all admins (Super Admin only)
 */
export const getAllPayments = async (req: any, res: Response) => {
    try {
        if (req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20));
        const skip = (page - 1) * limit;
        const search = req.query.search as string;
        const statusFilter = req.query.status as string;

        const where: any = {};

        if (search) {
            where.user = {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { username: { contains: search, mode: 'insensitive' } }
                ]
            };
        }

        if (statusFilter && statusFilter !== 'ALL') {
            if (statusFilter === 'PAID') {
                where.payment = { status: 'PAID' };
            } else if (statusFilter === 'PENDING') {
                where.OR = [
                    { payment: null },
                    { payment: { status: 'PENDING' } }
                ];
            } else {
                where.status = statusFilter; // ACTIVE, OVERDUE, EXPIRED
            }
        }

        const [subscriptions, total] = await Promise.all([
            prisma.subscription.findMany({
                where,
                include: {
                    user: { select: { id: true, username: true, name: true, logoUrl: true } },
                    payment: true
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.subscription.count({ where })
        ]);

        const payments = (subscriptions as any[]).map((sub: any) => ({
            id: sub.id,
            admin: sub.user,
            startDate: sub.startDate,
            endDate: sub.endDate,
            amount: sub.amount,
            subscriptionStatus: sub.status,
            payment: sub.payment ? {
                id: sub.payment.id,
                status: sub.payment.status,
                paidAt: sub.payment.paidAt,
                razorpayPaymentId: sub.payment.razorpayPaymentId
            } : null
        }));

        // Summary stats — computed from all records, not just current page
        const allSubs = await prisma.subscription.findMany({
            include: { payment: true }
        }) as any[];

        const totalRevenue = allSubs
            .filter((s: any) => s.payment?.status === 'PAID')
            .reduce((sum: number, s: any) => sum + s.amount, 0);

        const pendingPayments = allSubs.filter((s: any) =>
            s.status === 'OVERDUE' || (s.payment?.status === 'PENDING')
        ).length;

        const activeSubscriptions = allSubs.filter((s: any) => s.status === 'ACTIVE' && s.payment?.status === 'PAID').length;

        res.json({
            data: payments,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            stats: {
                totalRevenue,
                pendingPayments,
                activeSubscriptions,
                totalBills: total
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Set subscription amount for an admin (Super Admin only)
 */
export const setSubscriptionAmount = async (req: any, res: Response) => {
    try {
        if (req.user.role !== Role.SUPER_ADMIN) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { adminId, amount } = req.body;
        if (!adminId || !amount) return res.status(400).json({ error: 'Missing data' });

        await prisma.user.update({
            where: { id: adminId },
            data: { subscriptionAmount: Number(amount) } as any
        });

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
