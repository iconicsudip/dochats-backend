import express from 'express';
import { login, getMe, changePassword, getSubUsers, createSubUser, updateSubUser, deleteSubUser, updateMe, updateTourStatus, forgotPassword, resetPassword } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// router.post('/register', register); // Disabled: Only Super Admin can create accounts now
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate as any, getMe);
router.post('/change-password', authenticate as any, changePassword);
router.get('/sub-users', authenticate as any, getSubUsers);
router.post('/sub-users', authenticate as any, createSubUser);
router.put('/sub-users/:id', authenticate as any, updateSubUser);
router.delete('/sub-users/:id', authenticate as any, deleteSubUser);
router.put('/update-me', authenticate as any, updateMe);
router.patch('/update-tour', authenticate as any, updateTourStatus);

export default router;
