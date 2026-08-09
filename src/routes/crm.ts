import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { 
    getLeads, createLead, updateLeadStatus, updateLead, deleteLeads, bulkCreateLeads,
    updateLeadAssociations, getWorkspaceDeals, getWorkspaceTickets, getWorkspaceCompanies, getWorkspaceOrders,
    getLeadById, getLeadByPhone
} from '../controllers/crmController';

const router = Router();

router.get('/deals', authenticate as any, getWorkspaceDeals as any);
router.get('/tickets', authenticate as any, getWorkspaceTickets as any);
router.get('/companies', authenticate as any, getWorkspaceCompanies as any);
router.get('/orders', authenticate as any, getWorkspaceOrders as any);
router.get('/lead-by-phone', authenticate as any, getLeadByPhone as any);

router.get('/:id', authenticate as any, getLeadById as any);
router.get('/', authenticate as any, getLeads as any);
router.post('/', authenticate as any, createLead as any);
router.post('/bulk', authenticate as any, bulkCreateLeads as any);
router.patch('/:id/status', authenticate as any, updateLeadStatus as any);
router.patch('/:id/associations', authenticate as any, updateLeadAssociations as any);
router.patch('/:id', authenticate as any, updateLead as any);
router.delete('/', authenticate as any, deleteLeads as any);

export default router;

