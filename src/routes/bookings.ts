import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getBookings, createBooking, updateBookingStatus } from '../controllers/bookingController';

const router = Router();

router.get('/', authenticate as any, getBookings as any);
router.post('/', authenticate as any, createBooking as any);
router.patch('/:id/status', authenticate as any, updateBookingStatus as any);

export default router;
