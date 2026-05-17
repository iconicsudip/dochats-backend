import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { 
    getBookings, 
    createBooking, 
    updateBookingStatus, 
    updateBooking,
    getIcsDownload, 
    syncExternalCalendar, 
    getCalendarConfig, 
    updateCalendarConfig,
    getLiveCalendarFeed,
    importExternalCalendar
} from '../controllers/bookingController';

const router = Router();

router.get('/calendar-config', authenticate as any, getCalendarConfig as any);
router.post('/calendar-config', authenticate as any, updateCalendarConfig as any);
router.post('/import-ical', authenticate as any, importExternalCalendar as any);
router.get('/feed/:userId.ics', getLiveCalendarFeed as any); // Public iCal multi-event feed

router.get('/', authenticate as any, getBookings as any);
router.post('/', authenticate as any, createBooking as any);
router.patch('/:id/status', authenticate as any, updateBookingStatus as any);
router.patch('/:id', authenticate as any, updateBooking as any);
router.post('/:id/sync-external', authenticate as any, syncExternalCalendar as any);
router.get('/:id/ical', getIcsDownload as any); // Public/Direct download route for single .ics files

export default router;
