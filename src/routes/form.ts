import express from 'express';
import { getForms, getForm, createForm, updateForm, deleteForm, submitResponse, getFormResponses } from '../controllers/formController';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Public routes
router.get('/public/:id', getForm);
router.post('/public/:id/submit', submitResponse);

// Protected routes
router.get('/', authenticate as any, getForms);
router.post('/', authenticate as any, createForm);
router.put('/:id', authenticate as any, updateForm);
router.delete('/:id', authenticate as any, deleteForm);
router.get('/:id/responses', authenticate as any, getFormResponses);

export default router;
