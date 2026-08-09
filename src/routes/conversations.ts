import express from 'express';
import { getConversations, downloadLeads, togglePinConversation, toggleArchiveConversation, deleteConversation } from '../controllers/conversationController';
import { authenticate } from '../middleware/auth';

const router = express.Router();
router.use(authenticate as any);

router.get('/', getConversations as any);
router.get('/download', downloadLeads as any);
router.patch('/:id/pin', togglePinConversation as any);
router.patch('/:id/archive', toggleArchiveConversation as any);
router.delete('/:id', deleteConversation as any);

export default router;
