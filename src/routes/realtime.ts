import express from 'express';
import { handleSSERealtime, sendTypingStatus } from '../controllers/realtimeController';

const router = express.Router();

router.get('/', handleSSERealtime as any);
router.post('/typing', sendTypingStatus as any);

export default router;
