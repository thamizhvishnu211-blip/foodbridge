import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.VERDORA_DB_PATH
  ? path.resolve(process.cwd(), process.env.VERDORA_DB_PATH)
  : path.join(DATA_DIR, 'verdora.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export type AccountType =
  | 'buyer'
  | 'material_buyer'
  | 'material_supplier'
  | 'restaurant_donor'
  | 'food_recipient'
  | 'industrial_buyer'
  | 'oil_collection_partner'
  | 'recycling_processor'
  | 'general_user'
  | 'admin';

export type AccountStatus = 'Active' | 'Suspended' | 'Deactivated';

export function mapAccountTypeToRole(accountType: AccountType): 'member' | 'seller' | 'donor' | 'admin' {
  if (accountType === 'admin') return 'admin';
  if (
    accountType === 'material_supplier' ||
    accountType === 'recycling_processor' ||
    accountType === 'oil_collection_partner'
  ) {
    return 'seller';
  }
  if (accountType === 'restaurant_donor') return 'donor';
  return 'member';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function convertToKgIfEligible(quantity: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (u === 'kg' || u === 'kilogram' || u === 'kilograms') return quantity;
  if (u === 'g' || u === 'gram' || u === 'grams') return Number((quantity / 1000).toFixed(3));
  if (u === 't' || u === 'tonne' || u === 'tonnes' || u === 'metric ton') return Number((quantity * 1000).toFixed(2));
  return null;
}

function hasColumn(table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === col);
}

function ensureSchemaMigrations(): void {
  if (!hasColumn('users', 'account_type')) {
    db.exec(`ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'buyer';`);
    db.exec(`
      UPDATE users SET account_type = CASE
        WHEN role = 'admin' THEN 'admin'
        WHEN role = 'seller' THEN 'material_supplier'
        WHEN role = 'donor' THEN 'restaurant_donor'
        ELSE 'buyer'
      END;
    `);
  }
  if (!hasColumn('users', 'account_status')) {
    db.exec(`ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'Active';`);
  }
  if (!hasColumn('users', 'last_activity_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_activity_at TEXT;`);
  }
  if (!hasColumn('users', 'suspended_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN suspended_at TEXT;`);
  }
  if (!hasColumn('users', 'suspension_reason')) {
    db.exec(`ALTER TABLE users ADD COLUMN suspension_reason TEXT;`);
  }
  if (!hasColumn('users', 'deactivated_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN deactivated_at TEXT;`);
  }
  if (!hasColumn('users', 'updated_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN updated_at TEXT;`);
  }
  if (!hasColumn('users', 'google_id')) {
    db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT;`);
  }
  if (!hasColumn('users', 'avatar_url')) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT;`);
  }
  if (!hasColumn('users', 'auth_provider')) {
    db.exec(`ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'email';`);
  }
  if (!hasColumn('users', 'last_login_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT;`);
  }
  if (!hasColumn('users', 'role_selected')) {
    db.exec(`ALTER TABLE users ADD COLUMN role_selected INTEGER NOT NULL DEFAULT 1;`);
  }
  if (!hasColumn('users', 'firebase_uid')) {
    db.exec(`ALTER TABLE users ADD COLUMN firebase_uid TEXT;`);
  }

  if (!hasColumn('material_listings', 'is_hidden')) {
    db.exec(`ALTER TABLE material_listings ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!hasColumn('material_listings', 'hidden_reason')) {
    db.exec(`ALTER TABLE material_listings ADD COLUMN hidden_reason TEXT;`);
  }

  if (!hasColumn('food_donations', 'is_hidden')) {
    db.exec(`ALTER TABLE food_donations ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!hasColumn('food_donations', 'hidden_reason')) {
    db.exec(`ALTER TABLE food_donations ADD COLUMN hidden_reason TEXT;`);
  }

  if (!hasColumn('audit_logs', 'target_user_id')) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN target_user_id TEXT;`);
  }
  if (!hasColumn('audit_logs', 'reason')) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN reason TEXT;`);
  }
  if (!hasColumn('audit_logs', 'result')) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN result TEXT NOT NULL DEFAULT 'Success';`);
  }

  // Upgrade impact_ledger CHECK constraint cleanly if legacy table lacks 'oil'
  const ledgerSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'impact_ledger'`)
    .get() as { sql?: string } | undefined;
  if (ledgerSqlRow?.sql && !ledgerSqlRow.sql.includes("'oil'")) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE impact_ledger_new (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('material','food','oil')),
        source_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        mass_kg REAL,
        portions INTEGER NOT NULL DEFAULT 0,
        liters REAL NOT NULL DEFAULT 0,
        points_awarded INTEGER NOT NULL DEFAULT 0,
        is_verified INTEGER NOT NULL DEFAULT 0,
        is_demo INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT NOT NULL
      );
      INSERT INTO impact_ledger_new (
        id, source_type, source_id, user_id, category, mass_kg, portions, liters, points_awarded, is_verified, is_demo, completed_at
      )
      SELECT id, source_type, source_id, user_id, category, mass_kg, portions, 0, points_awarded, 0, is_demo, completed_at
      FROM impact_ledger;
      DROP TABLE impact_ledger;
      ALTER TABLE impact_ledger_new RENAME TO impact_ledger;
      COMMIT;
    `);
  } else {
    if (!hasColumn('impact_ledger', 'liters')) {
      db.exec(`ALTER TABLE impact_ledger ADD COLUMN liters REAL NOT NULL DEFAULT 0;`);
    }
    if (!hasColumn('impact_ledger', 'is_verified')) {
      db.exec(`ALTER TABLE impact_ledger ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;`);
    }
  }

  // Upgrade reports CHECK constraint if legacy table lacks 'oil' or 'user'
  const repSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reports'`)
    .get() as { sql?: string } | undefined;
  if (repSqlRow?.sql && !repSqlRow.sql.includes("'oil'")) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE reports_new (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL REFERENCES users(id),
        reporter_name TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('material','food','oil','user')),
        target_id TEXT NOT NULL,
        target_title TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('Open','Under Review','Resolved','Dismissed')),
        admin_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO reports_new SELECT * FROM reports;
      DROP TABLE reports;
      ALTER TABLE reports_new RENAME TO reports;
      COMMIT;
    `);
  }

  // Upgrade material_listings CHECK constraint cleanly if legacy table lacks 'Cancelled'
  const matSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'material_listings'`)
    .get() as { sql?: string } | undefined;
  if (matSqlRow?.sql && !matSqlRow.sql.includes("'Cancelled'")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE material_listings_new (
          id TEXT PRIMARY KEY,
          seller_id TEXT NOT NULL REFERENCES users(id),
          seller_name TEXT NOT NULL,
          seller_organization TEXT NOT NULL DEFAULT '',
          seller_verified INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          quantity REAL NOT NULL,
          unit TEXT NOT NULL,
          condition TEXT NOT NULL,
          location TEXT NOT NULL,
          indicative_price REAL,
          currency TEXT NOT NULL DEFAULT 'INR',
          image_url TEXT NOT NULL,
          available_until TEXT NOT NULL,
          pickup_preferences TEXT NOT NULL DEFAULT '',
          reuse_applications TEXT NOT NULL DEFAULT '[]',
          whatsapp_number TEXT,
          status TEXT NOT NULL CHECK(status IN ('Active','Paused','Unavailable','Completed','Cancelled')),
          is_hidden INTEGER NOT NULL DEFAULT 0,
          hidden_reason TEXT,
          is_demo INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO material_listings_new (
          id, seller_id, seller_name, seller_organization, seller_verified, title, category,
          description, quantity, unit, condition, location, indicative_price, currency,
          image_url, available_until, pickup_preferences, reuse_applications, whatsapp_number,
          status, is_hidden, hidden_reason, is_demo, created_at, updated_at
        )
        SELECT
          id, seller_id, seller_name, seller_organization, seller_verified, title, category,
          description, quantity, unit, condition, location, indicative_price, currency,
          image_url, available_until, pickup_preferences, reuse_applications, whatsapp_number,
          status, COALESCE(is_hidden, 0), hidden_reason, is_demo, created_at, updated_at
        FROM material_listings;
        DROP TABLE material_listings;
        ALTER TABLE material_listings_new RENAME TO material_listings;
        COMMIT;
      `);
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  // Normalize legacy USD currency entries to INR for India marketplace
  db.exec(`UPDATE material_listings SET currency = 'INR' WHERE currency = 'USD';`);

  // Backfill user_roles for any existing real users
  db.exec(`
    INSERT OR IGNORE INTO user_roles (user_id, role, account_type, assigned_by, assigned_at)
    SELECT id, role, account_type, 'migration', created_at FROM users;
  `);
}

function cleanupConfirmedDemoRecords(): void {
  const demoUsers = db
    .prepare(
      `SELECT id FROM users
       WHERE is_demo = 1
          OR email LIKE '%@verdora.demo'
          OR id IN ('usr_demo_seller', 'usr_demo_donor', 'usr_demo_member', 'usr_demo_admin')`
    )
    .all() as Array<{ id: string }>;

  const demoUserIds = demoUsers.map((u) => u.id);

  const hasDemoRows =
    demoUserIds.length > 0 ||
    (db.prepare(`SELECT COUNT(*) as c FROM material_listings WHERE is_demo = 1`).get() as { c: number }).c > 0 ||
    (db.prepare(`SELECT COUNT(*) as c FROM food_donations WHERE is_demo = 1`).get() as { c: number }).c > 0 ||
    (db.prepare(`SELECT COUNT(*) as c FROM impact_ledger WHERE is_demo = 1`).get() as { c: number }).c > 0;

  if (!hasDemoRows) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (demoUserIds.length > 0) {
      const placeholders = demoUserIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM sessions WHERE user_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM notifications WHERE user_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM saved_items WHERE user_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM customer_admin_notes WHERE user_id IN (${placeholders}) OR admin_id IN (${placeholders})`).run(
        ...demoUserIds,
        ...demoUserIds
      );
      db.prepare(`DELETE FROM verification_requests WHERE user_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM reports WHERE reporter_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM oil_buyer_enquiries WHERE buyer_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM oil_recovery_listings WHERE supplier_id IN (${placeholders})`).run(...demoUserIds);
    }

    db.exec(`DELETE FROM food_requests WHERE is_demo = 1;`);
    db.exec(`DELETE FROM material_requests WHERE is_demo = 1;`);
    db.exec(`DELETE FROM food_donations WHERE is_demo = 1;`);
    db.exec(`DELETE FROM material_listings WHERE is_demo = 1;`);
    db.exec(`DELETE FROM impact_ledger WHERE is_demo = 1;`);
    db.exec(`DELETE FROM audit_logs WHERE action = 'SEED_INITIALIZED' AND actor_id = 'usr_demo_admin';`);

    if (demoUserIds.length > 0) {
      const placeholders = demoUserIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM food_requests WHERE recipient_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM material_requests WHERE buyer_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM food_donations WHERE donor_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM material_listings WHERE seller_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM user_roles WHERE user_id IN (${placeholders})`).run(...demoUserIds);
      db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...demoUserIds);
    }

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function bootstrapConfiguredAdminIfProvided(): void {
  const adminEmail = process.env.VERDORA_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.VERDORA_ADMIN_PASSWORD;
  const adminName = process.env.VERDORA_ADMIN_NAME?.trim() || 'Platform Administrator';
  if (!adminEmail || !adminPassword || adminPassword.length < 8) return;

  const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(adminEmail) as
    | { id: string; role: string }
    | undefined;
  const now = new Date().toISOString();

  if (!existing) {
    const id = createId('usr');
    db.prepare(
      `INSERT INTO users (
        id, name, email, password_hash, role, account_type, account_status,
        organization, location, whatsapp_number, verification_status,
        public_leaderboard, points, is_demo, created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, ?, 'admin', 'admin', 'Active', 'VERDORA Platform Administration', '', NULL, 'Approved', 0, 0, 0, ?, ?, ?)`
    ).run(id, adminName, adminEmail, hashPassword(adminPassword), now, now, now);

    db.prepare(
      `INSERT OR IGNORE INTO user_roles (user_id, role, account_type, assigned_by, assigned_at)
       VALUES (?, 'admin', 'admin', 'env-bootstrap', ?)`
    ).run(id, now);
  }
}

export function initSchemaAndSeed(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('member','seller','donor','admin')),
      account_type TEXT NOT NULL DEFAULT 'buyer',
      account_status TEXT NOT NULL DEFAULT 'Active' CHECK(account_status IN ('Active','Suspended','Deactivated')),
      organization TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      whatsapp_number TEXT,
      verification_status TEXT NOT NULL DEFAULT 'Not Submitted',
      verification_notes TEXT,
      public_leaderboard INTEGER NOT NULL DEFAULT 1,
      points INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT,
      suspended_at TEXT,
      suspension_reason TEXT,
      deactivated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('member','seller','donor','admin')),
      account_type TEXT NOT NULL,
      assigned_by TEXT,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_admin_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      admin_id TEXT NOT NULL REFERENCES users(id),
      admin_name TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      needs_role_selection INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('material','food')),
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS material_listings (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES users(id),
      seller_name TEXT NOT NULL,
      seller_organization TEXT NOT NULL DEFAULT '',
      seller_verified INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      condition TEXT NOT NULL,
      location TEXT NOT NULL,
      indicative_price REAL,
      currency TEXT NOT NULL DEFAULT 'INR',
      image_url TEXT NOT NULL,
      available_until TEXT NOT NULL,
      pickup_preferences TEXT NOT NULL DEFAULT '',
      reuse_applications TEXT NOT NULL DEFAULT '[]',
      whatsapp_number TEXT,
      status TEXT NOT NULL CHECK(status IN ('Active','Paused','Unavailable','Completed','Cancelled')),
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_reason TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS material_requests (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES material_listings(id) ON DELETE CASCADE,
      buyer_id TEXT NOT NULL REFERENCES users(id),
      buyer_name TEXT NOT NULL,
      requested_quantity REAL NOT NULL,
      intended_use TEXT NOT NULL,
      preferred_date TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      arrangement TEXT NOT NULL CHECK(arrangement IN ('Pickup','Delivery Coordination')),
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('Request Created','Accepted','Coordination In Progress','Pickup Scheduled','Collected','Completed','Declined','Cancelled')),
      handover_confirmed_by_buyer INTEGER NOT NULL DEFAULT 0,
      handover_confirmed_by_seller INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS food_donations (
      id TEXT PRIMARY KEY,
      donor_id TEXT NOT NULL REFERENCES users(id),
      donor_name TEXT NOT NULL,
      donor_organization TEXT NOT NULL DEFAULT '',
      donor_verified INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      portions INTEGER NOT NULL,
      remaining_portions INTEGER NOT NULL,
      prepared_at TEXT,
      available_until TEXT NOT NULL,
      pickup_deadline TEXT NOT NULL,
      storage_info TEXT NOT NULL,
      packaging_info TEXT NOT NULL,
      allergens TEXT NOT NULL,
      dietary_info TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL,
      collection_instructions TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      whatsapp_number TEXT,
      status TEXT NOT NULL CHECK(status IN ('Available','Request Received','Accepted','Coordination In Progress','Pickup Scheduled','Completed','Cancelled','Expired')),
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_reason TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS food_requests (
      id TEXT PRIMARY KEY,
      donation_id TEXT NOT NULL REFERENCES food_donations(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id),
      recipient_name TEXT NOT NULL,
      requested_portions INTEGER NOT NULL,
      preferred_time TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('Request Received','Accepted','Coordination In Progress','Pickup Scheduled','Completed','Declined','Cancelled')),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oil_recovery_listings (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL REFERENCES users(id),
      supplier_name TEXT NOT NULL,
      supplier_organization TEXT NOT NULL DEFAULT '',
      supplier_verified INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      oil_type TEXT NOT NULL,
      volume_liters REAL NOT NULL,
      quality_grade TEXT NOT NULL,
      container_type TEXT NOT NULL,
      filtration_status TEXT NOT NULL,
      pickup_window TEXT NOT NULL,
      location TEXT NOT NULL,
      collection_status TEXT NOT NULL CHECK(collection_status IN ('Available','Enquiry Pending','Scheduled','Collected','Processed','Paused','Cancelled')),
      whatsapp_number TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oil_buyer_enquiries (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES oil_recovery_listings(id) ON DELETE CASCADE,
      buyer_id TEXT NOT NULL REFERENCES users(id),
      buyer_name TEXT NOT NULL,
      buyer_organization TEXT NOT NULL DEFAULT '',
      requested_liters REAL NOT NULL,
      intended_processing TEXT NOT NULL,
      preferred_collection_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      processing_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('Pending','Accepted','Scheduled','Collected','Completed','Declined','Cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('material','food')),
      item_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, item_type, item_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id),
      reporter_name TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('material','food','oil','user')),
      target_id TEXT NOT NULL,
      target_title TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Open','Under Review','Resolved','Dismissed')),
      admin_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      organization TEXT NOT NULL,
      materials_handled TEXT NOT NULL,
      business_summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Submitted','Under Review','Approved','Rejected','More Information Required')),
      reviewer_notes TEXT,
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_tab TEXT NOT NULL DEFAULT 'workspace',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS impact_ledger (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('material','food','oil')),
      source_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      mass_kg REAL,
      portions INTEGER NOT NULL DEFAULT 0,
      liters REAL NOT NULL DEFAULT 0,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_user_id TEXT,
      reason TEXT,
      result TEXT NOT NULL DEFAULT 'Success',
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureSchemaMigrations();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, account_status, account_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_mat_listings_seller ON material_listings(seller_id, status, is_hidden);
    CREATE INDEX IF NOT EXISTS idx_mat_requests_listing_buyer ON material_requests(listing_id, buyer_id, status);
    CREATE INDEX IF NOT EXISTS idx_food_donations_donor ON food_donations(donor_id, status, pickup_deadline);
    CREATE INDEX IF NOT EXISTS idx_food_requests_donation_recip ON food_requests(donation_id, recipient_id, status);
    CREATE INDEX IF NOT EXISTS idx_oil_listings_supplier ON oil_recovery_listings(supplier_id, collection_status, is_hidden);
    CREATE INDEX IF NOT EXISTS idx_oil_enquiries_listing_buyer ON oil_buyer_enquiries(listing_id, buyer_id, status);
    CREATE INDEX IF NOT EXISTS idx_verifications_user_status ON verification_requests(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user ON audit_logs(target_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customer_notes_user ON customer_admin_notes(user_id, created_at DESC);
  `);

  // Ensure platform taxonomy categories exist (categories are system metadata, not fake users)
  const categoryCount = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c;
  if (categoryCount === 0) {
    const materialCats = [
      'Metal', 'Aluminium', 'Steel', 'Copper', 'Plastic', 'Paper', 'Cardboard',
      'Wood', 'Glass', 'Textile', 'Rubber', 'Construction materials',
      'Electronic components', 'Organic materials', 'Other reusable materials',
    ];
    const foodCats = [
      'Cooked meals', 'Fresh vegetables', 'Fruits', 'Bakery items',
      'Packaged food', 'Grains', 'Dairy products', 'Other eligible food',
    ];
    const ins = db.prepare(
      'INSERT INTO categories (id, name, slug, type, description, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    );
    for (const name of materialCats) {
      const slug = `mat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      ins.run(createId('cat'), name, slug, 'material', `Reusable ${name.toLowerCase()} for secondary applications.`);
    }
    for (const name of foodCats) {
      const slug = `food-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      ins.run(createId('cat'), name, slug, 'food', `Eligible surplus ${name.toLowerCase()} for community redistribution.`);
    }
  }

  // Remove any previously seeded demonstration records; never create fake customers on startup
  cleanupConfirmedDemoRecords();

  // Only creates an admin account if VERDORA_ADMIN_EMAIL + VERDORA_ADMIN_PASSWORD are explicitly configured in env
  bootstrapConfiguredAdminIfProvided();
}
