import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

export const updateModuleConfig = async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        const { adminId } = req.params;
        const { enabledModules } = req.body;
        
        const config = await prisma.adminModuleConfig.upsert({
            where: { adminId },
            update: { enabledModules },
            create: { adminId, enabledModules }
        });
        
        res.json(config);
    } catch (error) {
        console.error('Error updating module config:', error);
        res.status(500).json({ error: 'Failed to update module config' });
    }
};

export const getModuleConfig = async (req: AuthRequest, res: Response) => {
    try {
        const { adminId } = req.params;
        const config = await prisma.adminModuleConfig.findUnique({
            where: { adminId }
        });
        res.json(config);
    } catch (error) {
        console.error('Error fetching module config:', error);
        res.status(500).json({ error: 'Failed to fetch module config' });
    }
};
