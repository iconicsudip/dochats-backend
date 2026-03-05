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

import http from 'http';
import { initSocket } from './socket';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;

// Initialize Socket.io
initSocket(server);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Main Routes
app.use('/api/auth', authRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/billing', billingRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

server.listen(PORT, () => {
    console.log(`Server & Socket.io running on port ${PORT}`);
});
