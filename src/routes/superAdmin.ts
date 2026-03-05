import { Router } from 'express';
import { getAllAdmins, createAdmin, deleteAdmin, getSuperAdminStats, updateAdmin } from '../controllers/superAdminController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/admins', authenticate, getAllAdmins);
router.post('/admins', authenticate, createAdmin);
router.put('/admins/:id', authenticate, updateAdmin);
router.delete('/admins/:id', authenticate, deleteAdmin);
router.get('/stats', authenticate, getSuperAdminStats);

export default router;
