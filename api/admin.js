import bcrypt from 'bcryptjs';
import { db, makeSession, getSession, getIp } from './_lib.js';

const PAGE = 25;
const DEFAULT_PW = '1234';
const EDITABLE = ['status', 'live_url', 'github_user', 'vercel_user', 'supabase_project', 'handover_date', 'notes'];
const DUMMY = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8m1v7oYH3m2l0i9gq0g3f1XJ4fG1eW';
const digits = (s) => String(s || '').replace(/\D/g, '');
const log = (admin, action, client_code, detail) => db.from('audit_log').insert({ admin, action, client_code, detail });
const startSession = async (res, u) =>
  res.setHeader('Set-Cookie', `axs=${await makeSession(u)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
const adminCount = async () => (await db.from('admin_users').select('id', { count: 'exact', head: true })).count || 0;

export default async function handler(req, res) {
  const action = req.query.action;
  const body = req.body || {};
  res.setHeader('Cache-Control', 'no-store');

  // ---- first-time setup: only works while there are no admins at all
  if (action === 'setup_status') return res.json({ needsSetup: (await adminCount()) === 0 });

  if (action === 'setup' && req.method === 'POST') {
    if ((await adminCount()) > 0) return res.status(403).json({ error: 'Setup is already done.' });
    const phone = digits(body.phone);
    if (phone.length < 7) return res.status(400).json({ error: 'Enter a valid mobile number.' });
    const name = String(body.name || '').trim().slice(0, 80) || phone;
    const { error } = await db.from('admin_users').insert({ username: phone, name, password_hash: await bcrypt.hash(DEFAULT_PW, 10), is_default: true });
    if (error) return res.status(500).json({ error: 'Could not create login.' });
    await log(phone, 'setup', null, getIp(req));
    await startSession(res, { username: phone, name });
    return res.json({ name, is_default: true });
  }

  // ---- login with mobile number + password
  if (action === 'login' && req.method === 'POST') {
    const username = digits(body.username);
    const password = String(body.password || '');
    const ip = getIp(req);
    const since = new Date(Date.now() - 15 * 60e3).toISOString();
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true })
      .eq('action', 'login_fail').gte('at', since).or(`detail.eq.${ip},admin.eq.${username}`);
    if ((count || 0) >= 8) return res.status(429).json({ error: 'Too many wrong attempts. Wait 15 minutes.' });

    const { data: u } = await db.from('admin_users').select('*').eq('username', username).eq('active', true).maybeSingle();
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY);
    if (!u || !ok) {
      await log(username, 'login_fail', null, ip);
      return res.status(401).json({ error: 'Wrong mobile number or password.' });
    }
    await log(u.username, 'login', null, ip);
    await startSession(res, u);
    return res.json({ name: u.name, is_default: u.is_default });
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', 'axs=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    return res.json({ ok: true });
  }

  const me = await getSession(req);
  if (!me) return res.status(401).json({ error: 'auth' });

  if (action === 'me') return res.json({ name: me.name, is_default: me.is_default });

  // ---- change own password (needs the previous password)
  if (action === 'password' && req.method === 'POST') {
    const { data: u } = await db.from('admin_users').select('password_hash').eq('username', me.username).single();
    if (!(await bcrypt.compare(String(body.current || ''), u.password_hash))) return res.status(400).json({ error: 'Your current password is wrong.' });
    const next = String(body.next || '');
    if (next.length < 6 || next === DEFAULT_PW) return res.status(400).json({ error: 'New password must be at least 6 characters and cannot be 1234.' });
    await db.from('admin_users').update({ password_hash: await bcrypt.hash(next, 10), is_default: false }).eq('username', me.username);
    await log(me.username, 'password_change', null, null);
    return res.json({ ok: true });
  }

  // ---- team logins
  if (action === 'team') {
    const { data } = await db.from('admin_users').select('username,name,active,is_default').order('created_at');
    return res.json({ rows: data, me: me.username });
  }
  if (action === 'team_add' && req.method === 'POST') {
    const phone = digits(body.phone);
    if (phone.length < 7) return res.status(400).json({ error: 'Enter a valid mobile number.' });
    const name = String(body.name || '').trim().slice(0, 80) || phone;
    const { error } = await db.from('admin_users').insert({ username: phone, name, password_hash: await bcrypt.hash(DEFAULT_PW, 10), is_default: true });
    if (error) return res.status(400).json({ error: 'That number already has a login.' });
    await log(me.username, 'team_add', null, phone);
    return res.json({ ok: true });
  }
  if (action === 'team_reset' && req.method === 'POST') {
    await db.from('admin_users').update({ password_hash: await bcrypt.hash(DEFAULT_PW, 10), is_default: true }).eq('username', digits(body.username));
    await log(me.username, 'team_reset', null, digits(body.username));
    return res.json({ ok: true });
  }
  if (action === 'team_toggle' && req.method === 'POST') {
    const u = digits(body.username);
    if (u === me.username) return res.status(400).json({ error: 'You cannot disable your own login.' });
    await db.from('admin_users').update({ active: !!body.active }).eq('username', u);
    await log(me.username, body.active ? 'team_enable' : 'team_disable', null, u);
    return res.json({ ok: true });
  }

  // ---- dashboard data
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
    for (const k of EDITABLE) if (k in (body.fields || {})) patch[k] = String(body.fields[k] ?? '').slice(0, 2000) || null;
    if (patch.status && !['active', 'issue', 'closed'].includes(patch.status)) return res.status(400).json({ error: 'Bad status' });
    if ('notes' in patch) patch.notes = patch.notes || '';
    patch.updated_at = new Date().toISOString();
    patch.updated_by = me.username;
    const { error } = await db.from('clients').update(patch).eq('code', body.code);
    if (error) return res.status(500).json({ error: 'Could not save' });
    await log(me.username, 'update', body.code, Object.keys(patch).join(','));
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Unknown action' });
}
