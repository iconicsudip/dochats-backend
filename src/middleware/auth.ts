import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
    user?: { userId: string, role: string, parentId: string | null };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

        const token = authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Unauthorized' });

        const payload = verifyToken(token) as any;
        if (!payload || !payload.userId) return res.status(401).json({ error: 'Unauthorized' });

        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: { id: true, role: true, parentId: true }
        });

        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        req.user = { userId: user.id, role: user.role, parentId: user.parentId };
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
};
