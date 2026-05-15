import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import axios from 'axios';
import { getWhatsAppTemplates, sendWhatsAppMessage } from '../utils/whatsapp';

/**
 * Get WhatsApp Configuration
 */
export const getWhatsAppConfig = async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        res.json(user?.whatsappConfig || {});
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
};

/**
 * Update WhatsApp Configuration
 */
export const updateWhatsAppConfig = async (req: AuthRequest, res: Response) => {
    try {
        const { whatsappConfig } = req.body;
        await prisma.user.update({
            where: { id: req.user!.userId },
            data: { whatsappConfig }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update config' });
    }
};

/**
 * Get OAuth State for Embedded Signup
 */
export const getAuthState = async (req: AuthRequest, res: Response) => {
    // Generate a random state for security
    const state = Math.random().toString(36).substring(7);
    res.json({ state });
};

/**
 * Handle Embedded Signup Callback
 */
export const handleCallback = async (req: AuthRequest, res: Response) => {
    try {
        const { code, wabaId: sessionWabaId, phoneNumberId: sessionPhoneNumberId, businessId: sessionBusinessId } = req.body;
        
        // Simulation of exchange logic
        // In production, we use process.env.META_APP_ID and process.env.META_APP_SECRET
        // We prefer the IDs passed from the session info if available
        const wabaId = sessionWabaId || 'waba_mock_' + Math.random().toString(36).substring(7);
        const phoneNumberId = sessionPhoneNumberId || 'phone_mock_' + Math.random().toString(36).substring(7);
        const businessId = sessionBusinessId || sessionWabaId || 'biz_mock_' + Math.random().toString(36).substring(7);

        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });

        const currentConfig = (user?.whatsappConfig as any) || {};
        const updatedConfig = {
            ...currentConfig,
            wabaId,
            phoneNumberId,
            businessId,
            businessAccountId: wabaId,
            isConnected: true,
            linkedAt: new Date()
        };

        await prisma.user.update({
            where: { id: req.user!.userId },
            data: { whatsappConfig: updatedConfig }
        });

        res.json({ 
            success: true, 
            message: 'WhatsApp account linked successfully',
            data: updatedConfig
        });
    } catch (error) {
        console.error('Callback error:', error);
        res.status(500).json({ error: 'Failed to link WhatsApp account' });
    }
};

/**
 * Send WhatsApp Message
 */
export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { to, templateName, components, phoneNumberId } = req.body;
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        if (!config?.apiKey) {
            return res.status(400).json({ error: 'WhatsApp API Key missing' });
        }

        const result = await sendWhatsAppMessage(
            { ...config, phoneNumberId: phoneNumberId || config.phoneNumberId },
            to,
            templateName,
            components
        );

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.response?.data || 'Failed to send message' });
    }
};

/**
 * Get WhatsApp Phone Numbers
 */
export const getPhones = async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        if (!config?.wabaId || !config?.apiKey) {
            return res.status(400).json({ error: 'WABA ID or API Key missing' });
        }

        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${config.wabaId}/phone_numbers`;
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
        });

        res.json(response.data.data);
    } catch (error: any) {
        res.status(500).json({ error: error.response?.data || 'Failed to fetch phones' });
    }
};

/**
 * Get WhatsApp Business Profile
 */
export const getBusinessProfile = async (req: AuthRequest, res: Response) => {
    try {
        const { phoneId } = req.params;
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${phoneId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`;
        
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
        });

        res.json(response.data.data[0] || {});
    } catch (error: any) {
        res.status(500).json({ error: error.response?.data || 'Failed to fetch business profile' });
    }
};

/**
 * Update WhatsApp Business Profile
 */
export const updateBusinessProfile = async (req: AuthRequest, res: Response) => {
    try {
        const { phoneId } = req.params;
        const profileData = req.body;
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${phoneId}/whatsapp_business_profile`;
        
        const response = await axios.post(url, {
            messaging_product: 'whatsapp',
            ...profileData
        }, {
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
        });

        res.json(response.data);
    } catch (error: any) {
        res.status(500).json({ error: error.response?.data || 'Failed to update business profile' });
    }
};

/**
 * Get WhatsApp Analytics
 */
export const getAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        if (!config?.wabaId || !config?.apiKey) {
            return res.status(400).json({ error: 'WABA ID missing' });
        }

        // Fetch basic analytics for the WABA
        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${config.wabaId}?fields=message_template_analytics,daily_analytics_v2`;
        
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
        });

        res.json(response.data);
    } catch (error: any) {
        res.status(500).json({ error: error.response?.data || 'Failed to fetch analytics' });
    }
};

/**
 * Get WhatsApp Templates
 */
export const getTemplates = async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        if (!config?.businessAccountId || !config?.apiKey) {
            return res.status(400).json({ error: 'Business Account ID or API Key missing' });
        }

        const templates = await getWhatsAppTemplates(config);
        res.json(templates);
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
};

/**
 * Create WhatsApp Template
 */
export const createTemplate = async (req: AuthRequest, res: Response) => {
    try {
        const { name, category, language, components } = req.body;
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${config.businessAccountId}/message_templates`;
        
        const response = await axios.post(url, {
            name,
            category,
            language,
            components
        }, {
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
        });

        res.json(response.data);
    } catch (error: any) {
        res.status(500).json({ error: error.response?.data || 'Failed to create template' });
    }
};

/**
 * Delete WhatsApp Template
 */
export const deleteTemplate = async (req: AuthRequest, res: Response) => {
    try {
        const { templateName } = req.params;
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { whatsappConfig: true }
        });
        
        const config = user?.whatsappConfig as any;
        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${config.businessAccountId}/message_templates?name=${templateName}`;
        
        await axios.delete(url, {
            headers: { 'Authorization': `Bearer ${config.apiKey}` }
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.response?.data || 'Failed to delete template' });
    }
};
