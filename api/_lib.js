import { createClient } from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';

export const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const key = () => new TextEncoder().encode(process.env.SESSION_SECRET);

export const makeSession = (u) =>
  new SignJWT({ u: u.username, n: u.name }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('8h').sign(key());

export async function getSession(req) {
  const m = (req.headers.cookie || '').match(/(?:^|; )axs=([^;]+)/);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], key());
    const { data } = await db.from('admin_users').select('username,name,active,is_default').eq('username', payload.u).maybeSingle();
    return data && data.active ? data : null;
  } catch {
    return null;
  }
}

export const getIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
