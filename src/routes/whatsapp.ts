import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { 
    getWhatsAppConfig, 
    updateWhatsAppConfig, 
    getTemplates, 
    createTemplate, 
    deleteTemplate,
    getPhones,
    getAuthState,
    handleCallback,
    sendMessage,
    getBusinessProfile,
    updateBusinessProfile,
    getAnalytics
} from '../controllers/whatsappController';

const router = Router();

// Auth / Embedded Signup
router.get('/auth/state', authenticate as any, getAuthState);
router.post('/auth/callback', authenticate as any, handleCallback);

// Config
router.get('/config', authenticate as any, getWhatsAppConfig);
router.put('/config', authenticate as any, updateWhatsAppConfig);

// Messaging
router.post('/messages', authenticate as any, sendMessage);

// Phone Numbers
router.get('/phones', authenticate as any, getPhones);

// Business Profile
router.get('/profile/:phoneId', authenticate as any, getBusinessProfile);
router.post('/profile/:phoneId', authenticate as any, updateBusinessProfile);

// Analytics
router.get('/analytics', authenticate as any, getAnalytics);

// Templates
router.get('/templates', authenticate as any, getTemplates);
router.post('/templates', authenticate as any, createTemplate);
router.delete('/templates/:templateName', authenticate as any, deleteTemplate);

export default router;
