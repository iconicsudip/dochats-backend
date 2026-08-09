import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { triggerAutomation } from '../utils/automation';

// ─── Helper: build base where clause with RBAC ───────────────────────────────
const buildLeadWhere = (req: AuthRequest) => {
    const ownerId = req.user?.parentId || req.user?.userId;
    const isSubUser = req.user?.role === 'SUB_USER';
    const where: any = { ownerId: ownerId! };
    if (isSubUser) where.assignedTo = req.user!.userId;
    return where;
};


export const getLeads = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { page, limit, search, status, brief } = req.query;

        // Sub-users only see leads explicitly assigned to them
        const where: any = { ownerId: ownerId! };
        if (isSubUser) {
            where.assignedTo = req.user!.userId;
        }

        if (brief === 'true') {
            const leads = await prisma.crmLead.findMany({
                where,
                select: { id: true, name: true, email: true, phone: true },
                orderBy: { name: 'asc' }
            });
            return res.json(leads);
        }

        if (search && typeof search === 'string') {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { company: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (status && typeof status === 'string' && status !== 'ALL') {
            where.status = status;
        }

        if (page) {
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 10;
            const skip = (pageNum - 1) * limitNum;

            const [allSummaryLeads, data] = await Promise.all([
                prisma.crmLead.findMany({
                    where,
                    select: { status: true, value: true, lifecycleStage: true }
                }),
                prisma.crmLead.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limitNum
                })
            ]);

            const total = allSummaryLeads.length;
            const won = allSummaryLeads.filter(l => l.status === 'WON').length;
            const totalValue = allSummaryLeads.reduce((a, l) => a + (l.value || 0), 0);
            const customers = allSummaryLeads.filter(l => (l.lifecycleStage || '').toLowerCase() === 'customer').length;
            const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;
            const summary = { total, won, totalValue, customers, conversionRate };

            return res.json({
                data,
                total,
                summary,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            });
        }

        const leads = await prisma.crmLead.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });
        res.json(leads);
    } catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
};


export const createLead = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const { 
            name, phone, email, industry, source, value, notes, assignedTo,
            jobTitle, company, city, address, lifecycleStage,
            favoriteTopics, preferredChannels, communicationSubs, customFields
        } = req.body;
        
        // Initial activity log
        const initialActivity = [{
            id: 'init-' + Date.now(),
            type: 'NOTE',
            title: 'Lead Created',
            description: `Lead created via ${source || 'Manual CRM entry'}.`,
            date: new Date().toISOString()
        }];

        const lead = await prisma.crmLead.create({
            data: {
                ownerId: ownerId!,
                name,
                phone,
                email,
                industry,
                source,
                value: value ? parseInt(value) : 0,
                notes,
                status: 'NEW',
                assignedTo: assignedTo || req.user?.userId,
                jobTitle,
                company,
                city,
                address,
                lifecycleStage: lifecycleStage || 'Lead',
                favoriteTopics: favoriteTopics || ["AI Chatbots", "WhatsApp"],
                preferredChannels: preferredChannels || ["Email", "Phone", "WhatsApp"],
                communicationSubs: communicationSubs || { newsletter: true, marketing: true },
                customFields: customFields || {},
                activityTimeline: initialActivity,
                aiSummary: `Rahul is an executive at ${company || 'a top firm'} looking for advanced automation.`,
                aiInsights: {
                    sentiment: "Highly Positive 🔥",
                    suggestedFollowUps: ["Schedule product demo", "Send customized ROI proposal", "Invite to VIP newsletter"],
                    conversationSummary: "Expressed immediate budget availability for Q3 implementation."
                },
                associations: {
                    companies: company ? [{ name: company, primary: true }] : [{ name: "Acme Corp", primary: true }],
                    deals: [{ title: `Software License - ${name}`, amount: value ? parseInt(value) : 15000, stage: "New Leads" }],
                    tickets: [],
                    relationshipLabel: "Decision Maker"
                }
            }
        });

        // Trigger Automation: New Lead
        await triggerAutomation(ownerId!, 'new_lead', lead);

        res.json(lead);
    } catch (error) {
        console.error('Error creating lead:', error);
        res.status(500).json({ error: 'Failed to create lead' });
    }
};

export const updateLeadStatus = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { id } = req.params;
        const { status } = req.body;

        const where: any = { id, ownerId: ownerId! };
        if (isSubUser) where.assignedTo = req.user!.userId;

        const lead = await prisma.crmLead.findFirst({ where });
        if (!lead) return res.status(404).json({ error: 'Lead not found or not assigned to you' });

        const existingTimeline = Array.isArray(lead.activityTimeline) ? lead.activityTimeline : [];
        const newActivity = {
            id: 'stat-' + Date.now(),
            type: 'TASK',
            title: `Stage updated to ${status}`,
            description: `Pipeline stage changed to ${status}.`,
            date: new Date().toISOString(),
            status: 'COMPLETED'
        };

        await prisma.crmLead.update({
            where: { id },
            data: { 
                status,
                activityTimeline: [newActivity, ...existingTimeline]
            }
        });

        // Trigger Automation: Status Change
        await triggerAutomation(ownerId!, 'deal_status_change', { leadId: id, status });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating lead status:', error);
        res.status(500).json({ error: 'Failed to update lead status' });
    }
};


export const updateLead = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { id } = req.params;
        const updateData = req.body;

        const where: any = { id, ownerId: ownerId! };
        if (isSubUser) where.assignedTo = req.user!.userId;

        const lead = await prisma.crmLead.findFirst({ where });
        if (!lead) return res.status(404).json({ error: 'Lead not found or not assigned to you' });

        // Sub-users cannot change the assigned owner
        if (isSubUser) {
            delete updateData.assignedTo;
        }

        let existingTimeline = Array.isArray(lead.activityTimeline) ? lead.activityTimeline : [];
        if (updateData.newActivityItem) {
            existingTimeline = [updateData.newActivityItem, ...existingTimeline];
            delete updateData.newActivityItem;
        }

        const updated = await prisma.crmLead.update({
            where: { id },
            data: {
                ...updateData,
                value: updateData.value ? parseInt(updateData.value) : undefined,
                activityTimeline: existingTimeline
            }
        });

        res.json(updated);
    } catch (error) {
        console.error('Error updating lead:', error);
        res.status(500).json({ error: 'Failed to update lead' });
    }
};


export const deleteLeads = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { ids } = req.query; // ?ids=id1,id2
        if (!ids || typeof ids !== 'string') {
            return res.status(400).json({ error: 'No lead IDs provided' });
        }

        // Sub-users cannot delete leads — only admins can
        if (isSubUser) {
            return res.status(403).json({ error: 'Sub-users are not permitted to delete CRM records' });
        }

        const idList = ids.split(',').filter(Boolean);
        await prisma.crmLead.deleteMany({
            where: {
                ownerId: ownerId!,
                id: { in: idList }
            }
        });

        res.json({ success: true, deletedCount: idList.length });
    } catch (error) {
        console.error('Error deleting leads:', error);
        res.status(500).json({ error: 'Failed to delete leads' });
    }
};


export const bulkCreateLeads = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const { leads } = req.body;
        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ error: 'Invalid leads array' });
        }

        const createdLeads = [];
        for (const item of leads) {
            const initialActivity = [{
                id: 'import-' + Date.now() + Math.random(),
                type: 'NOTE',
                title: 'Imported Contact',
                description: `Imported via CSV/XLS bulk sync on ${new Date().toLocaleDateString()}.`,
                date: new Date().toISOString()
            }];

            const record = await prisma.crmLead.create({
                data: {
                    ownerId: ownerId!,
                    name: item.name || 'Unknown Contact',
                    phone: item.phone || '+91 00000 00000',
                    email: item.email || null,
                    company: item.company || 'External Corp',
                    jobTitle: item.jobTitle || 'Executive',
                    city: item.city || 'Bangalore',
                    address: item.address || '',
                    industry: item.industry || 'Technology',
                    source: item.source || 'Bulk Import',
                    value: item.value ? parseInt(item.value) : 25000,
                    status: item.status || 'NEW',
                    lifecycleStage: item.lifecycleStage || 'Lead',
                    favoriteTopics: item.favoriteTopics || ["Automation", "CRM Pipeline"],
                    preferredChannels: item.preferredChannels || ["Email", "WhatsApp"],
                    communicationSubs: { newsletter: true, marketing: true },
                    assignedTo: item.assignedTo || req.user?.userId,
                    activityTimeline: initialActivity,
                    aiSummary: `Imported professional from ${item.company || 'Enterprise Sector'}. Target ROI opportunity.`,
                    aiInsights: {
                        sentiment: "Highly Positive 🚀",
                        suggestedFollowUps: ["Initial welcome call", "Send product brochure"],
                        conversationSummary: "Bulk uploaded from partner contact roster."
                    },
                    associations: {
                        companies: [{ name: item.company || "Enterprise Corp", primary: true }],
                        deals: [{ title: `Import Deal - ${item.name}`, amount: item.value ? parseInt(item.value) : 25000, stage: item.status || "NEW" }],
                        tickets: [],
                        relationshipLabel: "Evaluator"
                    }
                }
            });
            createdLeads.push(record);
        }

        res.json({ success: true, count: createdLeads.length, leads: createdLeads });
    } catch (error) {
        console.error('Error bulk creating leads:', error);
        res.status(500).json({ error: 'Failed to bulk create leads' });
    }
};

// ─── Associations: update deals/tickets/companies per lead ────────────────────
export const updateLeadAssociations = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { id } = req.params;
        const { deals, tickets, companies } = req.body;

        const where: any = { id, ownerId: ownerId! };
        if (isSubUser) where.assignedTo = req.user!.userId;

        const lead = await prisma.crmLead.findFirst({ where });
        if (!lead) return res.status(404).json({ error: 'Lead not found or not assigned to you' });

        const existing: any = (lead.associations as any) || {};
        const updated = await prisma.crmLead.update({
            where: { id },
            data: {
                associations: {
                    ...existing,
                    ...(deals !== undefined ? { deals } : {}),
                    ...(tickets !== undefined ? { tickets } : {}),
                    ...(companies !== undefined ? { companies } : {}),
                }
            }
        });

        res.json(updated);
    } catch (error) {
        console.error('Error updating associations:', error);
        res.status(500).json({ error: 'Failed to update associations' });
    }
};

// ─── Workspace-level aggregate views ─────────────────────────────────────────

export const getWorkspaceDeals = async (req: AuthRequest, res: Response) => {
    try {
        const where = buildLeadWhere(req);
        const { page, limit, search } = req.query;

        const leads = await prisma.crmLead.findMany({
            where,
            select: { id: true, name: true, company: true, status: true, value: true, assignedTo: true, associations: true, createdAt: true }
        });

        let deals: any[] = [];
        for (const lead of leads) {
            const assoc: any = lead.associations || {};
            const leadDeals: any[] = assoc.deals || [];
            // Always include the primary deal from lead.value
            deals.push({
                id: `primary-${lead.id}`,
                leadId: lead.id,
                leadName: lead.name,
                company: lead.company || '',
                title: `${lead.company || lead.name} Opportunity`,
                value: lead.value,
                stage: lead.status,
                assignedTo: lead.assignedTo,
                createdAt: lead.createdAt,
                isPrimary: true
            });
            // Plus any manually added deals
            for (const d of leadDeals) {
                deals.push({ ...d, leadId: lead.id, leadName: lead.name, company: lead.company || '', assignedTo: lead.assignedTo, isPrimary: false });
            }
        }

        const totalPipeline = deals.reduce((acc, d) => acc + (d.value || 0), 0);
        const wonPipeline = deals.filter(d => (d.stage || '').toLowerCase() === 'won').reduce((acc, d) => acc + (d.value || 0), 0);
        const summary = { totalDeals: deals.length, totalPipeline, wonPipeline };

        if (search && typeof search === 'string') {
            const q = search.toLowerCase();
            deals = deals.filter(d => 
                (d.title || '').toLowerCase().includes(q) ||
                (d.company || '').toLowerCase().includes(q) ||
                (d.leadName || '').toLowerCase().includes(q)
            );
        }

        if (page) {
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 10;
            const total = deals.length;
            const data = deals.slice((pageNum - 1) * limitNum, pageNum * limitNum);

            return res.json({
                data,
                total,
                summary,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            });
        }

        res.json(deals);
    } catch (error) {
        console.error('Error fetching deals:', error);
        res.status(500).json({ error: 'Failed to fetch deals' });
    }
};

export const getWorkspaceTickets = async (req: AuthRequest, res: Response) => {
    try {
        const where = buildLeadWhere(req);
        const { page, limit, search } = req.query;

        const leads = await prisma.crmLead.findMany({
            where,
            select: { id: true, name: true, company: true, assignedTo: true, associations: true }
        });

        let tickets: any[] = [];
        for (const lead of leads) {
            const assoc: any = lead.associations || {};
            const leadTickets: any[] = assoc.tickets || [];
            for (const t of leadTickets) {
                tickets.push({ ...t, leadId: lead.id, leadName: lead.name, company: lead.company || '', assignedTo: lead.assignedTo });
            }
        }

        const openTicketsCount = tickets.filter(t => (t.status || '').toLowerCase() !== 'resolved').length;
        const highPriorityCount = tickets.filter(t => (t.priority || '').toLowerCase() === 'high' && (t.status || '').toLowerCase() !== 'resolved').length;
        const resolvedCount = tickets.filter(t => (t.status || '').toLowerCase() === 'resolved').length;
        const summary = { totalTickets: tickets.length, openTicketsCount, highPriorityCount, resolvedCount };

        if (search && typeof search === 'string') {
            const q = search.toLowerCase();
            tickets = tickets.filter(t => 
                (t.title || '').toLowerCase().includes(q) ||
                (t.company || '').toLowerCase().includes(q) ||
                (t.leadName || '').toLowerCase().includes(q) ||
                (t.priority || '').toLowerCase().includes(q)
            );
        }

        if (page) {
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 10;
            const total = tickets.length;
            const data = tickets.slice((pageNum - 1) * limitNum, pageNum * limitNum);

            return res.json({
                data,
                total,
                summary,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            });
        }

        res.json(tickets);
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
};

export const getWorkspaceCompanies = async (req: AuthRequest, res: Response) => {
    try {
        const where = buildLeadWhere(req);
        const { page, limit, search } = req.query;

        const leads = await prisma.crmLead.findMany({
            where,
            select: { id: true, name: true, company: true, assignedTo: true, associations: true, value: true, status: true, industry: true, city: true, notes: true }
        });

        // Aggregate unique companies, merge contacts under same company name
        const companyMap: Record<string, any> = {};
        for (const lead of leads) {
            const assoc: any = lead.associations || {};
            const companies: any[] = assoc.companies || [];
            for (const c of companies) {
                const key = (c.name || '').toLowerCase().trim();
                if (!key) continue;
                if (!companyMap[key]) {
                    companyMap[key] = { 
                        name: c.name, 
                        domain: c.domain || null, 
                        owner: c.owner || lead.assignedTo || null,
                        industry: c.industry || lead.industry || 'Technology',
                        type: c.type || 'Prospect',
                        city: c.city || lead.city || '',
                        state: c.state || '',
                        postalCode: c.postalCode || '',
                        employees: c.employees || 0,
                        revenue: c.revenue || lead.value || 0,
                        timezone: c.timezone || 'UTC+5:30 (IST)',
                        description: c.description || lead.notes || '',
                        linkedin: c.linkedin || '',
                        contacts: [], 
                        totalValue: 0, 
                        leadIds: [] 
                    };
                }
                companyMap[key].contacts.push(lead.name);
                companyMap[key].totalValue += lead.value || 0;
                companyMap[key].leadIds.push(lead.id);
            }
            // Also capture company from lead.company field
            if (lead.company && !companyMap[lead.company.toLowerCase().trim()]) {
                companyMap[lead.company.toLowerCase().trim()] = {
                    name: lead.company,
                    domain: null,
                    owner: lead.assignedTo || null,
                    industry: lead.industry || 'Technology',
                    type: 'Prospect',
                    city: lead.city || '',
                    state: '',
                    postalCode: '',
                    employees: 0,
                    revenue: lead.value || 0,
                    timezone: 'UTC+5:30 (IST)',
                    description: lead.notes || '',
                    linkedin: '',
                    contacts: [lead.name],
                    totalValue: lead.value || 0,
                    leadIds: [lead.id]
                };
            } else if (lead.company) {
                const key = lead.company.toLowerCase().trim();
                if (!companyMap[key].leadIds.includes(lead.id)) {
                    companyMap[key].contacts.push(lead.name);
                    companyMap[key].totalValue += lead.value || 0;
                    companyMap[key].leadIds.push(lead.id);
                }
            }
        }

        let companyList = Object.values(companyMap);

        const totalRevenue = companyList.reduce((acc, c) => acc + (c.revenue || c.totalValue || 0), 0);
        const totalEmployees = companyList.reduce((acc, c) => acc + (c.employees || 0), 0);
        const summary = { totalCompanies: companyList.length, totalRevenue, totalEmployees };

        if (search && typeof search === 'string') {
            const q = search.toLowerCase();
            companyList = companyList.filter(c => 
                (c.name || '').toLowerCase().includes(q) ||
                (c.industry || '').toLowerCase().includes(q) ||
                (c.city || '').toLowerCase().includes(q)
            );
        }

        if (page) {
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 10;
            const total = companyList.length;
            const data = companyList.slice((pageNum - 1) * limitNum, pageNum * limitNum);

            return res.json({
                data,
                total,
                summary,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            });
        }

        res.json(companyList);
    } catch (error) {
        console.error('Error fetching companies:', error);
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
};

// Orders = bookings associated with CRM leads
export const getWorkspaceOrders = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { page, limit, search, status } = req.query;

        const where: any = { ownerId: ownerId!, leadId: { not: null } };
        if (isSubUser) where.assignedTo = req.user!.userId;

        const baseWhere: any = { ownerId: ownerId!, leadId: { not: null } };
        if (isSubUser) baseWhere.assignedTo = req.user!.userId;

        if (search && typeof search === 'string') {
            where.OR = [
                { service: { contains: search, mode: 'insensitive' } },
                { clientName: { contains: search, mode: 'insensitive' } },
                { lead: { name: { contains: search, mode: 'insensitive' } } },
                { lead: { company: { contains: search, mode: 'insensitive' } } }
            ];
        }

        if (status && typeof status === 'string' && status !== 'all') {
            where.status = status.toUpperCase();
        }

        if (page) {
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 10;
            const skip = (pageNum - 1) * limitNum;

            const [totalCount, completedCount, data] = await Promise.all([
                prisma.booking.count({ where: baseWhere }),
                prisma.booking.count({ where: { ...baseWhere, status: 'COMPLETED' } }),
                prisma.booking.findMany({
                    where,
                    orderBy: { date: 'desc' },
                    skip,
                    take: limitNum,
                    include: { lead: { select: { name: true, company: true } } }
                })
            ]);

            const summary = { totalOrders: totalCount, completedOrders: completedCount };
            const matchingTotal = await prisma.booking.count({ where });

            return res.json({
                data,
                total: matchingTotal,
                summary,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(matchingTotal / limitNum)
            });
        }

        const orders = await prisma.booking.findMany({
            where,
            orderBy: { date: 'desc' },
            include: { lead: { select: { name: true, company: true } } }
        });

        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
};

export const getLeadById = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';

        const lead = await prisma.crmLead.findUnique({
            where: { id }
        });

        if (!lead || lead.ownerId !== ownerId || (isSubUser && lead.assignedTo !== req.user!.userId)) {
            return res.status(404).json({ error: 'Contact not found or unauthorized' });
        }

        res.json(lead);
    } catch (error) {
        console.error('Error fetching lead by id:', error);
        res.status(500).json({ error: 'Failed to fetch lead' });
    }
};

export const getLeadByPhone = async (req: AuthRequest, res: Response) => {
    try {
        const { phone } = req.query;
        const ownerId = req.user?.parentId || req.user?.userId;
        if (!phone) return res.status(400).json({ error: 'Phone query parameter is required' });

        const lead = await prisma.crmLead.findFirst({
            where: { 
                phone: phone as string,
                ownerId: ownerId
            }
        });

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        res.json(lead);
    } catch (error) {
        console.error('Error fetching lead by phone:', error);
        res.status(500).json({ error: 'Failed to fetch lead' });
    }
};

