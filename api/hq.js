import fs from 'node:fs';
import path from 'node:path';

// Read the page once per warm server instead of on every request.
let html = null;

export default function handler(req, res) {
  html ??= fs.readFileSync(path.join(process.cwd(), 'private', 'admin.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
}
