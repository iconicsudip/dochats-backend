import express from 'express';
import { getVapidPublicKey, subscribe } from '../controllers/pushController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.get('/vapidPublicKey', getVapidPublicKey);
router.post('/subscribe', subscribe as any);

export default router;
