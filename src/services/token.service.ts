import jwt from 'jsonwebtoken';
import { authConfig } from '../config/auth.config';
import { ITokenPayload, ITokens, IAuthConfig } from '../interfaces/token.interface';


export class TokenService {
  static generateTokens(payload: ITokenPayload): ITokens {
    return {
      accessToken: jwt.sign(payload, authConfig.accessToken.secret, {
        expiresIn: (authConfig as IAuthConfig).accessToken.expiresIn
      }),
      refreshToken: jwt.sign(payload, authConfig.refreshToken.secret, {
        expiresIn: (authConfig as IAuthConfig).refreshToken.expiresIn
      })
    };
  }

  static verifyAccessToken(token: string): ITokenPayload {
    return jwt.verify(token, authConfig.accessToken.secret) as ITokenPayload;
  }

  static verifyRefreshToken(token: string): ITokenPayload {
    return jwt.verify(token, authConfig.refreshToken.secret) as ITokenPayload;
  }

  static isTokenExpiredError(error: unknown): boolean {
    return error instanceof jwt.TokenExpiredError;
  }
}