import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getLeads, createLead, updateLeadStatus } from '../controllers/crmController';

const router = Router();

router.get('/', authenticate as any, getLeads as any);
router.post('/', authenticate as any, createLead as any);
router.patch('/:id/status', authenticate as any, updateLeadStatus as any);

export default router;
