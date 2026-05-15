import express from 'express';
import { getAnalytics } from '../controllers/analyticsController';
import { authenticate } from '../middleware/auth';

const router = express.Router();
router.use(authenticate as any);

router.get('/', getAnalytics as any);

export default router;
