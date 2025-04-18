import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { validateRequest } from '../validators/auth.validator';
import { UserModel } from '../models/user.model';

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { error, value } = validateRequest(req.body);
      if (error) {
        res.status(400).json({ errors: error.details });
        return;
      }

      const { user, tokens } = await AuthService.register(value);
      
      // Возвращаем токены в теле ответа
      res.status(201).json({ user, tokens });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
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
      
      // Возвращаем токены в теле ответа
      res.json({ user, tokens });
    } catch (error) {
      res.status(401).json({ error: (error as Error).message });
    }
  }

  static async logout(_req: Request, res: Response): Promise<void> {
    // Клиент должен сам удалить токены из localStorage
    res.sendStatus(204);
  }

  static async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        res.status(401).json({ error: 'Refresh token required' });
        return;
      }

      const tokens = await AuthService.refresh(refreshToken);
      res.json({ tokens });
    } catch (error) {
      res.status(403).json({ error: 'Invalid refresh token' });
    }
  }

  static async me(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const user = await UserModel.findById(req.user.userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
}