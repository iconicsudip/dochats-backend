import { prisma } from '../lib/prisma';
import { sendWhatsAppMessage, buildParams } from './whatsapp';
import { createCrmLead, updateCrmStatus } from './crm';
import { bookFollowup, createAutomationBooking } from './bookings';
import { notifyAgent } from './notifications';
import { sendEmail } from './email';

/**
 * Triggers automation rules for a specific event
 */
export const triggerAutomation = async (ownerId: string, trigger: string, data: any) => {
    try {
        let rules = await prisma.automationRule.findMany({
            where: { ownerId, trigger, enabled: true }
        });

        // Filter rules by formId if applicable
        if (data.formId) {
            rules = rules.filter(rule => {
                const config = rule.config as any;
                return !config?.formId || config.formId === data.formId;
            });
        }

        if (rules.length === 0) return;

        const owner = await prisma.user.findUnique({
            where: { id: ownerId },
            select: { whatsappConfig: true, emailConfig: true, moduleConfig: true }
        });

        const waConfig = owner?.whatsappConfig as any;
        const emailConfig = owner?.emailConfig as any;
        const enabledModules = (owner?.moduleConfig?.enabledModules as string[]) || [];

        for (const rule of rules) {
            const ruleConfig = rule.config as any;
            
            // Normalize data: Flatten nested formData and ensure common fields exist
            const enrichedData = { ...data };
            if (data.formData && typeof data.formData === 'object') {
                Object.assign(enrichedData, data.formData);
            }

            // Normalize common contact fields for easier mapping
            const emailKey = ruleConfig?.emailField || Object.keys(enrichedData).find(k => k.toLowerCase() === 'email' || k.toLowerCase().includes('email_address'));
            const phoneKey = ruleConfig?.phoneField || Object.keys(enrichedData).find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('whatsapp') || k.toLowerCase().includes('mobile'));
            const nameKey = Object.keys(enrichedData).find(k => k.toLowerCase() === 'name' || k.toLowerCase().includes('client_name') || k.toLowerCase().includes('guest_name') || k.toLowerCase() === 'full_name');

            if (emailKey && enrichedData[emailKey]) enrichedData.email = enrichedData[emailKey];
            if (phoneKey && enrichedData[phoneKey]) enrichedData.phone = enrichedData[phoneKey];
            if (nameKey && enrichedData[nameKey]) enrichedData.name = enrichedData[nameKey];
            // New Tree-based Flow
            const flow = rule.flow as any;
            const hasActionNodes = flow?.nodes && Object.values(flow.nodes).some((n: any) => n.type === 'ACTION');
            
            if (rule.flow && hasActionNodes) {
                if (flow.startNodeId) {
                    await executeFlow(rule, flow.startNodeId, enrichedData, waConfig, emailConfig, enabledModules);
                }
            } else {
                // Legacy Linear Actions or Flow with no actions
                if (rule.delay && rule.delay > 0) {
                    // Schedule for later
                    const executeAt = new Date();
                    executeAt.setMinutes(executeAt.getMinutes() + rule.delay);

                    for (const action of (rule.actions as string[])) {
                        if (action === 'send_whatsapp' && !enabledModules.includes('WHATSAPP')) continue;
                        if (action === 'send_email' && !enabledModules.includes('EMAIL')) continue;

                        await prisma.scheduledTask.create({
                            data: {
                                ownerId,
                                ruleId: rule.id,
                                action,
                                data: enrichedData,
                                executeAt
                            }
                        });

                        await logAutomation(rule.id, ownerId, trigger, action, 'DELAYED', `Scheduled for ${executeAt.toLocaleString()}`, enrichedData);
                    }
                } else {
                    await processRule(rule, enrichedData, waConfig, emailConfig, enabledModules);
                }
            }
            
            await prisma.automationRule.update({
                where: { id: rule.id },
                data: {
                    runs: { increment: 1 },
                    lastRunAt: new Date()
                }
            });
        }
    } catch (error) {
        console.error('[Automation] Trigger error:', error);
    }
};

/**
 * Recursive Flow Execution Engine
 */
export const executeFlow = async (rule: any, nodeId: string, data: any, waConfig: any, emailConfig: any, enabledModules: string[], isResume = false) => {
    try {
        const flow = rule.flow as any;
        const node = flow.nodes[nodeId];
        if (!node) return;

        console.log(`[Automation] Executing Node: ${nodeId} (${node.type}) ${isResume ? '[RESUMING]' : ''}`);

        let nextNodeId: string | null = null;

        switch (node.type) {
            case 'TRIGGER':
                nextNodeId = node.next;
                break;

            case 'ACTION':
                // Check for node-level delay - SKIP if we are resuming
                const delay = node.config?.delayMinutes || 0;
                if (delay > 0 && !isResume) {
                    const executeAt = new Date(Date.now() + delay * 60000);
                    await prisma.scheduledTask.create({
                        data: {
                            ruleId: rule.id,
                            ownerId: rule.ownerId,
                            action: `flow_node:${nodeId}`, // Resume THIS node
                            data,
                            executeAt,
                        }
                    });
                    await logAutomation(rule.id, rule.ownerId, rule.trigger, node.action, 'DELAYED', `Action paused for ${delay} mins. Will resume at ${executeAt.toLocaleTimeString()}`, data);
                    return; // Stop current execution, cron will resume
                }

                try {
                    // Module Gating
                    if ((node.action === 'send_whatsapp' && !enabledModules.includes('WHATSAPP')) ||
                        (node.action === 'send_email' && !enabledModules.includes('EMAIL'))) {
                        await logAutomation(rule.id, rule.ownerId, rule.trigger, node.action, 'FAILED', `Action skipped: ${node.action.split('_')[1].toUpperCase()} module not enabled for this plan`, data);
                        nextNodeId = node.onFailure || node.next;
                    } else {
                        await executeAction(rule.ownerId, rule.id, rule.trigger, node.action, data, waConfig, emailConfig, node.config);
                        nextNodeId = node.onSuccess || node.next;
                    }
                } catch (error) {
                    nextNodeId = node.onFailure || node.next;
                }
                break;

            case 'CONDITION':
                const isTrue = evaluateCondition(node.config, data);
                await logAutomation(rule.id, rule.ownerId, rule.trigger, 'CONDITION', 'SUCCESS', `Condition [${node.config.field}] evaluated to ${isTrue ? 'TRUE' : 'FALSE'}`, data);
                nextNodeId = isTrue ? node.onTrue : node.onFalse;
                break;

            case 'DELAY':
                if (node.config?.delayMinutes && node.next) {
                    const executeAt = new Date();
                    executeAt.setMinutes(executeAt.getMinutes() + node.config.delayMinutes);

                    await prisma.scheduledTask.create({
                        data: {
                            ownerId: rule.ownerId,
                            ruleId: rule.id,
                            action: `flow_node:${node.next}`, // Special prefix to indicate flow resumption
                            data,
                            executeAt
                        }
                    });

                    console.log(`[Automation] Scheduled flow resumption for node ${node.next} at ${executeAt.toLocaleString()}`);
                    return; // Stop current execution; it will resume via cron
                }
                nextNodeId = node.next;
                break;
        }

        const ACTION_TYPES = ['send_whatsapp', 'send_email', 'create_crm_lead', 'book_followup', 'notify_agent', 'update_crm_status', 'create_booking'];

        if (nextNodeId) {
            const isActionType = ACTION_TYPES.includes(nextNodeId);
            
            if (isActionType) {
                console.log(`[Automation] Executing Direct Failover Action: ${nextNodeId}`);
                await executeAction(rule.ownerId, rule.id, rule.trigger, nextNodeId, data, waConfig, emailConfig, node.config);
            } else if (flow.nodes[nextNodeId]) {
                await executeFlow(rule, nextNodeId, data, waConfig, emailConfig, enabledModules);
            } else {
                console.warn(`[Automation] nextNodeId ${nextNodeId} not found in flow nodes or actions.`);
            }
        }
    } catch (error) {
        console.error('[Automation] Flow execution error:', error);
    }
};

/**
 * Condition Evaluator
 */
const evaluateCondition = (config: any, data: any) => {
    const { field, operator, value } = config;
    const actualValue = data[field];

    switch (operator) {
        case 'exists':
            return actualValue !== undefined && actualValue !== null && actualValue !== '';
        case 'equals':
            return String(actualValue) === String(value);
        case 'contains':
            return String(actualValue).toLowerCase().includes(String(value).toLowerCase());
        case 'not_equals':
            return String(actualValue) !== String(value);
        default:
            return false;
    }
};

/**
 * Processes a single rule's actions (Legacy)
 */
export const processRule = async (rule: any, data: any, waConfig: any, emailConfig: any, enabledModules: string[]) => {
    const actions = rule.actions as string[];
    const config = rule.config as any;
    
    for (const action of actions) {
        try {
            // Module Gating
            if (action === 'send_whatsapp' && !enabledModules.includes('WHATSAPP')) continue;
            if (action === 'send_email' && !enabledModules.includes('EMAIL')) continue;

            await executeAction(rule.ownerId, rule.id, rule.trigger, action, data, waConfig, emailConfig, config);
        } catch (actionError) {
            console.error(`[Automation] Action ${action} failed:`, actionError);
        }
    }
};

/**
 * Helper to execute a single action and log it
 */
export const executeAction = async (ownerId: string, ruleId: string, trigger: string, action: string, data: any, waConfig: any, emailConfig: any, config: any) => {
    try {
        switch (action) {
            case 'create_crm_lead':
                await createCrmLead(ownerId, data);
                break;
            case 'create_booking':
                await createAutomationBooking(ownerId, data, config?.variableMapping);
                break;
            case 'send_whatsapp':
                if (waConfig?.apiKey && waConfig?.phoneNumberId) {
                    await handleWhatsAppAction(trigger, data, waConfig, config);
                } else {
                    throw new Error('WhatsApp skipped: No config found for owner');
                }
                break;
            case 'send_email':
                if (config?.emailTemplateId) {
                    const template = await prisma.emailTemplate.findUnique({
                        where: { id: config.emailTemplateId }
                    });
                    if (template && (data.email || data.Email)) {
                        const recipient = data.email || data.Email;
                        if (recipient) {
                            // Variable replacement with mapping
                            let content = template.content;
                            let subject = template.subject;
                            // Robust Variable Replacement
                            const mapping = config.variableMapping || {};
                            
                            // Helper to escape regex special chars
                            const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                            // 1. Map via explicit mapping
                            Object.entries(mapping).forEach(([templateVar, triggerVar]) => {
                                const val = data[triggerVar as string];
                                if (val !== undefined && val !== null) {
                                    const escapedVar = escapeRegExp(templateVar);
                                    // Match {{var}}, {{ var }}, and handle case-insensitivity for the tag itself
                                    const placeholder = new RegExp(`\\{\\{\\s*${escapedVar}\\s*\\}\\}`, 'gi');
                                    content = content.replace(placeholder, String(val));
                                    subject = subject.replace(placeholder, String(val));
                                }
                            });

                            // 2. Fallback to direct key matching for any unmapped variables
                            Object.keys(data).forEach(key => {
                                if (data[key] !== undefined && data[key] !== null) {
                                    const escapedKey = escapeRegExp(key);
                                    const placeholder = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'gi');
                                    content = content.replace(placeholder, String(data[key]));
                                    subject = subject.replace(placeholder, String(data[key]));
                                }
                            });

                            // 3. Last resort: if no email field found, try to find ANY field that looks like an email
                            let finalRecipient = recipient;
                            if (!finalRecipient) {
                                const emailField = Object.keys(data).find(k => k.toLowerCase().includes('email') || (typeof data[k] === 'string' && data[k].includes('@')));
                                if (emailField) finalRecipient = data[emailField];
                            }

                            if (!finalRecipient) throw new Error('Email skipped: No recipient email address found in data');

                            await sendEmail(
                                finalRecipient, 
                                subject, 
                                content,
                                emailConfig?.fromEmail ? { email: emailConfig.fromEmail, name: emailConfig.fromName } : undefined
                            );
                        } else {
                            throw new Error('Email skipped: Recipient email address missing in data');
                        }
                    } else {
                        throw new Error('Email skipped: Template not found or no recipient');
                    }
                } else {
                    throw new Error('Email skipped: No emailTemplateId configured in rule');
                }
                break;
            case 'book_followup':
                await bookFollowup(ownerId, data);
                break;
            case 'notify_agent':
                await notifyAgent(ownerId, trigger, data);
                break;
            case 'update_crm_status':
                if (data.leadId && data.newStatus) {
                    await updateCrmStatus(data.leadId, data.newStatus);
                }
                break;
            default:
                console.log(`[Automation] Unknown action type: ${action}`);
        }
        await logAutomation(ruleId, ownerId, trigger, action, 'SUCCESS', 'Action executed successfully', data);
    } catch (error: any) {
        await logAutomation(ruleId, ownerId, trigger, action, 'FAILED', error.message || 'Action failed', data);
        throw error;
    }
};

/**
 * WhatsApp Action Handler: Maps triggers to templates with variable support
 */
const handleWhatsAppAction = async (trigger: string, data: any, waConfig: any, ruleConfig: any) => {
    let phone = data.phone || data.Phone || data.whatsapp || data.WhatsApp;
    
    // Fallback: search for any field that looks like a phone number
    if (!phone) {
        const phoneField = Object.keys(data).find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('whatsapp') || k.toLowerCase().includes('mobile') || k.toLowerCase().includes('contact'));
        if (phoneField) phone = data[phoneField];
    }

    if (!phone) throw new Error('No phone number found in event data');

    const templateName = ruleConfig?.whatsappTemplate;
    if (!templateName) throw new Error('No WhatsApp template selected for this rule');

    // 1. Map via explicit mapping if exists
    let mappedVars: any[] = [];
    if (ruleConfig?.variableMapping) {
        // WhatsApp templates use positional variables {{1}}, {{2}}, etc.
        // We expect mapping like { "1": "form_field_name", "2": "other_field" }
        const mapping = ruleConfig.variableMapping;
        Object.keys(mapping).sort((a, b) => Number(a) - Number(b)).forEach(pos => {
            const field = mapping[pos];
            mappedVars.push(data[field] || "");
        });
    } else if (ruleConfig?.variables) {
        // Legacy variable support
        mappedVars = ruleConfig.variables.map((v: string) => data[v] || v);
    }

    const params = buildParams(mappedVars);

    await sendWhatsAppMessage({
        apiKey: waConfig.apiKey,
        phoneNumberId: waConfig.phoneNumberId
    }, phone, templateName, params);
};

/**
 * Helper to log automation activity
 */
const logAutomation = async (ruleId: string, ownerId: string, trigger: string, action: string, status: 'SUCCESS' | 'FAILED' | 'DELAYED', message: string, details: any) => {
    try {
        await prisma.$transaction([
            prisma.automationLog.create({
                data: {
                    ruleId,
                    ownerId,
                    trigger,
                    action,
                    status,
                    message,
                    details: details || {}
                }
            }),
            prisma.automationRule.update({
                where: { id: ruleId },
                data: { 
                    runs: { increment: 1 },
                    lastRunAt: new Date()
                }
            })
        ]);
    } catch (e) {
        console.error('[Automation] Log error:', e);
    }
};
