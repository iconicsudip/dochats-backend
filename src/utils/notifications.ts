import { prisma } from '../lib/prisma';

/**
 * Creates an in-app notification for the agent/admin
 */
export const notifyAgent = async (ownerId: string, trigger: string, data: any) => {
    try {
        let title = 'New Automation Alert';
        let message = `An automation was triggered by ${trigger}`;

        switch (trigger) {
            case 'form_submitted':
                title = 'New Form Submission';
                message = `You have a new submission from ${data.clientName || data.name || 'a visitor'}`;
                break;
            case 'crm_status_change':
                title = 'Lead Status Updated';
                message = `Lead ${data.name || 'Unknown'} is now ${data.status}`;
                break;
            case 'booking_created':
                title = 'New Booking Created';
                message = `A new booking was created for ${data.clientName || 'Visitor'}`;
                break;
            case 'booking_confirmed':
                title = 'Booking Confirmed';
                message = `${data.clientName || 'Client'} confirmed a booking for ${data.date ? new Date(data.date).toLocaleDateString() : 'scheduled date'}`;
                break;
            case 'no_reply_24h':
                title = '24h No-Reply Alert';
                message = `Visitor ${data.visitorName || 'Visitor'} hasn't received a reply in 24 hours.`;
                break;
        }

        const notification = await prisma.notification.create({
            data: {
                ownerId,
                title,
                message,
                type: 'INFO',
                isRead: false
            }
        });

        console.log(`[Notifications] Sent notification to agent ${ownerId}: ${title}`);
        return notification;
    } catch (error) {
        console.error('[Notifications] Create notification error:', error);
        throw error;
    }
};
