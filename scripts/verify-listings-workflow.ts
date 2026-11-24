import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TEST_DB = path.resolve(process.cwd(), 'data/verdora_listings_test.db');
const LEGACY_DB = path.resolve(process.cwd(), 'data/verdora_legacy_mig_test.db');
const TEST_PORT = 3202;
const LEGACY_PORT = 3203;
const MOCK_CERTS_PORT = 3205;
const MOCK_CERTS_URL = `http://127.0.0.1:${MOCK_CERTS_PORT}/certs`;
const FIREBASE_PROJECT_ID = 'conductive-tesla-1c70r';

// Minimal valid 1x1 transparent PNG data URI (well under 5 MB, genuine JPEG/PNG/WebP data URI format)
const SAMPLE_PNG_1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SAMPLE_PNG_2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQzwAEjDAGACfNAgFAq3/xAAAAAElFTkSuQmCC';

function cleanupDb(dbPath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }
}

async function waitForHealth(baseUrl: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${baseUrl} did not become healthy in time.`);
}

async function apiJson<T>(
  baseUrl: string,
  urlPath: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signFirebaseToken(
  privateKeyPem: string,
  kid: string,
  claims: { uid: string; email: string; name: string }
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    aud: FIREBASE_PROJECT_ID,
    auth_time: nowSec - 5,
    iat: nowSec - 5,
    exp: nowSec + 3600,
    sub: claims.uid,
    user_id: claims.uid,
    email: claims.email,
    email_verified: true,
    name: claims.name,
    picture: `https://lh3.googleusercontent.com/a/${claims.uid}`,
    firebase: {
      sign_in_provider: 'google.com',
      identities: { 'google.com': [`g-${claims.uid}`] },
    },
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${base64UrlEncode(signer.sign(privateKeyPem))}`;
}

function startTestCertsServer(keys: Record<string, string>) {
  const server = http.createServer((req, res) => {
    if (req.url === '/certs') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      });
      res.end(JSON.stringify(keys));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise<http.Server>((resolve) => {
    server.listen(MOCK_CERTS_PORT, '127.0.0.1', () => resolve(server));
  });
}

function spawnServer(port: number, dbPath: string, adminEmail = 'operator.listings@verdora.local') {
  const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
  const child = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      VERDORA_DB_PATH: dbPath,
      VERDORA_SKIP_VITE: 'true',
      VERDORA_ADMIN_EMAIL: adminEmail,
      VERDORA_ADMIN_NAME: 'Listings Operator',
      VERDORA_FIREBASE_CERTS_URL: MOCK_CERTS_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    if (!text.includes('ExperimentalWarning')) {
      process.stderr.write(`[server:${port}] ${text}`);
    }
  });
  return child;
}

async function runLegacyMigrationCheck(
  privateKey: string,
  kid: string
): Promise<void> {
  cleanupDb(LEGACY_DB);
  console.log('1. Testing schema migration on legacy material_listings CHECK constraint (preserving FK child rows)...');

  // Seed legacy SQLite database without 'Cancelled' in material_listings CHECK constraint
  const legacyDb = new DatabaseSync(LEGACY_DB);
  legacyDb.exec('PRAGMA foreign_keys = ON;');
  legacyDb.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'buyer',
      account_status TEXT NOT NULL DEFAULT 'Active',
      organization TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      whatsapp_number TEXT,
      verification_status TEXT NOT NULL DEFAULT 'Unverified',
      points INTEGER NOT NULL DEFAULT 0,
      public_leaderboard INTEGER NOT NULL DEFAULT 1,
      google_id TEXT,
      firebase_uid TEXT,
      avatar_url TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'google',
      role_selected INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      last_activity_at TEXT,
      suspended_at TEXT,
      suspension_reason TEXT,
      deactivated_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE material_listings (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
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
      currency TEXT NOT NULL DEFAULT 'USD',
      image_url TEXT NOT NULL,
      available_until TEXT NOT NULL,
      pickup_preferences TEXT NOT NULL DEFAULT '',
      reuse_applications TEXT NOT NULL DEFAULT '[]',
      whatsapp_number TEXT,
      status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Paused','Unavailable','Completed')),
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_reason TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE material_requests (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      buyer_name TEXT NOT NULL,
      requested_quantity REAL NOT NULL,
      intended_use TEXT NOT NULL,
      preferred_date TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      arrangement TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Request Created',
      handover_confirmed_by_buyer INTEGER NOT NULL DEFAULT 0,
      handover_confirmed_by_seller INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (listing_id) REFERENCES material_listings(id) ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const now = new Date().toISOString();
  const futureDate = new Date(Date.now() + 7 * 86400_000).toISOString();
  legacyDb
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, role, account_type, firebase_uid, auth_provider, created_at)
       VALUES (?, ?, ?, '', 'seller', 'material_supplier', ?, 'google', ?)`
    )
    .run('usr_legacy_seller', 'Legacy Seller', 'legacy.seller@example.com', 'uid-legacy-seller', now);
  legacyDb
    .prepare(
      `INSERT INTO users (id, name, email, password_hash, role, account_type, firebase_uid, auth_provider, created_at)
       VALUES (?, ?, ?, '', 'member', 'buyer', ?, 'google', ?)`
    )
    .run('usr_legacy_buyer', 'Legacy Buyer', 'legacy.buyer@example.com', 'uid-legacy-buyer', now);
  legacyDb
    .prepare(
      `INSERT INTO material_listings (
        id, seller_id, seller_name, title, category, description, quantity, unit,
        condition, location, image_url, available_until, status, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 0, ?, ?)`
    )
    .run(
      'mat_legacy_1',
      'usr_legacy_seller',
      'Legacy Seller',
      'Legacy Timber Planks',
      'Wood',
      'Reclaimed pine planks stored dry in warehouse.',
      40,
      'kg',
      'Good',
      'Portland',
      'media:wood',
      futureDate,
      now,
      now
    );
  legacyDb
    .prepare(
      `INSERT INTO material_requests (
        id, listing_id, buyer_id, buyer_name, requested_quantity, intended_use,
        preferred_date, preferred_time, arrangement, status, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '2026-12-01', '10:00', 'Pickup', 'Request Created', 0, ?, ?)`
    )
    .run('mreq_legacy_1', 'mat_legacy_1', 'usr_legacy_buyer', 'Legacy Buyer', 10, 'Workshop shelving', now, now);
  legacyDb.close();

  const legacyBase = `http://127.0.0.1:${LEGACY_PORT}`;
  const child = spawnServer(LEGACY_PORT, LEGACY_DB);
  try {
    await waitForHealth(legacyBase);

    const sellerLogin = await apiJson<{ token: string }>(legacyBase, '/api/auth/firebase', {
      method: 'POST',
      body: {
        idToken: signFirebaseToken(privateKey, kid, {
          uid: 'uid-legacy-seller',
          email: 'legacy.seller@example.com',
          name: 'Legacy Seller',
        }),
      },
    });
    assert.equal(sellerLogin.status, 200);

    // Cancelling the legacy listing must work (new CHECK constraint allows 'Cancelled')
    const cancelRes = await apiJson<{ listing: { id: string; status: string } }>(
      legacyBase,
      '/api/materials/mat_legacy_1/cancel',
      { method: 'POST', token: sellerLogin.data.token }
    );
    assert.equal(cancelRes.status, 200, 'Migrated DB must allow cancelling legacy material listing');
    assert.equal(cancelRes.data.listing.status, 'Cancelled');

    // Child material_requests row must still exist and now be Declined!
    const reqsRes = await apiJson<{ requests: Array<{ id: string; status: string }> }>(
      legacyBase,
      '/api/material-requests',
      { token: sellerLogin.data.token }
    );
    assert.equal(reqsRes.status, 200);
    const preserved = reqsRes.data.requests.find((r) => r.id === 'mreq_legacy_1');
    assert.ok(preserved, 'Child material_requests row must NOT be deleted during CHECK migration');
    assert.equal(preserved.status, 'Declined', 'Pending request must transition to Declined on cancel');
    console.log('   Legacy DB migration + ON DELETE CASCADE preservation PASSED.');
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 300));
    cleanupDb(LEGACY_DB);
  }
}

async function runWorkflowSuite() {
  cleanupDb(TEST_DB);

  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const testKid = 'listings-workflow-kid';
  const certsServer = await startTestCertsServer({ [testKid]: keyPair.publicKey });

  try {
    await runLegacyMigrationCheck(keyPair.privateKey, testKid);

    console.log('2. Starting clean isolated server for TESTS A, B, C, D...');
    const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
    const child = spawnServer(TEST_PORT, TEST_DB, 'operator.listings@verdora.local');

    const signInUser = async (uid: string, email: string, name: string) => {
      const idToken = signFirebaseToken(keyPair.privateKey, testKid, { uid, email, name });
      const res = await apiJson<{ user: { id: string; role: string }; token: string }>(
        baseUrl,
        '/api/auth/firebase',
        { method: 'POST', body: { idToken } }
      );
      assert.equal(res.status, 200, `Login failed for ${email}`);
      return res.data;
    };

    try {
      await waitForHealth(baseUrl);

      const admin = await signInUser('uid-admin-1', 'operator.listings@verdora.local', 'Listings Operator');
      assert.equal(admin.user.role, 'admin');
      const seller = await signInUser('uid-seller-1', 'seller@example.com', 'Alloy Seller');
      const buyer = await signInUser('uid-buyer-1', 'buyer@example.com', 'Timber Buyer');
      const donor = await signInUser('uid-donor-1', 'donor@example.com', 'Bistro Donor');
      const recipient = await signInUser('uid-recipient-1', 'recipient@example.com', 'Community Pantry');
      const intruder = await signInUser('uid-intruder-1', 'intruder@example.com', 'Other Member');

      // --- Auth guards (401) ---
      console.log('   Checking unauthenticated 401 guards...');
      assert.equal((await apiJson(baseUrl, '/api/my/materials')).status, 401);
      assert.equal((await apiJson(baseUrl, '/api/my/food-donations')).status, 401);
      assert.equal((await apiJson(baseUrl, '/api/materials', { method: 'POST', body: {} })).status, 401);
      assert.equal((await apiJson(baseUrl, '/api/food-donations', { method: 'POST', body: {} })).status, 401);
      assert.equal((await apiJson(baseUrl, '/api/materials/fake/cancel', { method: 'POST' })).status, 401);
      assert.equal((await apiJson(baseUrl, '/api/food-donations/fake/cancel', { method: 'POST' })).status, 401);

      // --- TEST A: Material Marketplace Create -> Discover -> Edit -> Cancel ---
      console.log('   TEST A: Material Marketplace Create, Discover, Edit, Invalid Edit, Cancel...');
      const availableUntilInitial = new Date(Date.now() + 14 * 86400_000).toISOString();
      const createMat = await apiJson<{
        listing: {
          id: string;
          sellerId: string;
          title: string;
          quantity: number;
          currency: string;
          imageUrl: string;
          status: string;
          createdAt: string;
        };
      }>(baseUrl, '/api/materials', {
        method: 'POST',
        token: seller.token,
        body: {
          title: 'Extruded Aluminium Rails',
          category: 'Aluminium',
          description: 'Clean 40x40 T-slot aluminium extrusion offcuts from framing job.',
          quantity: 100,
          unit: 'kg',
          condition: 'Unused Surplus',
          location: 'Bengaluru',
          indicativePrice: 2500,
          availableUntil: availableUntilInitial,
          pickupPreferences: 'Weekdays 9am-4pm',
          reuseApplications: ['Workbenches', 'CNC Gantry'],
          whatsappNumber: '+919876543210',
          imageUrl: SAMPLE_PNG_1,
        },
      });
      assert.equal(createMat.status, 201);
      const matA = createMat.data.listing;
      assert.equal(matA.status, 'Active');
      assert.equal(matA.currency, 'INR', 'Default marketplace currency must be INR');
      assert.equal(matA.imageUrl, SAMPLE_PNG_1);

      // Buyer discovers listing in public feed
      const discoverMat = await apiJson<{ listings: Array<{ id: string; title: string }> }>(
        baseUrl,
        '/api/materials?category=Aluminium'
      );
      assert.equal(discoverMat.status, 200);
      assert.ok(discoverMat.data.listings.some((l) => l.id === matA.id));

      // Edit listing (including photo, title, qty, description, price, deadline, phone)
      const availableUntilUpdated = new Date(Date.now() + 30 * 86400_000).toISOString();
      const editMat = await apiJson<{
        listing: {
          id: string;
          sellerId: string;
          title: string;
          quantity: number;
          description: string;
          indicativePrice: number | null;
          availableUntil: string;
          imageUrl: string;
          whatsappNumber: string | null;
          createdAt: string;
        };
      }>(baseUrl, `/api/materials/${matA.id}`, {
        method: 'PATCH',
        token: seller.token,
        body: {
          title: 'Extruded Aluminium Rails (Updated Lot)',
          quantity: 125,
          description: 'Updated description: clean T-slot extrusions bundled on pallet.',
          indicativePrice: 95,
          availableUntil: availableUntilUpdated,
          whatsappNumber: '+15125550199',
          imageUrl: SAMPLE_PNG_2,
        },
      });
      assert.equal(editMat.status, 200);
      assert.equal(editMat.data.listing.id, matA.id);
      assert.equal(editMat.data.listing.sellerId, matA.sellerId);
      assert.equal(editMat.data.listing.createdAt, matA.createdAt);
      assert.equal(editMat.data.listing.title, 'Extruded Aluminium Rails (Updated Lot)');
      assert.equal(editMat.data.listing.quantity, 125);
      assert.equal(editMat.data.listing.indicativePrice, 95);
      assert.equal(editMat.data.listing.imageUrl, SAMPLE_PNG_2);
      assert.equal(editMat.data.listing.whatsappNumber, '+15125550199');

      // Invalid edit returns 400 and does NOT corrupt listing
      const invalidMatEdit = await apiJson(baseUrl, `/api/materials/${matA.id}`, {
        method: 'PATCH',
        token: seller.token,
        body: { quantity: -10, title: 'No' },
      });
      assert.equal(invalidMatEdit.status, 400);

      // --- TEST C (Material): Other user cannot edit or cancel (403) ---
      console.log('   TEST C (Material): Verifying 403 ownership enforcement...');
      const intruderMatEdit = await apiJson(baseUrl, `/api/materials/${matA.id}`, {
        method: 'PATCH',
        token: intruder.token,
        body: { title: 'Hijacked Material Title' },
      });
      assert.equal(intruderMatEdit.status, 403);
      const intruderMatCancel = await apiJson(baseUrl, `/api/materials/${matA.id}/cancel`, {
        method: 'POST',
        token: intruder.token,
      });
      assert.equal(intruderMatCancel.status, 403);

      // Seller cancels listing A
      const cancelMatA = await apiJson<{ listing: { status: string } }>(
        baseUrl,
        `/api/materials/${matA.id}/cancel`,
        { method: 'POST', token: seller.token }
      );
      assert.equal(cancelMatA.status, 200);
      assert.equal(cancelMatA.data.listing.status, 'Cancelled');

      // Cancelled listing is hidden from public discovery (default & status=All & status=Cancelled)
      for (const qs of ['', '?status=All', '?status=Cancelled']) {
        const pub = await apiJson<{ listings: Array<{ id: string }> }>(baseUrl, `/api/materials${qs}`);
        assert.ok(!pub.data.listings.some((l) => l.id === matA.id), `Cancelled listing leaked in /api/materials${qs}`);
      }

      // Preserved in owner's history & admin panel
      const myMats = await apiJson<{ listings: Array<{ id: string; status: string }> }>(
        baseUrl,
        '/api/my/materials',
        { token: seller.token }
      );
      assert.equal(myMats.data.listings.find((l) => l.id === matA.id)?.status, 'Cancelled');

      const adminMats = await apiJson<{ listings: Array<{ id: string; status: string }> }>(
        baseUrl,
        '/api/admin/listings?status=Cancelled',
        { token: admin.token }
      );
      assert.ok(adminMats.data.listings.some((l) => l.id === matA.id));

      // Cannot edit or re-cancel a Cancelled material listing (409)
      assert.equal(
        (
          await apiJson(baseUrl, `/api/materials/${matA.id}`, {
            method: 'PATCH',
            token: seller.token,
            body: { title: 'Edit After Cancel' },
          })
        ).status,
        409
      );
      assert.equal(
        (
          await apiJson(baseUrl, `/api/materials/${matA.id}/cancel`, {
            method: 'POST',
            token: seller.token,
          })
        ).status,
        409
      );

      // --- TEST B: Food Rescue Create -> Discover -> Edit -> Invalid Edit -> Cancel ---
      console.log('   TEST B: Food Rescue Create, Discover, Edit, Invalid Edit, Cancel...');
      const foodDeadline1 = new Date(Date.now() + 4 * 3600_000).toISOString();
      const createFood = await apiJson<{
        donation: {
          id: string;
          donorId: string;
          title: string;
          portions: number;
          remainingPortions: number;
          imageUrl: string;
          status: string;
          createdAt: string;
        };
      }>(baseUrl, '/api/food-donations', {
        method: 'POST',
        token: donor.token,
        body: {
          title: 'Artisan Focaccia & Salad Bowls',
          category: 'Bakery items',
          description: 'Freshly baked trays and sealed green salads from lunch service.',
          quantity: 15,
          unit: 'kg',
          portions: 20,
          preparedAt: new Date(Date.now() - 3600_000).toISOString(),
          pickupDeadline: foodDeadline1,
          storageInfo: 'Chilled at 4C in walk-in cooler',
          packagingInfo: 'Compostable sealed containers',
          allergens: 'Gluten, Sesame',
          dietaryInfo: 'Vegetarian',
          location: 'South Congress',
          collectionInstructions: 'Ring kitchen back bell',
          whatsappNumber: '+15125550222',
          imageUrl: SAMPLE_PNG_1,
        },
      });
      assert.equal(createFood.status, 201);
      const foodB = createFood.data.donation;
      assert.equal(foodB.status, 'Available');
      assert.equal(foodB.portions, 20);
      assert.equal(foodB.remainingPortions, 20);
      assert.equal(foodB.imageUrl, SAMPLE_PNG_1);

      // Recipient discovers food donation
      const discoverFood = await apiJson<{ donations: Array<{ id: string }> }>(baseUrl, '/api/food-donations');
      assert.ok(discoverFood.data.donations.some((d) => d.id === foodB.id));

      // Edit food donation
      const foodDeadline2 = new Date(Date.now() + 8 * 3600_000).toISOString();
      const editFood = await apiJson<{
        donation: {
          id: string;
          donorId: string;
          title: string;
          portions: number;
          remainingPortions: number;
          storageInfo: string;
          allergens: string;
          pickupDeadline: string;
          imageUrl: string;
          createdAt: string;
        };
      }>(baseUrl, `/api/food-donations/${foodB.id}`, {
        method: 'PATCH',
        token: donor.token,
        body: {
          title: 'Artisan Focaccia & Salad Bowls (Extended Batch)',
          portions: 30,
          storageInfo: 'Held chilled at 3C in prep fridge',
          allergens: 'Gluten, Sesame, Mustard',
          pickupDeadline: foodDeadline2,
          imageUrl: SAMPLE_PNG_2,
        },
      });
      assert.equal(editFood.status, 200);
      assert.equal(editFood.data.donation.id, foodB.id);
      assert.equal(editFood.data.donation.donorId, foodB.donorId);
      assert.equal(editFood.data.donation.createdAt, foodB.createdAt);
      assert.equal(editFood.data.donation.title, 'Artisan Focaccia & Salad Bowls (Extended Batch)');
      assert.equal(editFood.data.donation.portions, 30);
      assert.equal(editFood.data.donation.remainingPortions, 30);
      assert.equal(editFood.data.donation.allergens, 'Gluten, Sesame, Mustard');
      assert.equal(editFood.data.donation.imageUrl, SAMPLE_PNG_2);

      // Invalid edit (past deadline / 0 portions) returns 400
      const invalidFoodEdit = await apiJson(baseUrl, `/api/food-donations/${foodB.id}`, {
        method: 'PATCH',
        token: donor.token,
        body: {
          pickupDeadline: new Date(Date.now() - 3600_000).toISOString(),
          portions: 0,
        },
      });
      assert.equal(invalidFoodEdit.status, 400);

      // --- TEST C (Food): Other user cannot edit or cancel (403) ---
      console.log('   TEST C (Food): Verifying 403 ownership enforcement...');
      assert.equal(
        (
          await apiJson(baseUrl, `/api/food-donations/${foodB.id}`, {
            method: 'PATCH',
            token: intruder.token,
            body: { title: 'Hijacked Donation' },
          })
        ).status,
        403
      );
      assert.equal(
        (
          await apiJson(baseUrl, `/api/food-donations/${foodB.id}/cancel`, {
            method: 'POST',
            token: intruder.token,
          })
        ).status,
        403
      );

      // Donor cancels food donation
      const cancelFoodB = await apiJson<{ donation: { status: string } }>(
        baseUrl,
        `/api/food-donations/${foodB.id}/cancel`,
        { method: 'POST', token: donor.token }
      );
      assert.equal(cancelFoodB.status, 200);
      assert.equal(cancelFoodB.data.donation.status, 'Cancelled');

      // Cancelled donation excluded from public discovery
      for (const qs of ['', '?includeEnded=true', '?status=All']) {
        const pub = await apiJson<{ donations: Array<{ id: string }> }>(baseUrl, `/api/food-donations${qs}`);
        assert.ok(!pub.data.donations.some((d) => d.id === foodB.id), `Cancelled donation leaked in /api/food-donations${qs}`);
      }

      // Preserved in donor history & admin panel
      const myFoods = await apiJson<{ donations: Array<{ id: string; status: string }> }>(
        baseUrl,
        '/api/my/food-donations',
        { token: donor.token }
      );
      assert.equal(myFoods.data.donations.find((d) => d.id === foodB.id)?.status, 'Cancelled');

      const adminFoods = await apiJson<{ donations: Array<{ id: string; status: string }> }>(
        baseUrl,
        '/api/admin/food-rescue?status=Cancelled',
        { token: admin.token }
      );
      assert.ok(adminFoods.data.donations.some((d) => d.id === foodB.id));

      // Cannot edit or re-cancel a Cancelled donation (409)
      assert.equal(
        (
          await apiJson(baseUrl, `/api/food-donations/${foodB.id}`, {
            method: 'PATCH',
            token: donor.token,
            body: { title: 'Edit After Cancel' },
          })
        ).status,
        409
      );
      assert.equal(
        (
          await apiJson(baseUrl, `/api/food-donations/${foodB.id}/cancel`, {
            method: 'POST',
            token: donor.token,
          })
        ).status,
        409
      );

      // --- TEST D: Request Integrity, Committed Quantity Protection, Pending Auto-Decline & Completion ---
      console.log('   TEST D: Request integrity, committed quantity guards, pending cancellation & handover completion...');

      // D1: Material with pending request CAN be cancelled -> request preserved & moved to Declined + notification
      const matPendingRes = await apiJson<{ listing: { id: string } }>(baseUrl, '/api/materials', {
        method: 'POST',
        token: seller.token,
        body: {
          title: 'Copper Busbar Offcuts',
          category: 'Aluminium',
          description: 'Clean copper offcuts suitable for electrical prototyping.',
          quantity: 50,
          unit: 'kg',
          condition: 'Good',
          location: 'Austin',
          availableUntil: new Date(Date.now() + 10 * 86400_000).toISOString(),
        },
      });
      const matPendingId = matPendingRes.data.listing.id;

      const buyerPendingMatReq = await apiJson<{ id: string }>(baseUrl, '/api/material-requests', {
        method: 'POST',
        token: buyer.token,
        body: {
          listingId: matPendingId,
          requestedQuantity: 20,
          intendedUse: 'Switchboard busbar fabrication',
        },
      });
      assert.equal(buyerPendingMatReq.status, 201);

      const cancelMatWithPending = await apiJson<{ listing: { status: string } }>(
        baseUrl,
        `/api/materials/${matPendingId}/cancel`,
        { method: 'POST', token: seller.token }
      );
      assert.equal(cancelMatWithPending.status, 200);

      const buyerReqsAfterCancel = await apiJson<{ requests: Array<{ id: string; status: string }> }>(
        baseUrl,
        '/api/material-requests',
        { token: buyer.token }
      );
      assert.equal(
        buyerReqsAfterCancel.data.requests.find((r) => r.id === buyerPendingMatReq.data.id)?.status,
        'Declined'
      );

      const buyerNotifs = await apiJson<{ notifications: Array<{ title: string }> }>(
        baseUrl,
        '/api/notifications',
        { token: buyer.token }
      );
      assert.ok(buyerNotifs.data.notifications.some((n) => n.title.includes('Cancelled')));

      // D2: Food with pending request CAN be cancelled -> request moved to Declined + notification
      const foodPendingRes = await apiJson<{ donation: { id: string } }>(baseUrl, '/api/food-donations', {
        method: 'POST',
        token: donor.token,
        body: {
          title: 'Steamed Rice & Lentil Trays',
          category: 'Prepared meals',
          description: 'Sealed hot-held meal trays ready for same-day pickup.',
          quantity: 8,
          unit: 'kg',
          portions: 16,
          pickupDeadline: new Date(Date.now() + 5 * 3600_000).toISOString(),
          storageInfo: 'Hot-held 65C',
          packagingInfo: 'Sealed foil gastronorm pans',
          allergens: 'None',
          location: 'Austin',
        },
      });
      const foodPendingId = foodPendingRes.data.donation.id;

      const recPendingFoodReq = await apiJson<{ id: string }>(baseUrl, '/api/food-requests', {
        method: 'POST',
        token: recipient.token,
        body: { donationId: foodPendingId, requestedPortions: 10 },
      });
      assert.equal(recPendingFoodReq.status, 201);

      assert.equal(
        (
          await apiJson(baseUrl, `/api/food-donations/${foodPendingId}/cancel`, {
            method: 'POST',
            token: donor.token,
          })
        ).status,
        200
      );

      const recReqsAfterCancel = await apiJson<{ requests: Array<{ id: string; status: string }> }>(
        baseUrl,
        '/api/food-requests',
        { token: recipient.token }
      );
      assert.equal(
        recReqsAfterCancel.data.requests.find((r) => r.id === recPendingFoodReq.data.id)?.status,
        'Declined'
      );

      // D3: Accepted requests block cancellation (409), enforce committed qty/portions minimum (409), recalculate remainingPortions, and complete cleanly
      const matAcceptedRes = await apiJson<{ listing: { id: string } }>(baseUrl, '/api/materials', {
        method: 'POST',
        token: seller.token,
        body: {
          title: 'Marine Plywood Sheets',
          category: 'Wood',
          description: 'Clean 18mm marine plywood full sheets stored indoors.',
          quantity: 40,
          unit: 'kg',
          condition: 'Like New',
          location: 'Austin',
          availableUntil: new Date(Date.now() + 12 * 86400_000).toISOString(),
        },
      });
      const matAcceptedId = matAcceptedRes.data.listing.id;

      const acceptedMatReq = await apiJson<{ id: string }>(baseUrl, '/api/material-requests', {
        method: 'POST',
        token: buyer.token,
        body: {
          listingId: matAcceptedId,
          requestedQuantity: 25,
          intendedUse: 'Community workshop cabinetry',
        },
      });
      assert.equal(acceptedMatReq.status, 201);

      await apiJson(baseUrl, `/api/material-requests/${acceptedMatReq.data.id}/status`, {
        method: 'PATCH',
        token: seller.token,
        body: { status: 'Accepted' },
      });

      // Cannot cancel while accepted
      assert.equal(
        (
          await apiJson(baseUrl, `/api/materials/${matAcceptedId}/cancel`, {
            method: 'POST',
            token: seller.token,
          })
        ).status,
        409
      );
      // Cannot reduce quantity below committed 25
      assert.equal(
        (
          await apiJson(baseUrl, `/api/materials/${matAcceptedId}`, {
            method: 'PATCH',
            token: seller.token,
            body: { quantity: 20 },
          })
        ).status,
        409
      );
      // Can increase quantity to 50
      assert.equal(
        (
          await apiJson(baseUrl, `/api/materials/${matAcceptedId}`, {
            method: 'PATCH',
            token: seller.token,
            body: { quantity: 50 },
          })
        ).status,
        200
      );

      // Food accepted request checks
      const foodAcceptedRes = await apiJson<{ donation: { id: string } }>(baseUrl, '/api/food-donations', {
        method: 'POST',
        token: donor.token,
        body: {
          title: 'Roasted Vegetable Pasta Trays',
          category: 'Prepared meals',
          description: 'Freshly portioned trays held warm for evening distribution.',
          quantity: 12,
          unit: 'kg',
          portions: 24,
          pickupDeadline: new Date(Date.now() + 6 * 3600_000).toISOString(),
          storageInfo: 'Hot-held 63C',
          packagingInfo: 'Sealed trays',
          allergens: 'Gluten',
          location: 'Austin',
        },
      });
      const foodAcceptedId = foodAcceptedRes.data.donation.id;

      const acceptedFoodReq = await apiJson<{ id: string }>(baseUrl, '/api/food-requests', {
        method: 'POST',
        token: recipient.token,
        body: { donationId: foodAcceptedId, requestedPortions: 24 },
      });
      assert.equal(acceptedFoodReq.status, 201);

      await apiJson(baseUrl, `/api/food-requests/${acceptedFoodReq.data.id}/status`, {
        method: 'PATCH',
        token: donor.token,
        body: { status: 'Accepted' },
      });

      // Cannot cancel while accepted
      assert.equal(
        (
          await apiJson(baseUrl, `/api/food-donations/${foodAcceptedId}/cancel`, {
            method: 'POST',
            token: donor.token,
          })
        ).status,
        409
      );
      // Cannot reduce portions below claimed 24
      assert.equal(
        (
          await apiJson(baseUrl, `/api/food-donations/${foodAcceptedId}`, {
            method: 'PATCH',
            token: donor.token,
            body: { portions: 15 },
          })
        ).status,
        409
      );
      // Increasing total portions from 24 to 30 recalculates remainingPortions to 6!
      const increaseFoodPortions = await apiJson<{
        donation: { portions: number; remainingPortions: number };
      }>(baseUrl, `/api/food-donations/${foodAcceptedId}`, {
        method: 'PATCH',
        token: donor.token,
        body: { portions: 30 },
      });
      assert.equal(increaseFoodPortions.status, 200);
      assert.equal(increaseFoodPortions.data.donation.portions, 30);
      assert.equal(increaseFoodPortions.data.donation.remainingPortions, 6);

      // Complete both accepted requests and verify impact ledger updates
      const completeMatReq = await apiJson(
        baseUrl,
        `/api/material-requests/${acceptedMatReq.data.id}/status`,
        { method: 'PATCH', token: buyer.token, body: { status: 'Completed' } }
      );
      assert.equal(completeMatReq.status, 200);

      const completeFoodReq = await apiJson(
        baseUrl,
        `/api/food-requests/${acceptedFoodReq.data.id}/status`,
        { method: 'PATCH', token: recipient.token, body: { status: 'Completed' } }
      );
      assert.equal(completeFoodReq.status, 200);

      const impactRes = await apiJson<{
        live: { materialsRecoveredKg: number; foodPortionsRescued: number };
      }>(baseUrl, '/api/impact');
      assert.equal(impactRes.data.live.materialsRecoveredKg, 25);
      assert.equal(impactRes.data.live.foodPortionsRescued, 24);

      console.log('   All TESTS A, B, C, D assertions PASSED.');

      // --- TEST E: India Currency (INR), AI Food Donation Creation & AI Seeker Guidance ---
      console.log('   TEST E: Verifying INR currency, AI food donation scanner & publishing, and AI food/object seeker guidance...');

      // E1: Empty AI scan bodies must be rejected with 400
      assert.equal(
        (await apiJson(baseUrl, '/api/ai/scan-material', { method: 'POST', body: { contextText: 'hi' } })).status,
        400
      );
      assert.equal(
        (await apiJson(baseUrl, '/api/ai/scan-food', { method: 'POST', body: { contextText: 'hi' } })).status,
        400
      );

      // E2: AI material scan works with image AND with text-only description
      const scanMatImg = await apiJson<{
        suggestedCategory: string;
        suggestedTitle: string;
        suggestedDescription: string;
      }>(baseUrl, '/api/ai/scan-material', {
        method: 'POST',
        body: { imageDataUrl: SAMPLE_PNG_1, contextText: 'Clean brushed aluminium brackets from Pune workshop' },
      });
      assert.equal(scanMatImg.status, 200);
      assert.ok(scanMatImg.data.suggestedCategory.length > 0);
      assert.ok(scanMatImg.data.suggestedTitle.length >= 3);

      const scanMatText = await apiJson<{
        suggestedCategory: string;
        suggestedTitle: string;
        suggestedDescription: string;
      }>(baseUrl, '/api/ai/scan-material', {
        method: 'POST',
        body: { contextText: '4 wooden study tables in Pune ready for pickup' },
      });
      assert.equal(scanMatText.status, 200);
      assert.equal(scanMatText.data.suggestedCategory, 'Wood');

      // E3: AI food scan works with text AND with image, and its output publishes directly to /api/food-donations
      const scanFoodImg = await apiJson<{
        suggestedCategory: string;
        estimatedPortions: number;
      }>(baseUrl, '/api/ai/scan-food', {
        method: 'POST',
        body: { imageDataUrl: SAMPLE_PNG_1, contextText: 'Fresh bakery sourdough loaves packaged cleanly' },
      });
      assert.equal(scanFoodImg.status, 200);
      assert.ok(scanFoodImg.data.estimatedPortions >= 1);

      const scanFoodText = await apiJson<{
        suggestedTitle: string;
        suggestedCategory: string;
        estimatedQuantity: number;
        estimatedUnit: string;
        estimatedPortions: number;
        storageAdvice: string;
        packagingAdvice: string;
        potentialAllergens: string;
        dietaryTags: string;
        suggestedDescription: string;
      }>(baseUrl, '/api/ai/scan-food', {
        method: 'POST',
        body: { contextText: '30 plates veg biryani kept hot in steel vessels in Bengaluru' },
      });
      assert.equal(scanFoodText.status, 200);
      assert.ok(scanFoodText.data.suggestedCategory.length > 0);
      assert.ok(scanFoodText.data.estimatedPortions > 0);
      assert.ok(scanFoodText.data.storageAdvice.length > 0);
      assert.ok(scanFoodText.data.potentialAllergens.length > 0);

      const aiFoodPost = await apiJson<{ donation: { id: string; status: string; remainingPortions: number } }>(
        baseUrl,
        '/api/food-donations',
        {
          method: 'POST',
          token: donor.token,
          body: {
            title: scanFoodText.data.suggestedTitle,
            category: scanFoodText.data.suggestedCategory,
            description: scanFoodText.data.suggestedDescription,
            quantity: scanFoodText.data.estimatedQuantity,
            unit: scanFoodText.data.estimatedUnit,
            portions: scanFoodText.data.estimatedPortions,
            pickupDeadline: new Date(Date.now() + 5 * 3600_000).toISOString(),
            storageInfo: scanFoodText.data.storageAdvice,
            packagingInfo: scanFoodText.data.packagingAdvice,
            allergens: scanFoodText.data.potentialAllergens,
            dietaryInfo: scanFoodText.data.dietaryTags,
            location: 'Bengaluru',
            imageUrl: SAMPLE_PNG_1,
          },
        }
      );
      assert.equal(aiFoodPost.status, 201);
      const aiFoodId = aiFoodPost.data.donation.id;
      assert.equal(aiFoodPost.data.donation.status, 'Available');

      // E4: Publish an INR material listing in Bengaluru and verify INR + AI guide for both food & object seekers
      const inrMatPost = await apiJson<{ listing: { id: string; currency: string; indicativePrice: number } }>(
        baseUrl,
        '/api/materials',
        {
          method: 'POST',
          token: seller.token,
          body: {
            title: 'Bengaluru Workshop Steel Shelving Frames',
            category: 'Steel',
            description: 'Heavy-duty modular steel shelving frames in good structural condition for Bengaluru pickup.',
            quantity: 120,
            unit: 'kg',
            condition: 'Good',
            location: 'Bengaluru',
            indicativePrice: 1500,
            availableUntil: new Date(Date.now() + 14 * 86400_000).toISOString(),
            imageUrl: SAMPLE_PNG_2,
          },
        }
      );
      assert.equal(inrMatPost.status, 201);
      assert.equal(inrMatPost.data.listing.currency, 'INR');
      assert.equal(inrMatPost.data.listing.indicativePrice, 1500);
      const inrMatId = inrMatPost.data.listing.id;

      // Guide for someone who wants food
      const guideFood = await apiJson<{
        summary: string;
        steps: string[];
        safetyOrQualityNote: string;
        matchedIds: string[];
      }>(baseUrl, '/api/ai/guide', {
        method: 'POST',
        body: { kind: 'food', query: 'veg biryani hot food', location: 'Bengaluru', quantityOrPortions: 10 },
      });
      assert.equal(guideFood.status, 200);
      assert.ok(guideFood.data.steps.length >= 2);
      assert.ok(guideFood.data.safetyOrQualityNote.length > 10);
      assert.ok(guideFood.data.matchedIds.includes(aiFoodId));

      // Guide for someone who wants an object/material
      const guideMat = await apiJson<{
        summary: string;
        steps: string[];
        safetyOrQualityNote: string;
        matchedIds: string[];
      }>(baseUrl, '/api/ai/guide', {
        method: 'POST',
        body: { kind: 'material', query: 'steel shelving frames', location: 'Bengaluru', quantityOrPortions: 50 },
      });
      assert.equal(guideMat.status, 200);
      assert.ok(guideMat.data.steps.length >= 2);
      assert.ok(guideMat.data.safetyOrQualityNote.length > 10);
      assert.ok(guideMat.data.matchedIds.includes(inrMatId));

      // E5: Eco Assistant chat grounded in live food donations & INR material listings
      const assistFood = await apiJson<{ reply: string }>(baseUrl, '/api/ai/assistant', {
        method: 'POST',
        body: { message: 'I want surplus food biryani near Bengaluru' },
      });
      assert.equal(assistFood.status, 200);
      assert.ok(assistFood.data.reply.toLowerCase().includes('bengaluru'));

      const assistMat = await apiJson<{ reply: string }>(baseUrl, '/api/ai/assistant', {
        method: 'POST',
        body: { message: 'I want steel shelving object in Bengaluru' },
      });
      assert.equal(assistMat.status, 200);
      assert.ok(assistMat.data.reply.includes('₹'));

      console.log('   All TESTS A, B, C, D, E assertions PASSED.');
    } finally {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    certsServer.close();
    cleanupDb(TEST_DB);
    cleanupDb(LEGACY_DB);
  }
}

runWorkflowSuite()
  .then(() => {
    console.log('VERDORA LISTINGS WORKFLOW VERIFICATION COMPLETE: ALL CHECKS PASSED.');
  })
  .catch((err) => {
    console.error('Listings workflow verification failed:', err);
    cleanupDb(TEST_DB);
    cleanupDb(LEGACY_DB);
    process.exit(1);
  });
