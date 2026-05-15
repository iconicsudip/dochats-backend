import axios from 'axios';

interface WhatsAppConfig {
    apiKey: string;
    phoneNumberId: string;
}

/**
 * Fetches approved message templates from Meta Business Account
 */
export const getWhatsAppTemplates = async (config: WhatsAppConfig & { businessAccountId: string }) => {
    try {
        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${config.businessAccountId}/message_templates`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${config.apiKey}`
            }
        });
        
        // Return only APPROVED templates that are compatible
        return response.data.data.filter((t: any) => t.status === 'APPROVED');
    } catch (error: any) {
        console.error('[WhatsApp] Fetch templates error:', error.response?.data || error.message);
        throw error;
    }
};

/**
 * Sends a WhatsApp message using the Meta Cloud API
 */
export const sendWhatsAppMessage = async (config: WhatsAppConfig, to: string, templateName: string, components: any[] = []) => {
    try {
        const cleanPhone = to.replace(/\D/g, ''); 
        const formattedTo = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

        const url = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}/${config.phoneNumberId}/messages`;
        
        const data = {
            messaging_product: 'whatsapp',
            to: formattedTo,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: 'en_US' // Default, can be made dynamic later
                },
                components
            }
        };

        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`[WhatsApp] Message sent successfully to ${formattedTo}. SID: ${response.data.messages[0]?.id}`);
        return response.data;
    } catch (error: any) {
        console.error('[WhatsApp] Send error:', error.response?.data || error.message);
        throw error;
    }
};

/**
 * Helper to build template parameters
 */
export const buildParams = (values: string[]) => {
    return [
        {
            type: 'body',
            parameters: values.map(v => ({ type: 'text', text: v }))
        }
    ];
};
