import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

export const getRules = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const rules = await prisma.automationRule.findMany({
            where: { ownerId: ownerId! },
            include: {
                logs: {
                    orderBy: { executedAt: 'desc' },
                    take: 5
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(rules);
    } catch (error) {
        console.error('Error fetching automation rules:', error);
        res.status(500).json({ error: 'Failed to fetch automation rules' });
    }
};

export const getMetadata = async (req: AuthRequest, res: Response) => {
    try {
        // Return available variables for each trigger type
        const metadata = {
            new_lead: { variables: ['name', 'email', 'phone', 'lead_source', 'interest'] },
            booking_created: { variables: ['name', 'email', 'phone', 'booking_date', 'booking_time', 'service_name'] },
            booking_confirmed: { variables: ['name', 'email', 'phone', 'booking_date', 'booking_time', 'service_name'] },
            deal_status_change: { variables: ['name', 'deal_name', 'old_status', 'new_status', 'value'] },
            no_reply_24h: { variables: ['name', 'email', 'phone', 'last_message_time'] },
            booking_cancelled: { variables: ['name', 'email', 'phone', 'booking_date', 'booking_time', 'service_name'] },
            form_submitted: { variables: ['name', 'email', 'phone', 'form_name', 'response_data'] },
        };
        res.json(metadata);
    } catch (error) {
        console.error('Error fetching automation metadata:', error);
        res.status(500).json({ error: 'Failed to fetch metadata' });
    }
};


export const createRule = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { name, trigger, actions, config, flow } = req.body;
        
        const rule = await prisma.automationRule.create({
            data: {
                ownerId: ownerId!,
                name,
                trigger,
                actions: actions || [],
                config: config || {},
                flow: flow || null
            }
        });
        res.json(rule);
    } catch (error) {
        console.error('Error creating rule:', error);
        res.status(500).json({ error: 'Failed to create automation rule' });
    }
};

export const updateRule = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { id } = req.params;
        const { name, trigger, actions, config, flow, delay } = req.body;
        
        const rule = await prisma.automationRule.updateMany({
            where: { id, ownerId: ownerId! },
            data: {
                name,
                trigger,
                actions,
                config,
                flow,
                delay
            }
        });

        if (rule.count === 0) return res.status(404).json({ error: 'Rule not found or unauthorized' });

        const updatedRule = await prisma.automationRule.findUnique({ where: { id } });
        res.json(updatedRule);
    } catch (error) {
        console.error('Error updating rule:', error);
        res.status(500).json({ error: 'Failed to update automation rule' });
    }
};

export const toggleRule = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { id } = req.params;
        const { enabled } = req.body;
        
        await prisma.automationRule.updateMany({
            where: { id, ownerId: ownerId! },
            data: { enabled }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error toggling rule:', error);
        res.status(500).json({ error: 'Failed to toggle rule' });
    }
};

export const deleteRule = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { id } = req.params;
        
        await prisma.automationRule.deleteMany({
            where: { id, ownerId: ownerId! }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting rule:', error);
        res.status(500).json({ error: 'Failed to delete rule' });
    }
};

export const getWhatsAppTemplates = async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user?.userId },
            select: { whatsappConfig: true }
        });

        if (!user?.whatsappConfig) {
            return res.status(400).json({ error: 'WhatsApp is not configured for this account' });
        }

        const config = user.whatsappConfig as any;
        if (!config.apiKey || !config.businessAccountId) {
            return res.status(400).json({ error: 'WhatsApp configuration is incomplete (API Key or Business ID missing)' });
        }

        const { getWhatsAppTemplates: fetchTemplates } = await import('../utils/whatsapp');
        const templates = await fetchTemplates(config);
        
        res.json(templates);
    } catch (error: any) {
        console.error('Error fetching WA templates:', error);
        res.status(500).json({ error: 'Failed to fetch WhatsApp templates' });
    }
};

export const runRule = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { id } = req.params;
        const { dataItems } = req.body; // Array of objects like [{ name: "John", email: "..." }]

        if (!dataItems || !Array.isArray(dataItems) || dataItems.length === 0) {
            return res.status(400).json({ error: 'No data items provided for manual run' });
        }

        const rule = await prisma.automationRule.findFirst({
            where: { id, ownerId: ownerId! }
        });

        if (!rule) return res.status(404).json({ error: 'Rule not found' });

        const owner = await prisma.user.findUnique({
            where: { id: ownerId },
            select: { whatsappConfig: true, emailConfig: true, moduleConfig: true }
        });

        const { executeFlow } = await import('../utils/automation');
        const waConfig = owner?.whatsappConfig as any;
        const emailConfig = owner?.emailConfig as any;
        const enabledModules = (owner?.moduleConfig?.enabledModules as string[]) || [];

        // Execute for each data item
        for (const data of dataItems) {
            // Enriched data with rule context mapping
            const enrichedData = { ...data };
            const ruleConfig = rule.config as any;
            if (ruleConfig?.emailField && data[ruleConfig.emailField]) enrichedData.email = data[ruleConfig.emailField];
            if (ruleConfig?.phoneField && data[ruleConfig.phoneField]) enrichedData.phone = data[ruleConfig.phoneField];

            if (rule.flow && (rule.flow as any).startNodeId) {
                await executeFlow(rule, (rule.flow as any).startNodeId, enrichedData, waConfig, emailConfig, enabledModules);
            }
        }

        res.json({ success: true, count: dataItems.length });
    } catch (error) {
        console.error('Error running rule manually:', error);
        res.status(500).json({ error: 'Failed to run automation rule' });
    }
};

export const getAutomationLogs = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { id } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const rule = await prisma.automationRule.findFirst({
            where: { id, ownerId: ownerId! }
        });

        if (!rule) return res.status(404).json({ error: 'Rule not found' });

        const [logs, total] = await Promise.all([
            prisma.automationLog.findMany({
                where: { ruleId: id },
                orderBy: { executedAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.automationLog.count({
                where: { ruleId: id }
            })
        ]);

        res.json({
            logs,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Error fetching automation logs:', error);
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
};
