import express from 'express';
import { getConversations } from '../controllers/conversationController';
import { authenticate } from '../middleware/auth';

const router = express.Router();
router.use(authenticate as any);

router.get('/', getConversations as any);

export default router;
