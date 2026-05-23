import express from 'express';
import {
    getChatGroups,
    createChatGroup,
    updateChatGroup,
    deleteChatGroup,
    getGroupMessages,
    sendGroupMessage,
    getLinkableEntities,
    leaveChatGroup
} from '../controllers/chatGroupController';
import { authenticate } from '../middleware/auth';

const router = express.Router();
router.use(authenticate as any);

router.get('/', getChatGroups as any);
router.get('/linkable', getLinkableEntities as any);
router.post('/', createChatGroup as any);
router.put('/:id', updateChatGroup as any);
router.delete('/:id', deleteChatGroup as any);
router.delete('/:id/leave', leaveChatGroup as any);
router.get('/:groupId/messages', getGroupMessages as any);
router.post('/:groupId/messages', sendGroupMessage as any);

export default router;
