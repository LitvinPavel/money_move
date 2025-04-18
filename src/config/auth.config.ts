export const authConfig = {
  accessToken: {
    secret: process.env.ACCESS_TOKEN_SECRET || 'default_access_secret',
    expiresIn: '15m'
  },
  refreshToken: {
    secret: process.env.REFRESH_TOKEN_SECRET || 'default_refresh_secret',
    expiresIn: '7d'
  },
  cookie: {
    httpOnly: false,
    secure: true, // process.env.NODE_ENV === "production"
    sameSite: "none" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
  },
};
