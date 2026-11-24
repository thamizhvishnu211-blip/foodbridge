import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, RequestHandler, Response } from 'express';
import { createId, db } from './db.ts';
import { DbUserRow, sanitizeUser } from './shared.ts';

const FIREBASE_GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface FirebaseConfigJson {
  projectId?: string;
  authDomain?: string;
  oAuthClientId?: string;
}

interface VerifiedFirebaseClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string;
  googleSub: string | null;
}

let cachedCerts: { keys: Record<string, string>; expiresAtMs: number; sourceUrl: string } | null = null;

export function loadFirebaseConfig(): FirebaseConfigJson | null {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseConfigJson;
    if (!parsed.projectId || parsed.projectId === 'remixed-project-id') return null;
    return parsed;
  } catch {
    return null;
  }
}

function decodeBase64UrlJson<T>(segment: string): T {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

async function fetchFirebasePublicCerts(): Promise<Record<string, string>> {
  const certsUrl = process.env.VERDORA_FIREBASE_CERTS_URL?.trim() || FIREBASE_GOOGLE_CERTS_URL;
  const now = Date.now();
  if (cachedCerts && cachedCerts.sourceUrl === certsUrl && cachedCerts.expiresAtMs > now) {
    return cachedCerts.keys;
  }

  const res = await fetch(certsUrl);
  if (!res.ok) {
    throw new Error(`Unable to fetch Firebase public verification certificates (${res.status}).`);
  }
  const keys = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const maxAgeSec = maxAgeMatch ? Math.max(30, Number(maxAgeMatch[1])) : 300;
  cachedCerts = {
    keys,
    expiresAtMs: now + maxAgeSec * 1000,
    sourceUrl: certsUrl,
  };
  return keys;
}

export async function verifyFirebaseIdToken(idToken: string, projectId: string): Promise<VerifiedFirebaseClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string; typ?: string }>(headerB64);
  const payload = decodeBase64UrlJson<{
    iss?: string;
    aud?: string;
    auth_time?: number;
    user_id?: string;
    sub?: string;
    iat?: number;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    firebase?: {
      sign_in_provider?: string;
      identities?: Record<string, string[]>;
    };
  }>(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid Firebase token signing algorithm.');
  }

  let certs = await fetchFirebasePublicCerts();
  let certPem = certs[header.kid];
  if (!certPem) {
    // Force refresh once in case Google rotated keys
    cachedCerts = null;
    certs = await fetchFirebasePublicCerts();
    certPem = certs[header.kid];
  }
  if (!certPem) {
    throw new Error('Firebase token signing key not recognized.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signatureValid = verifier.verify(certPem, decodeBase64UrlBuffer(sigB64));
  if (!signatureValid) {
    throw new Error('Firebase ID token signature verification failed.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase authentication token has expired. Please sign in again.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase token issued-at timestamp is invalid.');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
    throw new Error('Firebase authentication timestamp is invalid.');
  }
  if (payload.aud !== projectId) {
    throw new Error('Firebase token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase token issuer mismatch.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Firebase token subject is invalid.');
  }
  if (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
    throw new Error('Google account email missing from verified token.');
  }
  if (payload.email_verified !== true) {
    throw new Error('Please verify your email address on your Google account before signing in.');
  }

  const googleIdentities = payload.firebase?.identities?.['google.com'];
  const googleSub =
    Array.isArray(googleIdentities) && typeof googleIdentities[0] === 'string' && googleIdentities[0].trim()
      ? googleIdentities[0].trim()
      : null;

  const normalizedEmail = payload.email.trim().toLowerCase();
  const displayName =
    typeof payload.name === 'string' && payload.name.trim().length >= 2
      ? payload.name.trim().slice(0, 80)
      : normalizedEmail.split('@')[0].slice(0, 80);

  const avatarUrl =
    typeof payload.picture === 'string' && /^https?:\/\//i.test(payload.picture.trim())
      ? payload.picture.trim().slice(0, 500)
      : '';

  return {
    uid: payload.sub.trim(),
    email: normalizedEmail,
    emailVerified: true,
    name: displayName,
    avatarUrl,
    googleSub,
  };
}

export function registerFirebaseAuthRoutes(
  app: Express,
  createSession: (req: Request, res: Response, userId: string) => string,
  authRateLimiter: RequestHandler
) {
  app.get('/api/auth/google/status', (_req, res) => {
    const cfg = loadFirebaseConfig();
    res.json({
      configured: Boolean(cfg?.projectId),
      provider: 'firebase-google',
      projectId: cfg?.projectId ?? null,
    });
  });

  app.post('/api/auth/firebase', authRateLimiter, async (req, res) => {
    const cfg = loadFirebaseConfig();
    if (!cfg?.projectId) {
      res.status(503).json({
        error: 'Firebase Google Authentication is not configured on this server.',
      });
      return;
    }

    const { idToken } = req.body ?? {};
    if (typeof idToken !== 'string' || idToken.trim().length < 20) {
      res.status(400).json({ error: 'Valid Firebase Google ID token is required.' });
      return;
    }

    let claims: VerifiedFirebaseClaims;
    try {
      claims = await verifyFirebaseIdToken(idToken.trim(), cfg.projectId);
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : 'Unable to verify Google authentication token.',
      });
      return;
    }

    const now = new Date().toISOString();
    let finalUserId = '';
    let isNewUser = false;

    db.exec('BEGIN IMMEDIATE');
    try {
      const byUid = db
        .prepare('SELECT * FROM users WHERE firebase_uid = ? AND is_demo = 0')
        .get(claims.uid) as DbUserRow | undefined;

      const byGoogleSub =
        !byUid && claims.googleSub
          ? (db
              .prepare('SELECT * FROM users WHERE google_id = ? AND is_demo = 0')
              .get(claims.googleSub) as DbUserRow | undefined)
          : undefined;

      const existing =
        byUid ??
        byGoogleSub ??
        (db
          .prepare('SELECT * FROM users WHERE LOWER(email) = ? AND is_demo = 0')
          .get(claims.email) as DbUserRow | undefined);

      if (existing) {
        if (existing.account_status === 'Suspended') {
          db.exec('ROLLBACK');
          res.status(403).json({
            error: existing.suspension_reason
              ? `Account is suspended: ${existing.suspension_reason}`
              : 'This account has been suspended by platform administration.',
          });
          return;
        }
        if (existing.account_status === 'Deactivated') {
          db.exec('ROLLBACK');
          res.status(403).json({
            error: 'This account has been deactivated.',
          });
          return;
        }

        const nextProvider =
          existing.auth_provider === 'email' ? 'email+google' : existing.auth_provider || 'google';

        // Recognize returning user and preserve existing role, business organization, and verification status.
        db.prepare(
          `UPDATE users
           SET firebase_uid = COALESCE(firebase_uid, ?),
               google_id = COALESCE(google_id, ?),
               avatar_url = CASE WHEN ? != '' THEN ? ELSE avatar_url END,
               auth_provider = ?,
               role_selected = 1,
               last_login_at = ?,
               last_activity_at = ?,
               updated_at = ?
           WHERE id = ?`
        ).run(
          claims.uid,
          claims.googleSub || claims.uid,
          claims.avatarUrl,
          claims.avatarUrl,
          nextProvider,
          now,
          now,
          now,
          existing.id
        );

        finalUserId = existing.id;
      } else {
        isNewUser = true;
        finalUserId = claims.uid;

        const configuredAdminEmail = process.env.VERDORA_ADMIN_EMAIL?.trim().toLowerCase();
        const isConfiguredOperator = Boolean(configuredAdminEmail && configuredAdminEmail === claims.email);
        const role = isConfiguredOperator ? 'admin' : 'member';
        const accountType = isConfiguredOperator ? 'admin' : 'general_user';
        const verificationStatus = isConfiguredOperator ? 'Approved' : 'Not Submitted';

        // Direct Google profile creation: immediately active and ready for dashboard without registration form.
        db.prepare(
          `INSERT INTO users (
            id, name, email, password_hash, role, account_type, account_status,
            organization, location, whatsapp_number, verification_status,
            public_leaderboard, points, is_demo,
            firebase_uid, google_id, avatar_url, auth_provider, last_login_at, role_selected,
            last_activity_at, created_at, updated_at
          ) VALUES (?, ?, ?, '!google_oauth_no_password!', ?, ?, 'Active', '', '', NULL, ?, 1, 0, 0, ?, ?, ?, 'google', ?, 1, ?, ?, ?)`
        ).run(
          finalUserId,
          claims.name,
          claims.email,
          role,
          accountType,
          verificationStatus,
          claims.uid,
          claims.googleSub || claims.uid,
          claims.avatarUrl || null,
          now,
          now,
          now,
          now
        );

        db.prepare(
          `INSERT INTO user_roles (user_id, role, account_type, assigned_by, assigned_at)
           VALUES (?, ?, ?, 'firebase-google-auth', ?)`
        ).run(finalUserId, role, accountType, now);
      }

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to complete Google sign-in.',
      });
      return;
    }

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(finalUserId) as unknown as DbUserRow;
    const token = createSession(req, res, finalUserId);
    res.json({
      user: sanitizeUser(userRow),
      token,
      isNewUser,
    });
  });
}
