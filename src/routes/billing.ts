import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
    getSubscriptionStatus,
    getPaymentHistory,
    createPaymentOrder,
    verifyPayment,
    getAllPayments,
    setSubscriptionAmount
} from '../controllers/billingController';

const router = Router();

// Admin endpoints
router.get('/status', authenticate, getSubscriptionStatus);
router.get('/history', authenticate, getPaymentHistory);
router.post('/create-order', authenticate, createPaymentOrder);
router.post('/verify-payment', authenticate, verifyPayment);

// Super Admin endpoints
router.get('/all-payments', authenticate, getAllPayments);
router.post('/set-amount', authenticate, setSubscriptionAmount);

export default router;
