import { Request, Response, NextFunction } from 'express';
import { TokenService } from '../services/token.service';
import { AuthController } from "../controllers/auth.controller";

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.accessToken;
    
    if (!token) {
      res.status(401).json({ error: 'Authorization token required' });
      return;
    }

    try {
      const payload = TokenService.verifyAccessToken(token);
      req.user = { userId: payload.userId };
      next();
    } catch (error) {
      if (TokenService.isTokenExpiredError(error)) {
        // Пробуем обновить токен, если он истек
        AuthController.refreshToken(req, res);
      }
      throw error;
    }
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};