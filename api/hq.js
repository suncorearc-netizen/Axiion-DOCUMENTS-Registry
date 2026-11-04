import fs from 'node:fs';
import path from 'node:path';

export default function handler(req, res) {
  const html = fs.readFileSync(path.join(process.cwd(), 'private', 'admin.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
}
