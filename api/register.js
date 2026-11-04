import crypto from 'node:crypto';
import { db, getIp } from './_lib.js';

const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  const f = {
    full_name: clean(b.full_name, 120),
    business_name: clean(b.business_name, 160),
    email: clean(b.email, 160).toLowerCase(),
    phone: clean(b.phone, 30),
    address: clean(b.address, 300),
    id_type: clean(b.id_type, 30),
    id_number: clean(b.id_number, 40),
    initials: clean(b.initials, 6),
  };
  const digits = f.phone.replace(/\D/g, '');
  const c = b.consents || {};

  if (!f.full_name || !/^\S+@\S+\.\S+$/.test(f.email) || digits.length < 7 || !f.address || !f.id_type || !f.id_number || !f.initials)
    return res.status(400).json({ error: 'Please fill in all required fields correctly.' });
  if (!(c.read && c.understood && c.accurate))
    return res.status(400).json({ error: 'Please tick all three confirmations.' });
  if (typeof b.signature !== 'string' || !b.signature.startsWith('data:image/png;base64,') || b.signature.length > 300000)
    return res.status(400).json({ error: 'Please draw your signature.' });

  const ip = getIp(req);
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await db.from('clients').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('signed_at', since);
  if ((count || 0) >= 10) return res.status(429).json({ error: 'Too many submissions. Please try again later.' });

  // Fingerprint of the exact agreement file the client was shown
  let hash = 'unavailable';
  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const r = await fetch(`${proto}://${req.headers.host}/agreement.pdf`);
    hash = crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
  } catch {}

  // Optional ID photo -> private storage bucket
  let photoPath = null;
  if (typeof b.id_photo === 'string' && b.id_photo.startsWith('data:image/jpeg;base64,') && b.id_photo.length < 3.5e6) {
    photoPath = `${crypto.randomUUID()}.jpg`;
    const up = await db.storage.from('id-documents').upload(photoPath, Buffer.from(b.id_photo.split(',')[1], 'base64'), { contentType: 'image/jpeg' });
    if (up.error) photoPath = null;
  }

  const { data, error } = await db
    .from('clients')
    .insert({
      ...f,
      phone_digits: digits,
      id_photo_path: photoPath,
      signature_data: b.signature,
      consents: { ...c, at: new Date().toISOString() },
      agreement_version: process.env.AGREEMENT_VERSION || '1.0',
      agreement_sha256: hash,
      ip,
      user_agent: clean(req.headers['user-agent'], 300),
    })
    .select('code,signed_at,agreement_version,agreement_sha256')
    .single();

  if (error) return res.status(500).json({ error: 'Could not save. Please try again.' });
  res.status(200).json({ ...data });
}
