type ExpiresInOption = `${number}d` | `${number}h` | `${number}m` | `${number}s` | number;

export interface ITokenPayload {
  userId: number;
}

export interface ITokens {
  accessToken: string;
  refreshToken: string;
}

export interface IAuthConfig {
  accessToken: {
    secret: string;
    expiresIn: ExpiresInOption;
  };
  refreshToken: {
    secret: string;
    expiresIn: ExpiresInOption;
  };
}
