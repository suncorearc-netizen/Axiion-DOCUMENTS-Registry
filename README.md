# Axion Registry – client agreement signing + management dashboard

Clients open one public link, read the key points, enter their details, draw a signature and get a Client ID.
You open a hidden link, log in, and search any client by name, mobile, email, Client ID or ID number.

Stack: GitHub (code) + Vercel (hosting) + Supabase (database + private ID-photo storage). No build step.

## Setup (about 20 minutes)

### 1. Supabase
1. Create a project at supabase.com.
2. SQL Editor > New query > paste all of `supabase/schema.sql` > Run.
3. Project Settings > API: copy the **Project URL** and the **service_role** key (secret!).

### 2. GitHub
1. Create a **private** repository and upload this whole folder (the hidden link is inside `vercel.json`, so keep the repo private).

### 3. Vercel
1. vercel.com > Add New > Project > import the GitHub repo. Framework preset: **Other**. Deploy.
2. Project > Settings > Environment Variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET` (any long random text, 32+ characters)
   - `AGREEMENT_VERSION` (e.g. `1.0`)
3. Redeploy (Deployments > ... > Redeploy).

### 4. Create your admin logins (on your computer, Node 20+)
```
npm install
cp .env.example .env.local     # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run create-admin -- sakib "A-long-password-123" "Sakib"
```
Run it again for each staff member. Running it again for the same login ID resets that password.

### 5. Your links
- Clients: `https://YOUR-PROJECT.vercel.app/`
- You (hidden): `https://YOUR-PROJECT.vercel.app/hq-6961c1e148`
  To change the hidden path, edit `"source"` in `vercel.json` and push.

## Before you give it to clients
- **Replace `public/agreement.pdf`** with your finished agreement (fill in the [brackets]: names, price, days, country), then change `AGREEMENT_VERSION` in Vercel and redeploy.
  Every signed record stores the version and the SHA-256 fingerprint of the exact PDF the client was shown.
- Have a lawyer check that electronic signatures are valid for your use in Bangladesh.
- If you edit the key points in `public/index.html`, keep them matching the PDF.

## Notes
- All database access happens on the server with the service key. Row Level Security blocks any direct public access.
- ID photos are in a private bucket; the dashboard opens them with a 5-minute link.
- Every login, view and edit in the dashboard is recorded in the `audit_log` table.
- Never store clients' GitHub/Vercel/Supabase passwords here; the agreement says you keep no access after handover.
