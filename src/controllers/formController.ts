import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { triggerAutomation } from '../utils/automation';

/**
 * Get all forms for the current user
 */
export const getForms = async (req: AuthRequest, res: Response) => {
    try {
        const forms = await prisma.customForm.findMany({
            where: { ownerId: req.user!.userId },
            include: {
                _count: {
                    select: { responses: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(forms);
    } catch (e) {
        console.error('getForms error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get a single form (public or private)
 */
export const getForm = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const form = await prisma.customForm.findUnique({
            where: { id },
            include: {
                owner: {
                    select: { name: true, logoUrl: true }
                }
            }
        });

        if (!form) return res.status(404).json({ error: 'Form not found' });
        if (!form.isActive) return res.status(403).json({ error: 'Form is currently inactive' });

        res.json(form);
    } catch (e) {
        console.error('getForm error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Create a new form
 */
export const createForm = async (req: AuthRequest, res: Response) => {
    try {
        const { title, description, fields, integrationConfig, addToCrm, design } = req.body;
        
        if (!title || !fields || !Array.isArray(fields)) {
            return res.status(400).json({ error: 'Title and fields are required' });
        }

        const form = await prisma.customForm.create({
            data: {
                title,
                description,
                fields,
                integrationConfig,
                design,
                addToCrm: addToCrm !== undefined ? addToCrm : false,
                ownerId: req.user!.userId
            }
        });

        res.status(201).json(form);
    } catch (e) {
        console.error('createForm error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Update an existing form
 */
export const updateForm = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { title, description, fields, isActive, integrationConfig, addToCrm, design } = req.body;

        const existing = await prisma.customForm.findFirst({
            where: { id, ownerId: req.user!.userId }
        });

        if (!existing) return res.status(404).json({ error: 'Form not found' });

        const form = await prisma.customForm.update({
            where: { id },
            data: {
                title: title !== undefined ? title : existing.title,
                description: description !== undefined ? description : existing.description,
                fields: fields !== undefined ? fields : existing.fields as any,
                integrationConfig: integrationConfig !== undefined ? integrationConfig : existing.integrationConfig as any,
                design: design !== undefined ? design : existing.design as any,
                isActive: isActive !== undefined ? isActive : existing.isActive,
                addToCrm: addToCrm !== undefined ? addToCrm : existing.addToCrm
            }
        });

        res.json(form);
    } catch (e) {
        console.error('updateForm error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Delete a form
 */
export const deleteForm = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const existing = await prisma.customForm.findFirst({
            where: { id, ownerId: req.user!.userId }
        });

        if (!existing) return res.status(404).json({ error: 'Form not found' });

        await prisma.customForm.delete({ where: { id } });
        res.json({ message: 'Form deleted successfully' });
    } catch (e) {
        console.error('deleteForm error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Submit a form response
 */
export const submitResponse = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { data } = req.body;

        const form = await prisma.customForm.findUnique({
            where: { id }
        });

        if (!form || !form.isActive) {
            return res.status(404).json({ error: 'Form not found or inactive' });
        }

        // Normalize data keys to snake_case for consistent automation mapping
        const toSnakeCase = (str: string) => 
            str.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^\w]/g, '');

        const processedData: any = {};
        for (const [key, val] of Object.entries(data)) {
            processedData[toSnakeCase(key)] = val;
        }

        const fields = form.fields as any[];
        for (const field of fields) {
            const fieldKey = toSnakeCase(field.label);
            const value = processedData[fieldKey];
            
            // Handle required fields
            if (field.required && (!value || value.toString().trim() === '')) {
                return res.status(400).json({ error: `${field.label} is required` });
            }

            // Handle phone number validation and prefix
            if (field.type === 'tel' && value) {
                let cleanPhone = value.toString().replace(/\s/g, '').replace(/^\+91/, '');
                if (!/^\d{10}$/.test(cleanPhone)) {
                    return res.status(400).json({ error: `${field.label} must be exactly 10 digits` });
                }
                // Store with standard +91 prefix
                processedData[fieldKey] = `+91${cleanPhone}`;
            }
        }

        const response = await prisma.formResponse.create({
            data: {
                formId: id,
                data: processedData,
                metadata: {
                    ip: req.ip,
                    userAgent: req.headers['user-agent']
                }
            }
        });

        // ─────────────────────────────────────────────
        // INTEGRATIONS: Sync to CRM
        // ─────────────────────────────────────────────
        if (form.addToCrm) {
            try {
                let crmName = processedData['name'] || processedData['full_name'] || processedData['first_name'] || 'Unknown';
                let crmPhone = processedData['phone'] || processedData['phone_number'] || processedData['whatsapp_number'] || '';
                let crmEmail = processedData['email'] || processedData['email_address'] || null;
                
                await prisma.crmLead.create({
                    data: {
                        ownerId: form.ownerId,
                        name: crmName,
                        phone: crmPhone,
                        email: crmEmail,
                        source: 'Dynamic Form',
                        notes: `Automatically added from form: ${form.title}. Response ID: ${response.id}\n\nFormData:\n${JSON.stringify(processedData, null, 2)}`
                    }
                });
            } catch (crmError) {
                console.error('Failed to sync to CRM:', crmError);
            }
        }

        // ─────────────────────────────────────────────
        // INTEGRATIONS: Sync to Bookings
        // ─────────────────────────────────────────────
        const config = form.integrationConfig as any;
        if (config?.syncToBookings && config.fieldMapping) {
            const { name, phone, date } = config.fieldMapping;
            const clientName = processedData[name] || 'Unknown';
            const clientPhone = processedData[phone] || '';
            const bookingDate = processedData[date] ? new Date(processedData[date]) : new Date();

            try {
                await prisma.booking.create({
                    data: {
                        ownerId: form.ownerId,
                        clientName,
                        phone: clientPhone,
                        service: `Form: ${form.title}`,
                        date: bookingDate,
                        source: 'Dynamic Form',
                        notes: `Automatically synced from form submission. Response ID: ${response.id}`,
                        formData: processedData
                    }
                });
            } catch (bookingError) {
                console.error('Failed to sync to bookings:', bookingError);
                // We don't want to fail the whole submission if sync fails, but we log it
            }
        }

        // ─────────────────────────────────────────────
        // AUTOMATION: Trigger Rules
        // ─────────────────────────────────────────────
        await triggerAutomation(form.ownerId, 'form_submitted', { ...processedData, formId: id });

        res.status(201).json({ message: 'Response submitted successfully', id: response.id });
    } catch (e) {
        console.error('submitResponse error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get responses for a specific form
 */
export const getFormResponses = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const form = await prisma.customForm.findFirst({
            where: { id, ownerId: req.user!.userId }
        });

        if (!form) return res.status(404).json({ error: 'Form not found' });

        const responses = await prisma.formResponse.findMany({
            where: { formId: id },
            orderBy: { createdAt: 'desc' }
        });

        res.json(responses);
    } catch (e) {
        console.error('getFormResponses error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};
