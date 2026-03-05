import express from 'express';
import { getAllLinks, createLink, deleteLink, updateLink, getLinkReports } from '../controllers/linkController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.use(authenticate as any);

router.get('/', getAllLinks as any);
router.get('/reports', getLinkReports as any);
router.post('/', createLink as any);
router.put('/:id', updateLink as any);
router.delete('/:id', deleteLink as any);

export default router;
