export const JWT_STRATEGY = 'jwt';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
