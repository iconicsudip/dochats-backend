import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as emailController from '../controllers/emailController';

const router = Router();

router.use(authenticate);

router.get('/templates', emailController.getTemplates);
router.post('/templates', emailController.createTemplate);
router.put('/templates/:id', emailController.updateTemplate);
router.post('/templates/:id/sync', emailController.syncTemplate);
router.delete('/templates/:id', emailController.deleteTemplate);

export default router;
