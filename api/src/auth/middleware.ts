import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../jwt.js';

export interface AuthedRequest extends Request {
  userId?: string;
}

// Gates any route needing a signed-in user — docs/05's "requires a valid
// access token" (the powersync-token endpoint today; future sync/parse
// routes, docs/03-04, will reuse this same middleware).
export async function requireAccessToken(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const { userId } = await verifyAccessToken(token);
    req.userId = userId;
    next();
  } catch {
    // docs/05: an access token is meant to be short-lived (15 min) and
    // silently refreshed by the client well before this happens in normal
    // use — any failure here (expired, malformed, wrong signature) is
    // just "not currently signed in," not worth distinguishing further to
    // the caller.
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
}
