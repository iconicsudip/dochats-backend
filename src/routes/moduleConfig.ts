import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { updateModuleConfig, getModuleConfig } from '../controllers/moduleConfigController';

const router = Router();

router.patch('/admin/:adminId', authenticate as any, updateModuleConfig as any);
router.get('/admin/:adminId', authenticate as any, getModuleConfig as any);

export default router;
