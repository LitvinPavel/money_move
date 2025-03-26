import { Response } from 'express';
import { authConfig } from '../config/auth.config';
import { ITokens } from '../interfaces/token.interface';

export const setTokenCookies = (res: Response, tokens: ITokens): void => {
  res.cookie('accessToken', tokens.accessToken, {
    ...authConfig.cookie,
    maxAge: 15 * 60 * 1000 // 15 минут
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    ...authConfig.cookie,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней
  });
};

export const clearTokenCookies = (res: Response): void => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
};