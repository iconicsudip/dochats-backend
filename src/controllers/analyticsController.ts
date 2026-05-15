import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(isSameOrAfter);
dayjs.extend(relativeTime);

export const getAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get admin ID
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const adminId = user?.role === 'SUB_USER' ? user.parentId : userId;
        if (!adminId) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        const now = dayjs();
        const startOfMonth = now.startOf('month').toDate();
        const startOfWeek = now.startOf('week').toDate();

        // 1. KPI Data
        const leadsThisMonth = await prisma.crmLead.count({
            where: { ownerId: adminId, createdAt: { gte: startOfMonth } }
        });

        const bookingsThisMonth = await prisma.booking.count({
            where: { ownerId: adminId, createdAt: { gte: startOfMonth } }
        });

        const automationRules = await prisma.automationRule.findMany({
            where: { ownerId: adminId }
        });
        const automationRuns = automationRules.reduce((acc, rule) => acc + (rule.runs || 0), 0);

        const wonDealsThisMonth = await prisma.crmLead.findMany({
            where: { ownerId: adminId, status: 'WON', updatedAt: { gte: startOfMonth } }
        });
        const revenueEst = wonDealsThisMonth.reduce((acc, lead) => acc + (lead.value || 0), 0);

        // 2. Funnel Data
        const totalConversations = await prisma.conversation.count({
            where: { link: { creatorId: adminId } }
        });
        const totalLeads = await prisma.crmLead.count({ where: { ownerId: adminId } });
        const qualifiedLeads = await prisma.crmLead.count({
            where: { ownerId: adminId, status: { in: ['QUALIFIED', 'PROPOSAL', 'WON'] } }
        });
        const totalBookings = await prisma.booking.count({ where: { ownerId: adminId } });
        const totalWon = await prisma.crmLead.count({ where: { ownerId: adminId, status: 'WON' } });

        const funnel = [
            { stage: 'AI Chat Visitors', count: totalConversations, color: '#3b82f6' },
            { stage: 'Leads Captured', count: totalLeads, color: '#a855f7' },
            { stage: 'CRM Qualified', count: qualifiedLeads, color: '#f59e0b' },
            { stage: 'Bookings Made', count: totalBookings, color: '#00df9a' },
            { stage: 'Deals Won', count: totalWon, color: '#22c55e' }
        ];

        // 3. Top Sources (Mocked based on bookings source or hardcoded for now)
        const bookingsWithSource = await prisma.booking.groupBy({
            by: ['source'],
            where: { ownerId: adminId },
            _count: true
        });
        let totalBookingSources = bookingsWithSource.reduce((acc, b) => acc + b._count, 0) || 1;
        const topSources = bookingsWithSource.map(b => ({
            label: b.source || 'Manual',
            value: Math.round((b._count / totalBookingSources) * 100),
            color: b.source === 'AI Chat' ? '#00df9a' : (b.source === 'Smart Link' ? '#3b82f6' : '#a855f7')
        }));

        // Provide defaults if empty
        if (topSources.length === 0) {
            topSources.push(
                { label: 'AI Chat', value: 45, color: '#00df9a' },
                { label: 'Smart Links', value: 28, color: '#3b82f6' },
                { label: 'Manual', value: 27, color: '#a855f7' }
            );
        }

        // 4. Weekly Bookings
        const bookingsThisWeek = await prisma.booking.findMany({
            where: { ownerId: adminId, createdAt: { gte: startOfWeek } }
        });

        const weeklyMap: Record<string, number> = { 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0, 'Sun': 0 };
        bookingsThisWeek.forEach(b => {
            const dayName = dayjs(b.createdAt).format('ddd');
            if (weeklyMap[dayName] !== undefined) {
                weeklyMap[dayName]++;
            }
        });
        const weeklyBookings = Object.entries(weeklyMap).map(([day, val]) => ({ day, val }));

        // 5. Activity Feed
        const rawActivities: any[] = [];
        
        const recentLeads = await prisma.crmLead.findMany({ where: { ownerId: adminId }, orderBy: { createdAt: 'desc' }, take: 5 });
        recentLeads.forEach(l => rawActivities.push({ id: `lead_${l.id}`, type: 'lead', text: 'New lead added', name: l.name, time: l.createdAt, color: '#00df9a' }));

        const recentBookings = await prisma.booking.findMany({ where: { ownerId: adminId }, orderBy: { createdAt: 'desc' }, take: 5 });
        recentBookings.forEach(b => rawActivities.push({ id: `booking_${b.id}`, type: 'booking', text: 'Appointment booked', name: b.clientName, time: b.createdAt, color: '#3b82f6' }));

        const recentConversations = await prisma.conversation.findMany({ where: { link: { creatorId: adminId } }, orderBy: { createdAt: 'desc' }, take: 5 });
        recentConversations.forEach(c => rawActivities.push({ id: `chat_${c.id}`, type: 'chat', text: 'Live chat started', name: c.visitorName || 'Anonymous', time: c.createdAt, color: '#a855f7' }));

        rawActivities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        const activityFeed = rawActivities.slice(0, 5).map(a => ({
            ...a,
            time: dayjs(a.time).fromNow()
        }));

        res.json({
            kpi: {
                revenueEst,
                leadsThisMonth,
                bookingsThisMonth,
                automationRuns
            },
            funnel,
            topSources,
            weeklyBookings,
            activityFeed
        });
    } catch (error) {
        console.error('getAnalytics error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
