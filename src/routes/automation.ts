import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { 
    getRules, createRule, updateRule, toggleRule, 
    getWhatsAppTemplates, deleteRule, runRule, getAutomationLogs,
    getMetadata
} from '../controllers/automationController';

const router = Router();

router.get('/', authenticate as any, getRules as any);
router.get('/metadata', authenticate as any, getMetadata as any);
router.post('/', authenticate as any, createRule as any);
router.put('/:id', authenticate as any, updateRule as any);
router.patch('/:id/toggle', authenticate as any, toggleRule as any);
router.post('/:id/run', authenticate as any, runRule as any);
router.get('/:id/logs', authenticate as any, getAutomationLogs as any);
router.delete('/:id', authenticate as any, deleteRule as any);
router.get('/whatsapp-templates', authenticate as any, getWhatsAppTemplates as any);

export default router;
