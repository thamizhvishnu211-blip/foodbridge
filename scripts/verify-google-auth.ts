import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TEST_DB = path.resolve(process.cwd(), 'data/verdora_test_firebase_auth.db');
const TEST_PORT = 3202;
const MOCK_CERTS_PORT = 3203;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;
const MOCK_CERTS_URL = `http://127.0.0.1:${MOCK_CERTS_PORT}/certs`;
const FIREBASE_PROJECT_ID = 'conductive-tesla-1c70r';

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

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signFirebaseTestToken(
  privateKeyPem: string,
  kid: string,
  overrides: Record<string, unknown> = {}
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    aud: FIREBASE_PROJECT_ID,
    auth_time: nowSec - 5,
    iat: nowSec - 5,
    exp: nowSec + 3600,
    sub: 'fb-uid-1001',
    user_id: 'fb-uid-1001',
    email: 'chef.ananya@greenkitchen.org',
    email_verified: true,
    name: 'Ananya Rao',
    picture: 'https://lh3.googleusercontent.com/a/default-user',
    firebase: {
      sign_in_provider: 'google.com',
      identities: {
        'google.com': ['google-sub-1001'],
        email: ['chef.ananya@greenkitchen.org'],
      },
    },
    ...overrides,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64UrlEncode(signature)}`;
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

async function runTests() {
  cleanupTestDb();

  const mainKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const rogueKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const testKid = 'test-firebase-kid-1';
  const certsServer = await startTestCertsServer({ [testKid]: mainKey.publicKey });
  const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');

  console.log('1. Starting isolated server with Firebase RS256 Google auth verification...');
  const serverProc = spawn(tsxBin, ['server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      VERDORA_DB_PATH: TEST_DB,
      VERDORA_SKIP_VITE: 'true',
      VERDORA_FIREBASE_CERTS_URL: MOCK_CERTS_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForHealth(TEST_BASE);

    const statusRes = await fetch(`${TEST_BASE}/api/auth/google/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      configured: boolean;
      provider: string;
      projectId: string;
    };
    assert.equal(statusJson.configured, true);
    assert.equal(statusJson.provider, 'firebase-google');
    assert.equal(statusJson.projectId, FIREBASE_PROJECT_ID);

    console.log('2. Verifying legacy password register/login endpoints are removed (404)...');
    const regRemoved = await fetch(`${TEST_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'Password123!' }),
    });
    assert.equal(regRemoved.status, 404, 'Manual registration endpoint must not exist');

    const loginRemoved = await fetch(`${TEST_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'Password123!' }),
    });
    assert.equal(loginRemoved.status, 404, 'Custom password login endpoint must not exist');

    console.log('3. Verifying cryptographic JWT checks reject forged, expired, mismatched, and unverified tokens...');
    const missingToken = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: '' }),
    });
    assert.equal(missingToken.status, 400);

    const badSigToken = signFirebaseTestToken(rogueKey.privateKey, testKid);
    const badSigRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: badSigToken }),
    });
    assert.equal(badSigRes.status, 401);

    const expiredToken = signFirebaseTestToken(mainKey.privateKey, testKid, {
      exp: Math.floor(Date.now() / 1000) - 120,
    });
    const expiredRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: expiredToken }),
    });
    assert.equal(expiredRes.status, 401);

    const wrongAudToken = signFirebaseTestToken(mainKey.privateKey, testKid, {
      aud: 'different-project-id',
    });
    const wrongAudRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: wrongAudToken }),
    });
    assert.equal(wrongAudRes.status, 401);

    const wrongIssToken = signFirebaseTestToken(mainKey.privateKey, testKid, {
      iss: 'https://evil.example.com/conductive-tesla-1c70r',
    });
    const wrongIssRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: wrongIssToken }),
    });
    assert.equal(wrongIssRes.status, 401);

    const unverifiedToken = signFirebaseTestToken(mainKey.privateKey, testKid, {
      email_verified: false,
    });
    const unverifiedRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: unverifiedToken }),
    });
    assert.equal(unverifiedRes.status, 401);

    console.log('4. Testing direct first-time Google Sign-In + automatic profile creation (no onboarding block)...');
    const firstToken = signFirebaseTestToken(mainKey.privateKey, testKid);
    const firstRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: firstToken }),
    });
    assert.equal(firstRes.status, 200);
    const setCookie1 = firstRes.headers.get('set-cookie') || '';
    assert.ok(setCookie1.includes('verdora_session='), 'HttpOnly session cookie must be set');
    assert.ok(setCookie1.includes('HttpOnly'));

    const firstData = (await firstRes.json()) as {
      user: {
        id: string;
        email: string;
        role: string;
        accountType: string;
        avatarUrl: string | null;
        authProvider: string;
        needsRoleSelection: boolean;
      };
      token: string;
      isNewUser: boolean;
    };
    assert.equal(firstData.isNewUser, true);
    assert.equal(firstData.user.email, 'chef.ananya@greenkitchen.org');
    assert.equal(firstData.user.role, 'member', 'Google user must never receive admin automatically');
    assert.equal(firstData.user.accountType, 'general_user');
    assert.equal(firstData.user.authProvider, 'google');
    assert.equal(firstData.user.avatarUrl, 'https://lh3.googleusercontent.com/a/default-user');
    assert.equal(firstData.user.needsRoleSelection, false, 'Must enter dashboard directly without role gate');

    console.log('5. Verifying privilege escalation block and optional workspace profile specialization...');
    const adminEsc = await fetch(`${TEST_BASE}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firstData.token}`,
      },
      body: JSON.stringify({ accountType: 'admin' }),
    });
    assert.equal(adminEsc.status, 403, 'Profile update must block selecting admin role');

    const profileUpdate = await fetch(`${TEST_BASE}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firstData.token}`,
      },
      body: JSON.stringify({
        accountType: 'restaurant_donor',
        organization: 'Green Kitchen Bistro',
        location: 'Bengaluru',
      }),
    });
    assert.equal(profileUpdate.status, 200);
    const updatedProfileJson = (await profileUpdate.json()) as {
      user: { role: string; accountType: string; organization: string };
    };
    assert.equal(updatedProfileJson.user.accountType, 'restaurant_donor');
    assert.equal(updatedProfileJson.user.role, 'donor');
    assert.equal(updatedProfileJson.user.organization, 'Green Kitchen Bistro');

    const adminDenied = await fetch(`${TEST_BASE}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${firstData.token}` },
    });
    assert.equal(adminDenied.status, 403);

    console.log('6. Verifying returning Google login preserves profile & creates zero duplicates...');
    const repeatToken = signFirebaseTestToken(mainKey.privateKey, testKid);
    const repeatRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: repeatToken }),
    });
    assert.equal(repeatRes.status, 200);
    const repeatData = (await repeatRes.json()) as {
      user: {
        id: string;
        role: string;
        accountType: string;
        organization: string;
        needsRoleSelection: boolean;
      };
      token: string;
      isNewUser: boolean;
    };
    assert.equal(repeatData.isNewUser, false);
    assert.equal(repeatData.user.id, firstData.user.id, 'Must recognize existing user ID');
    assert.equal(repeatData.user.accountType, 'restaurant_donor');
    assert.equal(repeatData.user.organization, 'Green Kitchen Bistro');
    assert.equal(repeatData.user.needsRoleSelection, false);

    console.log('7. Verifying session persistence via cookie & clean logout...');
    const cookieVal = setCookie1.split(';')[0];
    const meRes = await fetch(`${TEST_BASE}/api/auth/me`, { headers: { Cookie: cookieVal } });
    const meJson = (await meRes.json()) as { user: { id: string } | null };
    assert.equal(meJson.user?.id, firstData.user.id);

    await fetch(`${TEST_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${firstData.token}` },
    });
    const meAfterLogout = await fetch(`${TEST_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${firstData.token}` },
    });
    const meAfterJson = (await meAfterLogout.json()) as { user: unknown | null };
    assert.equal(meAfterJson.user, null, 'Logged-out session must return null');

    console.log('8. Verifying legacy email user links cleanly to Google without creating duplicate records...');
    const dbSeed = new DatabaseSync(TEST_DB);
    const now = new Date().toISOString();
    const preUserId = 'usr_legacy_email_arjun';
    dbSeed
      .prepare(
        `INSERT INTO users (
          id, name, email, password_hash, role, account_type, account_status,
          organization, location, verification_status, public_leaderboard, points, is_demo,
          auth_provider, role_selected, created_at, updated_at
        ) VALUES (?, 'Arjun Mehta', 'arjun.metals@loopcraft.io', 'legacyhash', 'seller', 'material_supplier', 'Active',
          'LoopCraft Metals', 'Chennai', 'Not Submitted', 1, 0, 0, 'email', 1, ?, ?)`
      )
      .run(preUserId, now, now);
    dbSeed.close();

    const linkedToken = signFirebaseTestToken(mainKey.privateKey, testKid, {
      sub: 'fb-uid-2002',
      user_id: 'fb-uid-2002',
      email: 'arjun.metals@loopcraft.io',
      name: 'Arjun Mehta',
      picture: 'https://lh3.googleusercontent.com/a/arjun',
      firebase: {
        sign_in_provider: 'google.com',
        identities: { 'google.com': ['google-sub-2002'] },
      },
    });
    const linkedRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: linkedToken }),
    });
    assert.equal(linkedRes.status, 200);
    const linkedData = (await linkedRes.json()) as {
      user: { id: string; accountType: string; authProvider: string; needsRoleSelection: boolean };
      isNewUser: boolean;
    };
    assert.equal(linkedData.isNewUser, false);
    assert.equal(linkedData.user.id, preUserId, 'Must link to existing account ID');
    assert.equal(linkedData.user.accountType, 'material_supplier');
    assert.equal(linkedData.user.authProvider, 'email+google');

    console.log('9. Verifying suspended user is blocked (403) and total user count has zero duplicates...');
    const dbCheck = new DatabaseSync(TEST_DB);
    dbCheck
      .prepare(
        `UPDATE users SET account_status = 'Suspended', suspension_reason = 'Test compliance hold' WHERE id = ?`
      )
      .run(firstData.user.id);
    const userCount = (dbCheck.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    assert.equal(userCount, 2, 'Total registered users must be exactly 2');
    dbCheck.close();

    const suspRes = await fetch(`${TEST_BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: signFirebaseTestToken(mainKey.privateKey, testKid) }),
    });
    assert.equal(suspRes.status, 403);
    const suspJson = (await suspRes.json()) as { error: string };
    assert.ok(suspJson.error.includes('Test compliance hold'));

    console.log('ALL FIREBASE GOOGLE AUTHENTICATION VERIFICATION CHECKS PASSED!');
  } finally {
    if (serverProc.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
    certsServer.close();
    cleanupTestDb();
  }
}

runTests().catch((err) => {
  console.error('Firebase Google auth verification failed:', err);
  cleanupTestDb();
  process.exit(1);
});
