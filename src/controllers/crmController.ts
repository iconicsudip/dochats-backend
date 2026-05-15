import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { triggerAutomation } from '../utils/automation';

export const getLeads = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const leads = await prisma.crmLead.findMany({
            where: { ownerId: ownerId! },
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
        const ownerId = req.user?.userId;
        const { name, phone, email, industry, source, value, notes } = req.body;
        
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
                assignedTo: req.user?.userId
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
        const ownerId = req.user?.userId;
        const { id } = req.params;
        const { status } = req.body;
        
        await prisma.crmLead.updateMany({
            where: { id, ownerId: ownerId! },
            data: { status }
        });

        // Trigger Automation: Status Change
        await triggerAutomation(ownerId!, 'deal_status_change', { leadId: id, status });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating lead status:', error);
        res.status(500).json({ error: 'Failed to update lead status' });
    }
};
