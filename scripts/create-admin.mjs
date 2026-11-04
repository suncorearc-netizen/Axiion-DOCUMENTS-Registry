import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const [username, password, ...nameParts] = process.argv.slice(2);
if (!username || !password || password.length < 10) {
  console.error('Usage: npm run create-admin -- <login-id> <password-min-10-chars> "Full Name"');
  process.exit(1);
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { error } = await db.from('admin_users').upsert(
  { username: username.toLowerCase(), name: nameParts.join(' ') || username, password_hash: await bcrypt.hash(password, 12), active: true },
  { onConflict: 'username' }
);
console.log(error ? 'FAILED: ' + error.message : `Done. "${username}" can now log in (re-running resets the password).`);
