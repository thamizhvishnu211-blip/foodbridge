import 'dotenv/config';
import { createId, db, hashPassword, initSchemaAndSeed } from '../server/db.ts';

function usage() {
  console.error('Usage: npm run create-admin -- "<Full Name>" <email> <password> [organization]');
  process.exit(1);
}

const [, , rawName, rawEmail, rawPassword, rawOrg] = process.argv;
if (!rawName || !rawEmail || !rawPassword) {
  usage();
}

const name = rawName.trim();
const email = rawEmail.trim().toLowerCase();
const password = rawPassword;
const organization = (rawOrg ?? 'VERDORA Platform Administration').trim();

if (name.length < 2) {
  console.error('Error: Name must be at least 2 characters.');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Error: Valid email address is required.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Error: Password must be at least 8 characters.');
  process.exit(1);
}

initSchemaAndSeed();

const now = new Date().toISOString();
const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email) as
  | { id: string; role: string }
  | undefined;

if (existing) {
  db.prepare(
    `UPDATE users
     SET name = ?, password_hash = ?, role = 'admin', account_type = 'admin',
         account_status = 'Active', organization = ?, verification_status = 'Approved',
         is_demo = 0, updated_at = ?
     WHERE id = ?`
  ).run(name, hashPassword(password), organization, now, existing.id);

  db.prepare(
    `INSERT INTO user_roles (user_id, role, account_type, assigned_by, assigned_at)
     VALUES (?, 'admin', 'admin', 'cli', ?)
     ON CONFLICT(user_id) DO UPDATE SET role = 'admin', account_type = 'admin', assigned_by = 'cli', assigned_at = ?`
  ).run(existing.id, now, now);

  console.log(`Updated existing account to Platform Administrator: ${email} (${existing.id})`);
} else {
  const id = createId('usr');
  db.prepare(
    `INSERT INTO users (
      id, name, email, password_hash, role, account_type, account_status,
      organization, location, whatsapp_number, verification_status,
      public_leaderboard, points, is_demo, created_at, updated_at, last_activity_at
    ) VALUES (?, ?, ?, ?, 'admin', 'admin', 'Active', ?, '', NULL, 'Approved', 0, 0, 0, ?, ?, ?)`
  ).run(id, name, email, hashPassword(password), organization, now, now, now);

  db.prepare(
    `INSERT INTO user_roles (user_id, role, account_type, assigned_by, assigned_at)
     VALUES (?, 'admin', 'admin', 'cli', ?)`
  ).run(id, now);

  console.log(`Created Platform Administrator account: ${email} (${id})`);
}
