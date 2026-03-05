import express from 'express';
import { initPublicChat, trackWARedirect } from '../controllers/publicController';
import { getMessages, sendMessage, markRead } from '../controllers/messageController';
import ogs from 'open-graph-scraper';

const router = express.Router();

router.post('/init', initPublicChat as any);
router.post('/wa-redirect', trackWARedirect as any);
router.get('/messages', getMessages as any);
router.post('/messages', sendMessage as any);
router.post('/mark-read', markRead as any);
router.post('/preview', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'Missing url' });
        const { result } = await ogs({ url, timeout: 5000 });
        if (result.success) {
            res.json({
                title: result.ogTitle || result.twitterTitle || null,
                description: result.ogDescription || result.twitterDescription || null,
                image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || null,
                url
            });
        } else {
            res.status(400).json({ error: 'Failed to scrape' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
