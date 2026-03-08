import { Server } from 'socket.io';

let io: Server;

export const initSocket = (server: any) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('A user connected:', socket.id);

        socket.on('join_conversation', (conversationId) => {
            socket.join(conversationId);
            console.log(`Socket ${socket.id} joined conversation: ${conversationId}`);
        });

        socket.on('leave_conversation', (conversationId) => {
            socket.leave(conversationId);
            console.log(`Socket ${socket.id} left conversation: ${conversationId}`);
        });

        // Setup individual user rooms for dashboard notifications
        socket.on('join_admin', (userId) => {
            socket.join(`admin_${userId}`);
            console.log(`Socket ${socket.id} joined admin room: admin_${userId}`);
        });

        // Typing indicators
        socket.on('typing', (data: { conversationId: string; isFromAdmin: boolean }) => {
            socket.to(data.conversationId).emit('user_typing', data);
        });

        socket.on('stop_typing', (data: { conversationId: string; isFromAdmin: boolean }) => {
            socket.to(data.conversationId).emit('user_stop_typing', data);
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};
