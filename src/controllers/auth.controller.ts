import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { setTokenCookies, clearTokenCookies } from '../utils/cookie.utils';
import { validateRequest } from '../validators/auth.validator';
import { UserModel } from '../models/user.model';
import { TokenService } from '../services/token.service';

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { error, value } = validateRequest(req.body);
      if (error) {
        res.status(400).json({ 
          errors: error.details.map(d => ({
            field: d.path[0],
            message: d.message
          }))
        });
        return;
      }

      const { user, tokens } = await AuthService.register(value);
      setTokenCookies(res, tokens);

      res.status(201).json({ user });
    } catch (error) {
      res.status(400).json({ error: (error as { message: string }).message });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { error, value } = validateRequest(req.body);
      if (error) {
        res.status(400).json({ errors: error.details });
        return;
      }

      const { user, tokens } = await AuthService.login(value.email, value.password);
      setTokenCookies(res, tokens);

      res.json({ user });
    } catch (error) {
      res.status(401).json({ error: (error as { message: string }).message });
    }
  }

  static async logout(_req: Request, res: Response): Promise<void> {
    clearTokenCookies(res);
    res.sendStatus(204);
  }

  static async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const refreshToken = req.cookies.refreshToken;
      
      if (!refreshToken) {
        res.status(401).json({ error: 'Refresh token required' });
        return;
      }

      // Верифицируем refreshToken
      const { userId } = TokenService.verifyRefreshToken(refreshToken);
      
      // Генерируем новые токены
      const tokens = TokenService.generateTokens({ userId });
      
      // Устанавливаем новые cookies
      setTokenCookies(res, tokens);
      
      res.json({ success: true, userId });
    } catch (error) {
      if (TokenService.isTokenExpiredError(error)) {
        clearTokenCookies(res);
        res.status(401).json({ error: 'Refresh token expired. Please log in again.' });
      } else {
        res.status(403).json({ error: 'Invalid refresh token' });
      }
    }
  }

  static async me(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Refresh token required' });
        return;
      }

      const user = await UserModel.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: (error as { message: string }).message });
    }
  }
}