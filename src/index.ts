import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import linkRoutes from './routes/links';
import messageRoutes from './routes/messages';
import conversationRoutes from './routes/conversations';
import publicRoutes from './routes/public';
import superAdminRoutes from './routes/superAdmin';
import billingRoutes from './routes/billing';
import crmRoutes from './routes/crm';
import bookingsRoutes from './routes/bookings';
import automationRoutes from './routes/automation';
import whatsappRoutes from './routes/whatsapp';
import moduleConfigRoutes from './routes/moduleConfig';
import analyticsRoutes from './routes/analytics';
import formRoutes from './routes/form';
import emailRoutes from './routes/email';
import chatGroupRoutes from './routes/chatGroups';

import { initCron } from './utils/cron';

const app = express();
const PORT = process.env.PORT || 5001;

// Initialize Background Jobs
initCron();

app.use(cors({
    origin: "*",
    credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Main Routes
app.use('/api/auth', authRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/modules', moduleConfigRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/chat-groups', chatGroupRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
