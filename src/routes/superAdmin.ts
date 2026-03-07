import { Router } from 'express';
import { getAllAdmins, createAdmin, deleteAdmin, getSuperAdminStats, updateAdmin, getAllPlans, createPlan, updatePlan, deletePlan, getUpgradeRequests, handleUpgradeRequest } from '../controllers/superAdminController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/admins', authenticate, getAllAdmins);
router.post('/admins', authenticate, createAdmin);
router.put('/admins/:id', authenticate, updateAdmin);
router.delete('/admins/:id', authenticate, deleteAdmin);
router.get('/stats', authenticate, getSuperAdminStats);

// Plan Routes
router.get('/plans', authenticate, getAllPlans);
router.post('/plans', authenticate, createPlan);
router.put('/plans/:id', authenticate, updatePlan);
router.delete('/plans/:id', authenticate, deletePlan);
router.get('/upgrade-requests', authenticate, getUpgradeRequests);
router.post('/upgrade-requests/:id/handle', authenticate, handleUpgradeRequest);

export default router;

