import bcrypt from 'bcryptjs';
import { db, makeSession, getSession, getIp } from './_lib.js';

const PAGE = 25;
const EDITABLE = ['status', 'live_url', 'github_user', 'vercel_user', 'supabase_project', 'handover_date', 'notes'];
const DUMMY = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8m1v7oYH3m2l0i9gq0g3f1XJ4fG1eW';
const log = (admin, action, client_code, detail) => db.from('audit_log').insert({ admin, action, client_code, detail });

export default async function handler(req, res) {
  const action = req.query.action;
  res.setHeader('Cache-Control', 'no-store');

  if (action === 'login' && req.method === 'POST') {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const ip = getIp(req);
    const since = new Date(Date.now() - 15 * 60e3).toISOString();
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'login_fail').eq('detail', ip).gte('at', since);
    if ((count || 0) >= 8) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });

    const { data: u } = await db.from('admin_users').select('*').eq('username', username).eq('active', true).maybeSingle();
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY);
    if (!u || !ok) {
      await log(username, 'login_fail', null, ip);
      return res.status(401).json({ error: 'Wrong login ID or password.' });
    }
    await log(u.username, 'login', null, ip);
    res.setHeader('Set-Cookie', `axs=${await makeSession(u)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
    return res.json({ name: u.name });
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', 'axs=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    return res.json({ ok: true });
  }

  const me = await getSession(req);
  if (!me) return res.status(401).json({ error: 'auth' });

  if (action === 'me') return res.json({ name: me.name });

  if (action === 'stats') {
    const c = (f) => f(db.from('clients').select('id', { count: 'exact', head: true })).then((r) => r.count || 0);
    const day = new Date(Date.now() - 864e5).toISOString();
    const week = new Date(Date.now() - 7 * 864e5).toISOString();
    const [total, today, week7, issues] = await Promise.all([
      c((q) => q), c((q) => q.gte('signed_at', day)), c((q) => q.gte('signed_at', week)), c((q) => q.eq('status', 'issue')),
    ]);
    return res.json({ total, today, week: week7, issues });
  }

  if (action === 'list') {
    const page = Math.max(0, parseInt(req.query.page || '0', 10) || 0);
    let qb = db
      .from('clients')
      .select('code,full_name,business_name,phone,email,status,signed_at', { count: 'exact' })
      .order('signed_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (req.query.status) qb = qb.eq('status', req.query.status);
    const t = String(req.query.q || '').replace(/[,()%*\\"]/g, ' ').trim();
    if (t) {
      const d = t.replace(/\D/g, '');
      const parts = ['full_name', 'business_name', 'email', 'code', 'id_number'].map((k) => `${k}.ilike.%${t}%`);
      if (d.length >= 3) parts.push(`phone_digits.ilike.%${d}%`);
      qb = qb.or(parts.join(','));
    }
    const { data, count, error } = await qb;
    if (error) return res.status(500).json({ error: 'Search failed' });
    return res.json({ rows: data, total: count || 0, pageSize: PAGE });
  }

  if (action === 'get') {
    const { data: c } = await db.from('clients').select('*').eq('code', req.query.code).maybeSingle();
    if (!c) return res.status(404).json({ error: 'Not found' });
    let photo_url = null;
    if (c.id_photo_path) {
      const s = await db.storage.from('id-documents').createSignedUrl(c.id_photo_path, 300);
      photo_url = s.data?.signedUrl || null;
    }
    await log(me.username, 'view', c.code, null);
    return res.json({ ...c, photo_url });
  }

  if (action === 'update' && req.method === 'POST') {
    const patch = {};
    for (const k of EDITABLE) if (k in (req.body?.fields || {})) patch[k] = String(req.body.fields[k] ?? '').slice(0, 2000) || null;
    if (patch.status && !['active', 'issue', 'closed'].includes(patch.status)) return res.status(400).json({ error: 'Bad status' });
    if ('notes' in patch) patch.notes = patch.notes || '';
    patch.updated_at = new Date().toISOString();
    patch.updated_by = me.username;
    const { error } = await db.from('clients').update(patch).eq('code', req.body.code);
    if (error) return res.status(500).json({ error: 'Could not save' });
    await log(me.username, 'update', req.body.code, Object.keys(patch).join(','));
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Unknown action' });
}
