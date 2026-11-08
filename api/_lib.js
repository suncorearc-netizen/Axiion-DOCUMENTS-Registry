import { createClient } from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';

export const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const key = () => new TextEncoder().encode(process.env.SESSION_SECRET);

export const makeSession = (u) =>
  new SignJWT({ u: u.username, n: u.name }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('8h').sign(key());

// Remember "this admin is active" for 30 seconds per warm server, so every click in the
// dashboard does not cost an extra database round trip. A disabled login stops working
// within 30 seconds at most.
const SESSION_TTL = 30e3;
const sessions = new Map();
export const forgetSessions = () => sessions.clear();

export async function getSession(req) {
  const m = (req.headers.cookie || '').match(/(?:^|; )axs=([^;]+)/);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], key());
    const hit = sessions.get(payload.u);
    if (hit && hit.exp > Date.now()) return hit.user;
    const { data } = await db.from('admin_users').select('username,name,active,is_default').eq('username', payload.u).maybeSingle();
    const user = data && data.active ? data : null;
    sessions.set(payload.u, { user, exp: Date.now() + SESSION_TTL });
    return user;
  } catch {
    return null;
  }
}

export const getIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
