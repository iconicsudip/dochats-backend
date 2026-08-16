import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { triggerAutomation } from './automation';

/**
 * Initializes all background cron jobs
 */
export const initCron = () => {
    // Check for "No Reply for 24h" every hour
    cron.schedule('0 * * * *', async () => {
        console.log('[Cron] Running 24h No-Reply check...');
        try {
            const twentyFourHoursAgo = new Date();
            twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

            // Find conversations that:
            // 1. Haven't had a message in 24 hours
            // 2. The last message was NOT from an admin
            // 3. Haven't already triggered the 24h notification for this gap
            const stalledConversations = await prisma.conversation.findMany({
                where: {
                    lastMessageAt: { lte: twentyFourHoursAgo },
                    noReplyTriggered: false,
                    messages: {
                        some: {} // Ensure there are messages
                    }
                },
                include: {
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 1
                    },
                    link: {
                        select: { creatorId: true }
                    }
                }
            });

            console.log(`[Cron] Found ${stalledConversations.length} potentially stalled conversations`);

            for (const conv of stalledConversations) {
                const lastMsg = conv.messages[0];
                
                // If the last message was from the visitor (not admin)
                if (lastMsg && !lastMsg.isFromAdmin) {
                    console.log(`[Cron] Triggering 24h no-reply automation for conversation ${conv.id}`);
                    
                    // Trigger automation
                    await triggerAutomation(conv.link.creatorId, 'no_reply_24h', {
                        conversationId: conv.id,
                        visitorName: conv.visitorName || 'Visitor',
                        visitorPhone: conv.visitorPhone,
                        visitorEmail: conv.visitorEmail,
                        lastMessage: lastMsg.content
                    });

                    // Mark as triggered so we don't spam
                    await prisma.conversation.update({
                        where: { id: conv.id },
                        data: { noReplyTriggered: true }
                    });
                }
            }
        } catch (error) {
            console.error('[Cron] 24h check failed:', error);
        }
    });

    // Check for Scheduled Tasks every minute
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const tasks = await prisma.scheduledTask.findMany({
                where: {
                    executeAt: { lte: now },
                    processed: false
                }
            });

            if (tasks.length === 0) return;

            console.log(`[Cron] Processing ${tasks.length} scheduled tasks...`);

            for (const task of tasks) {
                try {
                    const owner = await prisma.user.findUnique({
                        where: { id: task.ownerId },
                        select: { whatsappConfig: true, emailConfig: true, moduleConfig: true }
                    });

                    const waConfig = owner?.whatsappConfig as any;
                    const emailConfig = owner?.emailConfig as any;
                    const enabledModules = (owner?.moduleConfig?.enabledModules as string[]) || [];

                    // Gating
                    if ((task.action === 'send_whatsapp' && !enabledModules.includes('WHATSAPP')) ||
                        (task.action === 'send_email' && !enabledModules.includes('EMAIL'))) {
                        // Skip
                    } else {
                        const rule = await prisma.automationRule.findUnique({ where: { id: task.ruleId } });
                        if (!rule) throw new Error('Rule not found');
                        if (!rule.enabled) {
                            console.log(`[Cron] Skipping task for disabled rule: ${task.ruleId}`);
                            await prisma.scheduledTask.update({
                                where: { id: task.id },
                                data: { processed: true }
                            });
                            continue;
                        }
                        const config = rule.config as any;
                        
                        const { executeAction, executeFlow } = await import('./automation');
                        
                        if (task.action.startsWith('flow_node:')) {
                            const nodeId = task.action.split(':')[1];
                            console.log(`[Cron] Resuming flow ${task.ruleId} at node ${nodeId}`);
                            await executeFlow(rule, nodeId, task.data, waConfig, emailConfig, enabledModules, true);
                        } else {
                            await executeAction(task.ownerId, task.ruleId, 'SCHEDULED', task.action, task.data, waConfig, emailConfig, config);
                        }
                    }

                    await prisma.scheduledTask.update({
                        where: { id: task.id },
                        data: { processed: true }
                    });
                } catch (taskError) {
                    console.error(`[Cron] Failed to process task ${task.id}:`, taskError);
                }
            }
        } catch (error) {
            console.error('[Cron] Scheduled task processor failed:', error);
        }
    });

    console.log('[Cron] Background jobs initialized');
};
