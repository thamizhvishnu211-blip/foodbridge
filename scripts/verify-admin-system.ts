import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import zlib from 'node:zlib';

const TEST_DB = path.resolve(process.cwd(), 'data/verdora_test.db');
const TEST_PORT = 3201;
const MOCK_CERTS_PORT = 3204;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;
const MOCK_CERTS_URL = `http://127.0.0.1:${MOCK_CERTS_PORT}/certs`;
const LIVE_BASE = 'http://127.0.0.1:3000';
const FIREBASE_PROJECT_ID = 'conductive-tesla-1c70r';

function makeSamplePng(seed: number): string {
  const width = 48;
  const height = 48;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let x = (seed * 2654435761) >>> 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let col = 0; col < width; col++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      raw[rowStart + 1 + col * 3] = (x >>> 16) & 0xff;
      raw[rowStart + 1 + col * 3 + 1] = (x >>> 8) & 0xff;
      raw[rowStart + 1 + col * 3 + 2] = x & 0xff;
    }
  }
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function cleanupTestDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${TEST_DB}${suffix}`;
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

async function runLiveProductionCheck() {
  console.log('1. Checking live server on port 3000 for zero fake customers/demo data...');
  await waitForHealth(LIVE_BASE);
  const htmlRes = await fetch(`${LIVE_BASE}/`);
  assert.equal(htmlRes.status, 200, 'Live homepage must return 200');
  const htmlText = await htmlRes.text();
  assert.ok(htmlText.includes('VERDORA'), 'Homepage HTML should mention VERDORA');

  const authStatus = await apiJson<{ configured: boolean; provider: string; projectId: string }>(
    LIVE_BASE,
    '/api/auth/google/status'
  );
  assert.equal(authStatus.status, 200);
  assert.equal(authStatus.data.configured, true, 'Live Firebase Google auth must be configured');
  assert.equal(authStatus.data.provider, 'firebase-google');

  const adminPage = await fetch(`${LIVE_BASE}/admin`);
  assert.equal(adminPage.status, 200, 'Direct /admin URL must serve the SPA');

  const leaderboardRemoved = await apiJson(LIVE_BASE, '/api/leaderboard');
  assert.equal(leaderboardRemoved.status, 404, 'Leaderboard endpoint must be removed');

  const mat = await apiJson<{ listings: Array<{ isDemo?: boolean }> }>(LIVE_BASE, '/api/materials');
  assert.equal(mat.status, 200);
  assert.equal(
    mat.data.listings.filter((l) => l.isDemo).length,
    0,
    'Live DB must have 0 demo/fake material listings'
  );

  const food = await apiJson<{ donations: Array<{ isDemo?: boolean }> }>(LIVE_BASE, '/api/food-donations');
  assert.equal(food.status, 200);
  assert.equal(
    food.data.donations.filter((d) => d.isDemo).length,
    0,
    'Live DB must have 0 demo/fake food donations'
  );

  const oil = await apiJson<{ listings: unknown[] }>(LIVE_BASE, '/api/oil-recovery');
  assert.equal(oil.status, 200);

  const imp = await apiJson<{
    live: {
      materialsRecoveredKg: number;
      foodPortionsRescued: number;
      oilLitersRecovered: number;
      communityParticipants: number;
    };
  }>(LIVE_BASE, '/api/impact');
  assert.equal(imp.status, 200);
  assert.equal(typeof imp.data.live.materialsRecoveredKg, 'number');
  assert.equal(typeof imp.data.live.foodPortionsRescued, 'number');
  assert.equal(typeof imp.data.live.oilLitersRecovered, 'number');

  const demoLogin = await apiJson(LIVE_BASE, '/api/auth/demo-login', { method: 'POST', body: {} });
  assert.equal(demoLogin.status, 404, 'Legacy demo-login endpoint must be removed');

  const unauthAdmin = await apiJson(LIVE_BASE, '/api/admin/overview');
  assert.equal(unauthAdmin.status, 401, 'Unauthenticated admin request must fail with 401');
  console.log('   Live port 3000 checks passed.');
}

async function runIsolatedEndToEndSuite() {
  cleanupTestDb();
  console.log('2. Starting isolated test server on port 3201 with clean test SQLite DB...');
  const adminEmail = 'operator.test@verdora.local';

  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const testKid = 'admin-suite-kid';
  const certsServer = await startTestCertsServer({ [testKid]: keyPair.publicKey });

  const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
  const child = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      VERDORA_DB_PATH: TEST_DB,
      VERDORA_SKIP_VITE: 'true',
      VERDORA_ADMIN_EMAIL: adminEmail,
      VERDORA_ADMIN_NAME: 'Platform Operator',
      VERDORA_FIREBASE_CERTS_URL: MOCK_CERTS_URL,
      GEMINI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  async function signInGoogleUser(opts: {
    uid: string;
    email: string;
    name: string;
    accountType?: string;
    organization?: string;
    location?: string;
    whatsappNumber?: string;
  }) {
    const idToken = signFirebaseToken(keyPair.privateKey, testKid, {
      uid: opts.uid,
      email: opts.email,
      name: opts.name,
    });
    const loginRes = await apiJson<{
      user: { id: string; role: string; accountType: string };
      token: string;
    }>(TEST_BASE, '/api/auth/firebase', { method: 'POST', body: { idToken } });
    assert.equal(loginRes.status, 200, `Google login must succeed for ${opts.email}`);

    if (opts.accountType || opts.organization || opts.location || opts.whatsappNumber) {
      const profRes = await apiJson<{
        user: { id: string; role: string; accountType: string };
      }>(TEST_BASE, '/api/auth/profile', {
        method: 'PATCH',
        token: loginRes.data.token,
        body: {
          accountType: opts.accountType,
          organization: opts.organization,
          location: opts.location,
          whatsappNumber: opts.whatsappNumber,
        },
      });
      assert.equal(profRes.status, 200);
      return { user: profRes.data.user, token: loginRes.data.token };
    }
    return loginRes.data;
  }

  try {
    await waitForHealth(TEST_BASE);

    // Admin login via configured operator Google email
    const adminLogin = await signInGoogleUser({
      uid: 'uid-admin-operator',
      email: adminEmail,
      name: 'Platform Operator',
    });
    assert.equal(adminLogin.user.role, 'admin', 'Configured operator email must receive admin role');
    const adminToken = adminLogin.token;
    const adminId = adminLogin.user.id;

    // Empty state check before any customer login
    const emptyOverview = await apiJson<{
      customers: { total: number };
      marketplace: { completedOrders: number };
      foodRescue: { activeDonations: number };
    }>(TEST_BASE, '/api/admin/overview', { token: adminToken });
    assert.equal(emptyOverview.status, 200);
    assert.equal(emptyOverview.data.customers.total, 0, 'Initial registered customers must be 0');
    assert.equal(emptyOverview.data.marketplace.completedOrders, 0);
    assert.equal(emptyOverview.data.foodRescue.activeDonations, 0);

    const emptyCustomers = await apiJson<{ customers: unknown[]; total: number }>(
      TEST_BASE,
      '/api/admin/customers',
      { token: adminToken }
    );
    assert.equal(emptyCustomers.data.total, 0);

    const emptyOrders = await apiJson<{ orders: unknown[]; total: number }>(
      TEST_BASE,
      '/api/admin/orders',
      { token: adminToken }
    );
    assert.equal(emptyOrders.data.total, 0);

    // Manual password register removed & privilege escalation blocked
    const manualRegRemoved = await apiJson(TEST_BASE, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Escalate', email: 'escalate@example.com', password: 'Password123!' },
    });
    assert.equal(manualRegRemoved.status, 404, 'Manual registration endpoint must not exist');

    // Sign in 5 real customer categories via Google Sign-In
    const supplierReg = await signInGoogleUser({
      uid: 'uid-supplier-apex',
      email: 'supplier@apex.example',
      name: 'Apex Metalworks',
      accountType: 'material_supplier',
      organization: 'Apex Sheet Ltd',
      location: 'Austin',
      whatsappNumber: '+15125550101',
    });
    assert.equal(supplierReg.user.accountType, 'material_supplier');
    assert.notEqual(supplierReg.user.role, 'admin');

    const buyerReg = await signInGoogleUser({
      uid: 'uid-buyer-maker',
      email: 'buyer@maker.example',
      name: 'Maker Studio',
      accountType: 'buyer',
      organization: 'Maker Collective',
      location: 'Austin',
      whatsappNumber: '+15125550102',
    });

    const privEsc = await apiJson<{ error: string }>(TEST_BASE, '/api/auth/profile', {
      method: 'PATCH',
      token: buyerReg.token,
      body: { accountType: 'admin' },
    });
    assert.equal(privEsc.status, 403, 'Customer self-escalation to admin must be rejected with 403');

    const restaurantReg = await signInGoogleUser({
      uid: 'uid-donor-saffron',
      email: 'kitchen@saffron.example',
      name: 'Saffron Kitchen',
      accountType: 'restaurant_donor',
      organization: 'Saffron Bistro',
      location: 'Austin',
      whatsappNumber: '+15125550103',
    });

    const recipientReg = await signInGoogleUser({
      uid: 'uid-recipient-oak',
      email: 'pantry@oak.example',
      name: 'Oak Pantry',
      accountType: 'food_recipient',
      organization: 'Oak Community Pantry',
      location: 'Austin',
      whatsappNumber: '+15125550104',
    });

    const indBuyerReg = await signInGoogleUser({
      uid: 'uid-indbuyer-greenbio',
      email: 'procure@greenbio.example',
      name: 'GreenBio Refinery',
      accountType: 'industrial_buyer',
      organization: 'GreenBio Processing',
      location: 'Austin',
      whatsappNumber: '+15125550105',
    });

    // Non-admin blocked on ALL /api/admin/* endpoints
    for (const ep of [
      '/api/admin/overview',
      '/api/admin/customers',
      `/api/admin/customers/${supplierReg.user.id}`,
      '/api/admin/listings',
      '/api/admin/orders',
      '/api/admin/food-rescue',
      '/api/admin/oil-recovery',
      '/api/admin/audit-logs',
    ]) {
      const forbidden = await apiJson(TEST_BASE, ep, { token: buyerReg.token });
      assert.equal(forbidden.status, 403, `Non-admin must get 403 on ${ep}`);
    }

    // Session persistence check (logout + Google re-login)
    await apiJson(TEST_BASE, '/api/auth/logout', { method: 'POST', token: buyerReg.token });
    const afterLogout = await apiJson<{ user: unknown }>(TEST_BASE, '/api/auth/me', {
      token: buyerReg.token,
    });
    assert.equal(afterLogout.data.user, null, 'Logged-out token must be invalidated');

    const buyerRelogin = await signInGoogleUser({
      uid: 'uid-buyer-maker',
      email: 'buyer@maker.example',
      name: 'Maker Studio',
    });
    assert.equal(buyerRelogin.user.id, buyerReg.user.id);
    const buyerToken = buyerRelogin.token;

    const verifyListing = async (
      token: string,
      listingType: 'material' | 'food' | 'oil',
      payload: Record<string, unknown>
    ) => {
      const res = await apiJson<{ verification: { id: string; status: string } }>(
        TEST_BASE,
        '/api/ai/verify-listing',
        { method: 'POST', token, body: { listingType, payload } }
      );
      assert.equal(res.status, 201, `AI verify failed for ${listingType}`);
      assert.equal(res.data.verification.status, 'VERIFIED', `Expected VERIFIED for ${listingType}`);
      return res.data.verification.id;
    };

    // Supplier publishes material listing via AI verification -> Buyer places request -> Completed
    const matPayload = {
      title: 'Clean 6061 Aluminium Plates',
      category: 'Aluminium',
      description: 'Laser-cut plate offcuts stored dry on warehouse pallets ready for workshop brackets.',
      quantity: 80,
      unit: 'kg',
      condition: 'Unused Surplus',
      location: 'Austin',
      availableUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
      pickupPreferences: 'Weekday dock',
      imageUrl: makeSamplePng(11),
    };
    const matVerId = await verifyListing(supplierReg.token, 'material', matPayload);
    const createMat = await apiJson<{ listing: { id: string } }>(TEST_BASE, '/api/materials', {
      method: 'POST',
      token: supplierReg.token,
      body: { ...matPayload, verificationId: matVerId },
    });
    assert.equal(createMat.status, 201);
    const matId = createMat.data.listing.id;

    // Second active listing to test Admin hide/unhide while first listing becomes Completed
    const matPayload2 = {
      title: 'Brushed Stainless Steel Strips',
      category: 'Steel',
      description: 'Clean 304 stainless steel fabrication strips bundled neatly for industrial reuse.',
      quantity: 50,
      unit: 'kg',
      condition: 'Good',
      location: 'Austin',
      availableUntil: new Date(Date.now() + 10 * 86400_000).toISOString(),
      pickupPreferences: 'Weekday dock',
      imageUrl: makeSamplePng(12),
    };
    const matVerId2 = await verifyListing(supplierReg.token, 'material', matPayload2);
    const createMat2 = await apiJson<{ listing: { id: string } }>(TEST_BASE, '/api/materials', {
      method: 'POST',
      token: supplierReg.token,
      body: { ...matPayload2, verificationId: matVerId2 },
    });
    assert.equal(createMat2.status, 201);
    const activeMatId = createMat2.data.listing.id;

    const createMatReq = await apiJson<{ id: string }>(TEST_BASE, '/api/material-requests', {
      method: 'POST',
      token: buyerToken,
      body: {
        listingId: matId,
        requestedQuantity: 30,
        intendedUse: 'Bracket fabrication',
        preferredDate: '2026-11-20',
        preferredTime: '10:00',
        arrangement: 'Pickup',
      },
    });
    assert.equal(createMatReq.status, 201);

    await apiJson(TEST_BASE, `/api/material-requests/${createMatReq.data.id}/status`, {
      method: 'PATCH',
      token: supplierReg.token,
      body: { status: 'Accepted' },
    });
    await apiJson(TEST_BASE, `/api/material-requests/${createMatReq.data.id}/status`, {
      method: 'PATCH',
      token: buyerToken,
      body: { status: 'Completed' },
    });

    // Restaurant posts food donation via AI verification -> Recipient requests -> Completed
    const foodPayload = {
      title: 'Fresh Vegetable Rice Trays',
      category: 'Prepared meals',
      description: 'Prepared midday, held hot in sealed gastronorm trays ready for immediate rescue.',
      quantity: 10,
      unit: 'kg',
      portions: 24,
      pickupDeadline: new Date(Date.now() + 4 * 3600_000).toISOString(),
      storageInfo: 'Hot-held above 63C',
      packagingInfo: 'Sealed steel trays',
      allergens: 'None',
      location: 'Austin',
      imageUrl: makeSamplePng(13),
    };
    const foodVerId = await verifyListing(restaurantReg.token, 'food', foodPayload);
    const createFood = await apiJson<{ donation: { id: string } }>(
      TEST_BASE,
      '/api/food-donations',
      {
        method: 'POST',
        token: restaurantReg.token,
        body: { ...foodPayload, verificationId: foodVerId },
      }
    );
    assert.equal(createFood.status, 201);

    const createFoodReq = await apiJson<{ id: string }>(TEST_BASE, '/api/food-requests', {
      method: 'POST',
      token: recipientReg.token,
      body: {
        donationId: createFood.data.donation.id,
        requestedPortions: 12,
        preferredTime: '17:00',
      },
    });
    assert.equal(createFoodReq.status, 201);

    await apiJson(TEST_BASE, `/api/food-requests/${createFoodReq.data.id}/status`, {
      method: 'PATCH',
      token: restaurantReg.token,
      body: { status: 'Accepted' },
    });
    await apiJson(TEST_BASE, `/api/food-requests/${createFoodReq.data.id}/status`, {
      method: 'PATCH',
      token: recipientReg.token,
      body: { status: 'Completed' },
    });

    // Restaurant submits verification -> Admin approves verification
    const verSub = await apiJson<{ id: string }>(TEST_BASE, '/api/verifications', {
      method: 'POST',
      token: restaurantReg.token,
      body: {
        organization: 'Saffron Bistro',
        materialsHandled: 'Prepared food and filtered fryer oil',
        businessSummary: 'Commercial restaurant operating 7 days a week in Austin.',
      },
    });
    assert.equal(verSub.status, 201);

    const verApprove = await apiJson<{ status: string }>(
      TEST_BASE,
      `/api/verifications/${verSub.data.id}`,
      {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'Approved', reviewerNotes: 'Verified business registration.' },
      }
    );
    assert.equal(verApprove.status, 200);
    assert.equal(verApprove.data.status, 'Approved');

    // Verified restaurant publishes Used Cooking Oil lot via AI verification -> Industrial Buyer enquires -> Completed
    const oilPayload = {
      title: 'Filtered Sunflower Frying Oil Tote',
      oilType: 'Sunflower Oil',
      volumeLiters: 180,
      qualityGrade: 'Grade A - Filtered',
      containerType: 'Sealed 200L Drum',
      filtrationStatus: 'Filtered 100 micron',
      pickupWindow: 'Mon-Fri 08:00-11:00',
      location: 'Austin',
    };
    const oilVerId = await verifyListing(restaurantReg.token, 'oil', oilPayload);
    const createOil = await apiJson<{ listing: { id: string } }>(TEST_BASE, '/api/oil-recovery', {
      method: 'POST',
      token: restaurantReg.token,
      body: { ...oilPayload, verificationId: oilVerId },
    });
    assert.equal(createOil.status, 201);

    const createOilEnq = await apiJson<{ id: string }>(TEST_BASE, '/api/oil-enquiries', {
      method: 'POST',
      token: indBuyerReg.token,
      body: {
        listingId: createOil.data.listing.id,
        requestedLiters: 180,
        intendedProcessing: 'Biodiesel feedstock transesterification',
        preferredCollectionDate: '2026-11-22',
      },
    });
    assert.equal(createOilEnq.status, 201);

    await apiJson(TEST_BASE, `/api/oil-enquiries/${createOilEnq.data.id}/status`, {
      method: 'PATCH',
      token: restaurantReg.token,
      body: { status: 'Accepted' },
    });
    await apiJson(TEST_BASE, `/api/oil-enquiries/${createOilEnq.data.id}/status`, {
      method: 'PATCH',
      token: indBuyerReg.token,
      body: { status: 'Completed' },
    });

    // Check Admin Overview numbers
    const fullOverview = await apiJson<{
      customers: { total: number; active: number };
      marketplace: { activeListings: number; completedOrders: number };
      foodRescue: { completedHandovers: number; rescuedPortions: number };
      oilRecovery: { totalListings: number; completedRecoveries: number; totalLitersRecovered: number };
    }>(TEST_BASE, '/api/admin/overview', { token: adminToken });
    assert.equal(fullOverview.data.customers.total, 5, 'Should show exact 5 real customers');
    assert.equal(fullOverview.data.marketplace.completedOrders, 1);
    assert.equal(fullOverview.data.foodRescue.rescuedPortions, 12);
    assert.equal(fullOverview.data.oilRecovery.completedRecoveries, 1);
    assert.equal(fullOverview.data.oilRecovery.totalLitersRecovered, 180);

    // Check Impact verified vs total
    const impactAfter = await apiJson<{
      live: {
        materialsRecoveredKg: number;
        verifiedMaterialsRecoveredKg: number;
        oilLitersRecovered: number;
        verifiedOilLitersRecovered: number;
      };
    }>(TEST_BASE, '/api/impact');
    assert.equal(impactAfter.data.live.materialsRecoveredKg, 30);
    assert.equal(impactAfter.data.live.verifiedMaterialsRecoveredKg, 0, 'Unverified supplier excluded from verified kg');
    assert.equal(impactAfter.data.live.oilLitersRecovered, 180);
    assert.equal(impactAfter.data.live.verifiedOilLitersRecovered, 180, 'Verified oil supplier counted in verified liters');

    // Check no password hashes or session tokens leaked in Admin Customer payloads
    const custList = await apiJson<{ customers: unknown[] }>(TEST_BASE, '/api/admin/customers', {
      token: adminToken,
    });
    const custListStr = JSON.stringify(custList.data);
    assert.ok(!custListStr.includes('password_hash') && !custListStr.includes('passwordHash'));

    const detail = await apiJson<{
      customer: { id: string; accountStatus: string };
      adminNotes: Array<{ note: string }>;
      moderationHistory: Array<{ action: string }>;
    }>(TEST_BASE, `/api/admin/customers/${supplierReg.user.id}`, { token: adminToken });
    assert.equal(detail.status, 200);
    assert.ok(!JSON.stringify(detail.data).includes('password_hash'));

    // Admin adds note
    const noteRes = await apiJson<{ note: { id: string } }>(
      TEST_BASE,
      `/api/admin/customers/${supplierReg.user.id}/notes`,
      { method: 'POST', token: adminToken, body: { note: 'Verified loading dock hours by phone.' } }
    );
    assert.equal(noteRes.status, 201);

    // Admin cannot suspend own account
    const selfSuspend = await apiJson(TEST_BASE, `/api/admin/customers/${adminId}/status`, {
      method: 'POST',
      token: adminToken,
      body: { accountStatus: 'Suspended', reason: 'Testing self-protection rule' },
    });
    assert.equal(selfSuspend.status, 400);

    // Suspension requires reason
    const noReason = await apiJson(
      TEST_BASE,
      `/api/admin/customers/${supplierReg.user.id}/status`,
      { method: 'POST', token: adminToken, body: { accountStatus: 'Suspended', reason: '' } }
    );
    assert.equal(noReason.status, 400);

    // Admin suspends supplier -> active session immediately revoked & future Google login blocked
    const suspendRes = await apiJson(
      TEST_BASE,
      `/api/admin/customers/${supplierReg.user.id}/status`,
      {
        method: 'POST',
        token: adminToken,
        body: { accountStatus: 'Suspended', reason: 'Pending alloy batch inspection' },
      }
    );
    assert.equal(suspendRes.status, 200);

    const suspendedMe = await apiJson<{ user: unknown }>(TEST_BASE, '/api/auth/me', {
      token: supplierReg.token,
    });
    assert.equal(suspendedMe.data.user, null, 'Suspended user session must be revoked');

    const suspendedLogin = await apiJson(TEST_BASE, '/api/auth/firebase', {
      method: 'POST',
      body: {
        idToken: signFirebaseToken(keyPair.privateKey, testKid, {
          uid: 'uid-supplier-apex',
          email: 'supplier@apex.example',
          name: 'Apex Metalworks',
        }),
      },
    });
    assert.equal(suspendedLogin.status, 403, 'Suspended user must be blocked from Google login');

    // Completed listing is already hidden from public materials; admin hides/unhides activeMatId
    await apiJson(TEST_BASE, `/api/admin/listings/${activeMatId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { isHidden: true, reason: 'Temporary spec check' },
    });
    const publicMatsHidden = await apiJson<{ listings: unknown[] }>(TEST_BASE, '/api/materials');
    assert.equal(publicMatsHidden.data.listings.length, 0);

    await apiJson(TEST_BASE, `/api/admin/listings/${activeMatId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { isHidden: false, status: 'Active' },
    });
    const publicMatsVisible = await apiJson<{ listings: unknown[] }>(TEST_BASE, '/api/materials');
    assert.equal(publicMatsVisible.data.listings.length, 1);

    // Admin reactivates supplier -> audit log contains full history
    await apiJson(TEST_BASE, `/api/admin/customers/${supplierReg.user.id}/status`, {
      method: 'POST',
      token: adminToken,
      body: { accountStatus: 'Active', reason: 'Inspection cleared' },
    });
    const reactivatedLogin = await apiJson(TEST_BASE, '/api/auth/firebase', {
      method: 'POST',
      body: {
        idToken: signFirebaseToken(keyPair.privateKey, testKid, {
          uid: 'uid-supplier-apex',
          email: 'supplier@apex.example',
          name: 'Apex Metalworks',
        }),
      },
    });
    assert.equal(reactivatedLogin.status, 200, 'Reactivated user should log in cleanly');

    const auditLogs = await apiJson<{ logs: Array<{ action: string; targetUserId: string | null }> }>(
      TEST_BASE,
      '/api/admin/audit-logs',
      { token: adminToken }
    );
    assert.equal(auditLogs.status, 200);
    const actions = auditLogs.data.logs.map((l) => l.action);
    assert.ok(actions.includes('ACCOUNT_SUSPENDED'), 'Audit log must record suspension');
    assert.ok(actions.includes('ACCOUNT_ACTIVE'), 'Audit log must record reactivation');
    assert.ok(actions.includes('CUSTOMER_NOTE_ADDED'), 'Audit log must record admin notes');
    assert.ok(actions.includes('LISTING_HIDDEN'), 'Audit log must record listing hide');
    assert.ok(actions.includes('VERIFICATION_APPROVED'), 'Audit log must record verification decision');

    console.log('   All 17 isolated end-to-end backend/security/admin tests PASSED.');
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already exited */
    }
    certsServer.close();
    await new Promise((r) => setTimeout(r, 300));
    cleanupTestDb();
  }
}

async function main() {
  await runLiveProductionCheck();
  await runIsolatedEndToEndSuite();
  console.log('VERDORA ADMIN SYSTEM VERIFICATION COMPLETE: ALL CHECKS PASSED.');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  cleanupTestDb();
  process.exit(1);
});
