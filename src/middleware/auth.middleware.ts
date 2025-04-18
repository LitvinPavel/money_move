import { Request, Response, NextFunction } from "express";
import { TokenService } from "../services/token.service";

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1. Получаем токен из заголовка Authorization
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1]; // Bearer <token>

    if (!token) {
      res.status(401).json({ error: "Authorization token required" });
      return;
    }

    // 2. Валидируем токен
    try {
      const payload = TokenService.verifyAccessToken(token);
      req.user = { userId: payload.userId };
      next();
    } catch (error) {
      if (TokenService.isTokenExpiredError(error)) {
        // 3. Если токен истек, пробуем обновить
        handleTokenRefresh(req, res, next);
        return;
      }
      throw error;
    }
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(403).json({ error: "Invalid token" });
    return;
  }
};

async function handleTokenRefresh(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const refreshToken = req.headers["refresh-token"] as string;

  if (!refreshToken) {
    res.status(401).json({ error: "Refresh token required" });
    return;
  }

  try {
    const { userId } = TokenService.verifyRefreshToken(refreshToken);
    const newTokens = TokenService.generateTokens({ userId });

    // Устанавливаем новые токены в заголовки ответа
    res.setHeader("Authorization", `Bearer ${newTokens.accessToken}`);
    res.setHeader("Refresh-Token", newTokens.refreshToken);

    // Добавляем пользователя в запрос
    req.user = { userId };
    next();
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(403).json({ error: "Invalid refresh token" });
    return;
  }
}
