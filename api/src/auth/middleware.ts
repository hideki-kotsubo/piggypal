import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db.js';
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
  let userId: string;
  try {
    ({ userId } = await verifyAccessToken(token));
  } catch {
    // docs/05: an access token is meant to be short-lived (15 min) and
    // silently refreshed by the client well before this happens in normal
    // use — any failure here (expired, malformed, wrong signature) is
    // just "not currently signed in," not worth distinguishing further to
    // the caller.
    res.status(401).json({ error: 'Invalid or expired access token' });
    return;
  }
  // docs/72 D257 — an access token outlives a deleted account by up to
  // 15 minutes. Without this, a household device still holding one could
  // upload rows under the deleted user_id and bring its data back.
  const user = await pool().query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (user.rowCount === 0) {
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }
  req.userId = userId;
  next();
}
