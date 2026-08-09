import express from 'express';
import { authenticate } from '../middleware/auth';
import { getCampaigns, createCampaign, sendCampaign, deleteCampaign } from '../controllers/campaignController';

const router = express.Router();

router.get('/', authenticate as any, getCampaigns as any);
router.post('/', authenticate as any, createCampaign as any);
router.post('/:id/send', authenticate as any, sendCampaign as any);
router.delete('/:id', authenticate as any, deleteCampaign as any);

export default router;
