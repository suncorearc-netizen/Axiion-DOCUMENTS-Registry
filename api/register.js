import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, getIp } from './_lib.js';

const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const VERSION = () => process.env.AGREEMENT_VERSION || '1.0';

// The agreement PDF never changes between deployments, so hash it once per warm server
// instead of downloading it again on every signup (this was a big part of the slowness).
let cachedHash = null;
async function agreementHash(req) {
  if (cachedHash) return cachedHash;
  let buf = null;
  try {
    buf = fs.readFileSync(path.join(process.cwd(), 'public', 'agreement.pdf'));
  } catch {
    try {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const r = await fetch(`${proto}://${req.headers.host}/agreement.pdf`);
      if (r.ok) buf = Buffer.from(await r.arrayBuffer());
    } catch {}
  }
  if (!buf) return 'unavailable';
  cachedHash = crypto.createHash('sha256').update(buf).digest('hex');
  return cachedHash;
}

export default async function handler(req, res) {
  // The signing page asks which agreement version is current, so the client always
  // accepts exactly the version the server will record.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ version: VERSION(), sha256: await agreementHash(req) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');

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

  // ---- The purchase agreement is mandatory. Nothing is saved unless every box is exactly `true`.
  if (c.agree_purchase !== true)
    return res.status(400).json({ error: 'You must agree to the purchase agreement before continuing.' });
  if (c.opened_pdf !== true)
    return res.status(400).json({ error: 'Please open and read the full agreement (PDF) first.' });
  if (c.read !== true || c.understood !== true || c.accurate !== true)
    return res.status(400).json({ error: 'Please tick all the confirmations.' });
  if (clean(b.accepted_version, 20) !== VERSION())
    return res.status(409).json({ error: 'The agreement was updated. Please refresh the page and read it again.' });

  if (typeof b.signature !== 'string' || !b.signature.startsWith('data:image/png;base64,') || b.signature.length > 300000)
    return res.status(400).json({ error: 'Please draw your signature.' });

  const ip = getIp(req);
  const since = new Date(Date.now() - 3600e3).toISOString();
  const [{ count }, hash] = await Promise.all([
    db.from('clients').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('signed_at', since),
    agreementHash(req),
  ]);
  if ((count || 0) >= 10) return res.status(429).json({ error: 'Too many submissions. Please try again later.' });

  // Optional ID photo -> private storage bucket
  let photoPath = null;
  if (typeof b.id_photo === 'string' && b.id_photo.startsWith('data:image/jpeg;base64,') && b.id_photo.length < 3.5e6) {
    photoPath = `${crypto.randomUUID()}.jpg`;
    const up = await db.storage.from('id-documents').upload(photoPath, Buffer.from(b.id_photo.split(',')[1], 'base64'), { contentType: 'image/jpeg' });
    if (up.error) photoPath = null;
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('clients')
    .insert({
      ...f,
      phone_digits: digits,
      id_photo_path: photoPath,
      signature_data: b.signature,
      consents: {
        agree_purchase: true,
        opened_pdf: true,
        read: true,
        understood: true,
        accurate: true,
        accepted_version: VERSION(),
        at: now,
      },
      agreement_version: VERSION(),
      agreement_sha256: hash,
      ip,
      user_agent: clean(req.headers['user-agent'], 300),
    })
    .select('code,signed_at,agreement_version,agreement_sha256')
    .single();

  if (error) return res.status(500).json({ error: 'Could not save. Please try again.' });
  res.status(200).json({ ...data });
}
