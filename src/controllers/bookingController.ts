import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { triggerAutomation } from '../utils/automation';
import { generateCalendarLinks, generateIcsContent, generateMultiEventIcsFeed, parseIcsContent } from '../utils/calendar';
import { APP_NAME, APP_NAME_LOWER } from '../utils/brand';

export const getBookings = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { page, limit, search, status, date, owner } = req.query;

        // Sub-users only see bookings explicitly assigned to them
        const where: any = { ownerId: ownerId! };
        if (isSubUser) {
            where.assignedTo = req.user!.userId;
        }

        if (search && typeof search === 'string') {
            where.OR = [
                { clientName: { contains: search, mode: 'insensitive' } },
                { service: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { notes: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (status && typeof status === 'string' && status !== 'all') {
            where.status = status.toUpperCase();
        }

        if (owner && typeof owner === 'string' && owner !== 'all') {
            if (owner === 'unassigned') {
                where.assignedTo = null;
            } else {
                where.assignedTo = owner;
            }
        }

        if (date && typeof date === 'string' && date !== 'all') {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            if (date === 'today') {
                where.date = { gte: todayStart, lte: todayEnd };
            } else if (date === 'upcoming') {
                where.date = { gte: todayStart };
            }
        }

        if (page) {
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 10;
            const skip = (pageNum - 1) * limitNum;

            const baseWhere: any = { ownerId: ownerId! };
            if (isSubUser) baseWhere.assignedTo = req.user!.userId;

            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            const [totalCount, todayCount, pendingCount, aiCount, matchingTotal, data] = await Promise.all([
                prisma.booking.count({ where: baseWhere }),
                prisma.booking.count({ where: { ...baseWhere, date: { gte: todayStart, lte: todayEnd } } }),
                prisma.booking.count({ where: { ...baseWhere, status: 'PENDING' } }),
                prisma.booking.count({ where: { ...baseWhere, source: 'AI Chat' } }),
                prisma.booking.count({ where }),
                prisma.booking.findMany({
                    where,
                    orderBy: { date: 'asc' },
                    skip,
                    take: limitNum,
                    include: { lead: true }
                })
            ]);

            const summary = { totalBookings: totalCount, todaySlots: todayCount, pendingConfirmation: pendingCount, fromAiChat: aiCount };

            return res.json({
                data,
                total: matchingTotal,
                summary,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(matchingTotal / limitNum)
            });
        }

        const bookings = await prisma.booking.findMany({
            where,
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
        const ownerId = req.user?.parentId || req.user?.userId;
        const { clientName, phone, email, service, date, time, duration, source, notes, formData, industry, leadId, meetingUrl, assignedTo } = req.body;
        
        // Combine date and time
        const bookingDate = new Date(`${date}T${time}:00Z`);
        const durationMins = duration ? parseInt(duration) : 60;

        // Generate Calendar Links
        const { googleCalendarUrl, outlookCalendarUrl } = generateCalendarLinks({
            id: 'new',
            title: `Appointment: ${clientName} - ${service}`,
            description: notes || `Scheduled appointment for ${service} with ${clientName}.`,
            startTime: bookingDate,
            durationMinutes: durationMins,
            location: meetingUrl ? 'Online Meeting' : `${APP_NAME} Meeting Hub`,
            meetingUrl: meetingUrl || undefined
        });

        const booking = await prisma.booking.create({
            data: {
                ownerId: ownerId!,
                clientName,
                phone,
                email,
                service,
                industry,
                date: bookingDate,
                duration: durationMins,
                status: 'PENDING',
                source,
                notes,
                formData,
                leadId,
                assignedTo: assignedTo || req.user?.userId,
                meetingUrl: meetingUrl || null,
                googleCalendarUrl,
                outlookCalendarUrl,
                externalSynced: false
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
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { id } = req.params;
        const { status } = req.body;

        const where: any = { id, ownerId: ownerId! };
        if (isSubUser) where.assignedTo = req.user!.userId;
        
        const booking = await prisma.booking.findFirst({ where });
        if (!booking) return res.status(404).json({ error: 'Booking not found or not assigned to you' });

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


export const updateBooking = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const isSubUser = req.user?.role === 'SUB_USER';
        const { id } = req.params;
        const data = req.body;

        const where: any = { id, ownerId: ownerId! };
        if (isSubUser) where.assignedTo = req.user!.userId;

        const booking = await prisma.booking.findFirst({ where });
        if (!booking) return res.status(404).json({ error: 'Booking not found or not assigned to you' });

        // Sub-users cannot change the assigned owner
        if (isSubUser) {
            delete data.assignedTo;
        }

        const updated = await prisma.booking.update({
            where: { id },
            data
        });

        res.json(updated);
    } catch (error) {
        console.error('Error updating booking:', error);
        res.status(500).json({ error: 'Failed to update booking' });
    }
};


export const getIcsDownload = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const booking = await prisma.booking.findUnique({
            where: { id }
        });

        if (!booking) return res.status(404).send('Booking not found');

        const icsData = generateIcsContent({
            id: booking.id,
            title: `Appointment: ${booking.clientName} - ${booking.service}`,
            description: booking.notes || `Scheduled appointment for ${booking.service} with ${booking.clientName}.`,
            startTime: booking.date,
            durationMinutes: booking.duration,
            location: booking.meetingUrl ? 'Online Video Meeting' : `${APP_NAME} Virtual Meeting`,
            meetingUrl: booking.meetingUrl || undefined
        });

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="appointment-${booking.id}.ics"`);
        res.send(icsData);
    } catch (error) {
        console.error('Error generating ICS:', error);
        res.status(500).send('Failed to generate ICS file');
    }
};

export const syncExternalCalendar = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const { id } = req.params;

        const booking = await prisma.booking.findFirst({
            where: { id, ownerId: ownerId! }
        });

        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        // Update externalSynced status
        const updated = await prisma.booking.update({
            where: { id },
            data: { externalSynced: true }
        });

        res.json({ success: true, booking: updated });
    } catch (error) {
        console.error('Error syncing external calendar:', error);
        res.status(500).json({ error: 'Failed to sync external calendar' });
    }
};

export const getCalendarConfig = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const user = await prisma.user.findUnique({
            where: { id: ownerId! },
            select: { calendarConfig: true }
        });

        res.json(user?.calendarConfig || {
            googleCalendar: { enabled: false, account: '' },
            outlook: { enabled: false, account: '' },
            apple: { enabled: false },
            autoGenerateMeet: true
        });
    } catch (error) {
        console.error('Error fetching calendar config:', error);
        res.status(500).json({ error: 'Failed to fetch calendar config' });
    }
};

export const updateCalendarConfig = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const { calendarConfig } = req.body;

        const updated = await prisma.user.update({
            where: { id: ownerId! },
            data: { calendarConfig },
            select: { calendarConfig: true }
        });

        res.json(updated.calendarConfig);
    } catch (error) {
        console.error('Error updating calendar config:', error);
        res.status(500).json({ error: 'Failed to update calendar config' });
    }
};

export const getLiveCalendarFeed = async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        
        // Find bookings for user
        const bookings = await prisma.booking.findMany({
            where: { 
                ownerId: userId,
                status: { in: ['CONFIRMED', 'PENDING', 'COMPLETED'] }
            },
            orderBy: { date: 'asc' }
        });

        const eventParams = bookings.map(b => ({
            id: b.id,
            title: `Appointment: ${b.clientName} - ${b.service}`,
            description: b.notes || `Scheduled appointment for ${b.service} with ${b.clientName}.`,
            startTime: b.date,
            durationMinutes: b.duration || 60,
            location: b.meetingUrl ? 'Online Video Meeting' : `${APP_NAME} Virtual Meeting`,
            meetingUrl: b.meetingUrl || undefined
        }));

        const icsFeedString = generateMultiEventIcsFeed(eventParams);

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${APP_NAME_LOWER}-feed-${userId}.ics"`);
        res.send(icsFeedString);
    } catch (error) {
        console.error('Error generating multi-calendar feed:', error);
        res.status(500).send('Failed to generate calendar feed');
    }
};

export const importExternalCalendar = async (req: AuthRequest, res: Response) => {
    try {
        const ownerId = req.user?.parentId || req.user?.userId;
        const { icalUrl } = req.body;

        if (!icalUrl || typeof icalUrl !== 'string') {
            return res.status(400).json({ error: 'Valid iCal/ICS URL is required' });
        }

        // Fetch the external ICS content
        const response = await fetch(icalUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch URL: status ${response.status}`);
        }
        const icsText = await response.text();

        // Parse ICS events
        const parsedEvents = parseIcsContent(icsText);

        if (parsedEvents.length === 0) {
            return res.json({ success: true, count: 0, message: 'No events found in external calendar feed.' });
        }

        // Import into database
        let count = 0;
        for (const ev of parsedEvents) {
            // Check if already exists by title and date
            const existing = await prisma.booking.findFirst({
                where: {
                    ownerId: ownerId!,
                    clientName: ev.summary,
                    date: ev.startTime
                }
            });

            if (!existing) {
                const { googleCalendarUrl, outlookCalendarUrl } = generateCalendarLinks({
                    id: 'import',
                    title: ev.summary,
                    description: ev.description,
                    startTime: ev.startTime,
                    durationMinutes: ev.durationMinutes,
                    location: ev.location
                });

                await prisma.booking.create({
                    data: {
                        ownerId: ownerId!,
                        clientName: ev.summary,
                        phone: '+91 99999 99999',
                        email: 'external@calendar.sync',
                        service: 'External Calendar Event',
                        date: ev.startTime,
                        duration: ev.durationMinutes,
                        status: 'CONFIRMED',
                        source: 'External Calendar',
                        notes: `Imported from: ${ev.location}\n\n${ev.description}`,
                        externalSynced: true,
                        googleCalendarUrl,
                        outlookCalendarUrl
                    }
                });
                count++;
            }
        }

        res.json({ success: true, count, message: `Successfully synchronized ${count} external calendar events into ${APP_NAME}.` });
    } catch (error: any) {
        console.error('Error importing external calendar:', error);
        res.status(500).json({ error: error?.message || 'Failed to import external calendar' });
    }
};
