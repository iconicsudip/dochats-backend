import { Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { triggerAutomation } from '../utils/automation';

export const getBookings = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const bookings = await prisma.booking.findMany({
            where: { ownerId: ownerId! },
            orderBy: { date: 'asc' },
            include: { lead: true }
        });
        res.json(bookings);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
};

export const createBooking = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { clientName, phone, email, service, date, time, duration, source, notes, formData, industry, leadId } = req.body;
        
        // Combine date and time
        const bookingDate = new Date(`${date}T${time}:00Z`);

        const booking = await prisma.booking.create({
            data: {
                ownerId: ownerId!,
                clientName,
                phone,
                email,
                service,
                industry,
                date: bookingDate,
                duration: duration ? parseInt(duration) : 60,
                status: 'PENDING',
                source,
                notes,
                formData,
                leadId,
                assignedTo: req.user?.userId
            }
        });

        // Trigger Automation: Booking Created
        await triggerAutomation(ownerId!, 'booking_created', {
            ...booking,
            clientName,
            phone,
            email,
            service,
            date: bookingDate
        });

        res.json(booking);
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    }
};

export const updateBookingStatus = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.userId;
        const { id } = req.params;
        const { status } = req.body;
        
        const booking = await prisma.booking.findFirst({
            where: { id, ownerId: ownerId! }
        });

        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        await prisma.booking.update({
            where: { id },
            data: { status }
        });

        // Trigger Automation: Status Change with rich data
        const eventData = { ...booking, status };

        if (status === 'CONFIRMED') {
            await triggerAutomation(ownerId!, 'booking_confirmed', eventData);
        } else if (status === 'CANCELLED') {
            await triggerAutomation(ownerId!, 'booking_cancelled', eventData);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating booking status:', error);
        res.status(500).json({ error: 'Failed to update booking status' });
    }
};
