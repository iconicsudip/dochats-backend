import express from 'express';
import { initPublicChat, trackWARedirect, getPublicPlans, getUrlPreview } from '../controllers/publicController';
import { getMessages, sendMessage, markRead } from '../controllers/messageController';

const router = express.Router();

router.get('/plans', getPublicPlans);
router.post('/init', initPublicChat as any);
router.post('/wa-redirect', trackWARedirect as any);
router.get('/messages', getMessages as any);
router.post('/messages', sendMessage as any);
router.post('/mark-read', markRead as any);
router.post('/preview', getUrlPreview as any);

export default router;
