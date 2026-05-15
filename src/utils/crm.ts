import { prisma } from '../lib/prisma';

/**
 * Creates a new lead in the CRM from automation data
 */
export const createCrmLead = async (ownerId: string, data: any) => {
    try {
        const name = data.name || data.Name || data.visitorName || 'New Lead';
        const phone = data.phone || data.Phone || data.visitorPhone || '';
        const email = data.email || data.Email || '';
        const source = data.source || 'Automation';

        // Check if lead already exists for this owner
        const existingLead = await prisma.crmLead.findFirst({
            where: { ownerId, phone }
        });

        if (existingLead) {
            console.log(`[CRM] Lead with phone ${phone} already exists for owner ${ownerId}`);
            return existingLead;
        }

        const lead = await prisma.crmLead.create({
            data: {
                ownerId,
                name,
                phone,
                email,
                source,
                status: 'NEW'
            }
        });

        console.log(`[CRM] Created new lead: ${lead.name} (${lead.id})`);
        return lead;
    } catch (error) {
        console.error('[CRM] Create lead error:', error);
        throw error;
    }
};

/**
 * Updates an existing lead's status
 */
export const updateCrmStatus = async (leadId: string, newStatus: string) => {
    try {
        await prisma.crmLead.update({
            where: { id: leadId },
            data: { status: newStatus as any }
        });
        console.log(`[CRM] Updated lead ${leadId} status to ${newStatus}`);
    } catch (error) {
        console.error('[CRM] Update status error:', error);
        throw error;
    }
};
