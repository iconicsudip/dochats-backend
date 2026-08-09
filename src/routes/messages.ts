import express from 'express';
import { getMessages, sendMessage, markRead, getSuggestedReply } from '../controllers/messageController';
// Note: visitors don't use authentication, but admins do.
// I'll leave it as public for now, but in production we'd want more checks.
const router = express.Router();

router.get('/', getMessages as any);
router.post('/', sendMessage as any);
router.post('/mark-read', markRead as any);
router.get('/:conversationId/suggested-reply', getSuggestedReply as any);

export default router;
