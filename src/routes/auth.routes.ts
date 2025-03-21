import express from 'express';
import { register, login, refreshToken, logout, checkAuth } from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validateRequest.middleware';
import {
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    logoutSchema,
  } from '../validators/auth.validator';

const router = express.Router();

router.post('/register', validateRequest(registerSchema), register);
router.post('/login', validateRequest(loginSchema), login);
router.post('/refresh-token', validateRequest(refreshTokenSchema, 'cookies'), refreshToken);
router.post('/logout', validateRequest(logoutSchema, 'cookies'), logout);
router.get('/check-auth', authenticateToken, checkAuth);

router.get('/profile', authenticateToken, (req, res) => {
    res.json({ message: 'This is a protected route', user: req.user });
});

export default router;