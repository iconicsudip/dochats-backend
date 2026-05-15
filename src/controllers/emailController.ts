import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { upsertSesTemplate, deleteSesTemplate } from '../utils/email';

/**
 * Helper to check if user has EMAIL module enabled
 */
const checkEmailAccess = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { 
            moduleConfig: true,
            plan: true
        }
    });
    
    if (!user) return false;
    if (user.role === 'SUPER_ADMIN') return true;
    
    const planModules = (user.plan as any)?.enabledModules || [];
    const manualModules = (user.moduleConfig as any)?.enabledModules || [];
    const combined = new Set([...planModules, ...manualModules]);
    
    return combined.has('EMAIL');
};

export const getTemplates = async (req: AuthRequest, res: Response) => {
    try {
        if (!(await checkEmailAccess(req.user!.userId))) {
            return res.status(403).json({ error: 'Email module not enabled' });
        }

        const { syncedOnly } = req.query;

        const templates = await prisma.emailTemplate.findMany({
            where: { 
                ownerId: req.user!.userId,
                ...(syncedOnly === 'true' ? { sesSynced: true } : {})
            },
            orderBy: { updatedAt: 'desc' }
        });
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch email templates' });
    }
};

export const createTemplate = async (req: AuthRequest, res: Response) => {
    try {
        if (!(await checkEmailAccess(req.user!.userId))) {
            return res.status(403).json({ error: 'Email module not enabled' });
        }

        const { name, subject, content, design } = req.body;
        
        // 1. Create in local DB first
        const template = await prisma.emailTemplate.create({
            data: {
                name,
                subject,
                content,
                design,
                ownerId: req.user!.userId
            }
        });

        // 2. Try to sync with SES
        const sesTemplateName = `mm_${template.id}`;
        let sesSynced = false;
        try {
            await upsertSesTemplate(sesTemplateName, subject, content);
            sesSynced = true;
        } catch (sesError) {
            console.error("[SES] Auto-sync failed:", sesError);
        }

        // 3. Update sync status
        const updatedTemplate = await prisma.emailTemplate.update({
            where: { id: template.id },
            data: { sesSynced, sesTemplateName }
        });

        res.status(201).json(updatedTemplate);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create email template' });
    }
};

export const updateTemplate = async (req: AuthRequest, res: Response) => {
    try {
        if (!(await checkEmailAccess(req.user!.userId))) {
            return res.status(403).json({ error: 'Email module not enabled' });
        }

        const { id } = req.params;
        const { name, subject, content, design } = req.body;
        
        const template = await prisma.emailTemplate.findFirst({
            where: { id, ownerId: req.user!.userId }
        });

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Try to sync with SES
        const sesTemplateName = template.sesTemplateName || `mm_${template.id}`;
        let sesSynced = false;
        try {
            await upsertSesTemplate(sesTemplateName, subject, content);
            sesSynced = true;
        } catch (sesError) {
            console.error("[SES] Update-sync failed:", sesError);
        }

        await prisma.emailTemplate.update({
            where: { id },
            data: { 
                name, 
                subject, 
                content, 
                design,
                sesSynced,
                sesTemplateName
            }
        });

        res.json({ success: true, sesSynced });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update email template' });
    }
};

export const syncTemplate = async (req: AuthRequest, res: Response) => {
    try {
        if (!(await checkEmailAccess(req.user!.userId))) {
            return res.status(403).json({ error: 'Email module not enabled' });
        }

        const { id } = req.params;
        const template = await prisma.emailTemplate.findFirst({
            where: { id, ownerId: req.user!.userId }
        });

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const sesTemplateName = template.sesTemplateName || `mm_${template.id}`;
        await upsertSesTemplate(sesTemplateName, template.subject, template.content);

        await prisma.emailTemplate.update({
            where: { id },
            data: { sesSynced: true, sesTemplateName }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("[SES] Manual sync failed:", error);
        res.status(500).json({ error: 'Failed to sync with AWS SES' });
    }
};

export const deleteTemplate = async (req: AuthRequest, res: Response) => {
    try {
        if (!(await checkEmailAccess(req.user!.userId))) {
            return res.status(403).json({ error: 'Email module not enabled' });
        }

        const { id } = req.params;
        const template = await prisma.emailTemplate.findFirst({
            where: { id, ownerId: req.user!.userId }
        });

        if (template && template.sesTemplateName) {
            try {
                await deleteSesTemplate(template.sesTemplateName);
            } catch (sesError) {
                console.error("[SES] Deletion failed:", sesError);
            }
        }

        await prisma.emailTemplate.deleteMany({
            where: { id, ownerId: req.user!.userId }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete email template' });
    }
};
