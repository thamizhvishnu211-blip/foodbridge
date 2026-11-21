import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AccountType,
  convertToKgIfEligible,
  createId,
  db,
  initSchemaAndSeed,
  mapAccountTypeToRole,
} from './server/db.ts';
import {
  analyzeFoodDonation,
  analyzeMaterialImage,
  askEcoAssistant,
  AssistantTurn,
  guideResourceSeeker,
  LiveMarketplaceContext,
} from './server/ai.ts';
import { registerOilRoutes } from './server/oilRoutes.ts';
import { registerAdminRoutes } from './server/adminRoutes.ts';
import { registerFirebaseAuthRoutes } from './server/firebaseAuth.ts';
import {
  markVerificationPublished,
  registerListingVerificationRoutes,
  validateAndLockListingVerification,
} from './server/listingVerification.ts';
import {
  fetchPublicFoodDonationsFromFirestore,
  fetchPublicMaterialsFromFirestore,
  fetchPublicOilListingsFromFirestore,
  invalidatePublicSyncCache,
  mergeWithRemoteById,
} from './server/firestorePublicSync.ts';
import {
  addNotification,
  AuthedRequest,
  buildSessionCookieHeader,
  clearSessionCookieHeader,
  createRateLimiter,
  DbUserRow,
  expireOutdatedFoodDonations,
  isValidPhone,
  logAudit,
  mapFoodDonation,
  mapMaterialListing,
  mapOilListing,
  normalizePhoneOrNull,
  requireAdmin,
  requireAuth,
  sanitizeUser,
  SESSION_COOKIE,
  touchUserActivity,
} from './server/shared.ts';

initSchemaAndSeed();

const VALID_CUSTOMER_ACCOUNT_TYPES: AccountType[] = [
  'buyer',
  'material_buyer',
  'material_supplier',
  'restaurant_donor',
  'food_recipient',
  'industrial_buyer',
  'oil_collection_partner',
  'recycling_processor',
  'general_user',
];

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function attachUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = bearerToken || cookies[SESSION_COOKIE];

  if (token) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`
      )
      .get(token, new Date().toISOString()) as DbUserRow | undefined;

    if (row) {
      if (row.account_status === 'Active' && row.is_demo === 0) {
        req.user = row;
        req.sessionToken = token;
      } else {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        res.setHeader('Set-Cookie', clearSessionCookieHeader(req));
      }
    }
  }
  next();
}

function createSession(req: Request, res: Response, userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  res.setHeader('Set-Cookie', buildSessionCookieHeader(req, token, 7 * 86400));
  return token;
}

function isValidListingImageUrl(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('media:')) return /^media:[a-z0-9_-]{2,40}$/i.test(trimmed);
  if (trimmed.startsWith('data:image/')) {
    const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(trimmed);
    if (!match) return false;
    const approxBytes = Math.ceil((match[2].length * 3) / 4);
    return approxBytes <= 5 * 1024 * 1024;
  }
  return /^https?:\/\/.+/.test(trimmed) && trimmed.length <= 2000;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(attachUser);

  const authRateLimiter = createRateLimiter(60_000, 20, 'auth');

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'verdora-api',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    });
  });

  // --- AUTH ---
  app.get('/api/auth/me', (req: AuthedRequest, res) => {
    if (!req.user) {
      res.json({ user: null });
      return;
    }
    res.json({ user: sanitizeUser(req.user) });
  });

  app.post('/api/auth/logout', (req: AuthedRequest, res) => {
    if (req.sessionToken) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    }
    res.setHeader('Set-Cookie', clearSessionCookieHeader(req));
    res.json({ ok: true });
  });

  registerFirebaseAuthRoutes(app, createSession, authRateLimiter);

  app.patch('/api/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    const { name, accountType, organization, location, whatsappNumber, publicLeaderboard } = req.body ?? {};
    if (whatsappNumber !== undefined && whatsappNumber !== null && whatsappNumber !== '' && !isValidPhone(whatsappNumber)) {
      res.status(400).json({ error: 'Invalid WhatsApp phone format.' });
      return;
    }
    if (accountType === 'admin') {
      res.status(403).json({ error: 'Administrator permissions cannot be self-assigned.' });
      return;
    }
    const u = req.user!;
    const now = new Date().toISOString();

    let nextAccountType = u.account_type;
    let nextRole = u.role;
    if (
      u.role !== 'admin' &&
      typeof accountType === 'string' &&
      VALID_CUSTOMER_ACCOUNT_TYPES.includes(accountType as AccountType)
    ) {
      nextAccountType = accountType as AccountType;
      nextRole = mapAccountTypeToRole(nextAccountType);
    }

    db.prepare(
      `UPDATE users
       SET name = ?, role = ?, account_type = ?, organization = ?, location = ?, whatsapp_number = ?, public_leaderboard = ?, updated_at = ?, last_activity_at = ?
       WHERE id = ?`
    ).run(
      typeof name === 'string' && name.trim().length >= 2 ? name.trim().slice(0, 80) : u.name,
      nextRole,
      nextAccountType,
      typeof organization === 'string' ? organization.trim().slice(0, 120) : u.organization,
      typeof location === 'string' ? location.trim().slice(0, 120) : u.location,
      whatsappNumber !== undefined ? normalizePhoneOrNull(whatsappNumber) : u.whatsapp_number,
      typeof publicLeaderboard === 'boolean' ? (publicLeaderboard ? 1 : 0) : u.public_leaderboard,
      now,
      now,
      u.id
    );

    if (u.role !== 'admin' && nextAccountType !== u.account_type) {
      db.prepare(
        `INSERT INTO user_roles (user_id, role, account_type, assigned_by, assigned_at)
         VALUES (?, ?, ?, 'profile-settings', ?)
         ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, account_type = excluded.account_type, assigned_by = 'profile-settings', assigned_at = excluded.assigned_at`
      ).run(u.id, nextRole, nextAccountType, now);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id) as unknown as DbUserRow;
    res.json({ user: sanitizeUser(updated) });
  });

  // --- CATEGORIES ---
  app.get('/api/categories', (_req, res) => {
    const rows = db.prepare('SELECT id, name, slug, type, description, is_active FROM categories ORDER BY type, name').all() as Array<
      Record<string, unknown>
    >;
    res.json({
      categories: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        type: r.type,
        description: r.description,
        isActive: Boolean(r.is_active),
      })),
    });
  });

  app.post('/api/categories', requireAdmin, (req: AuthedRequest, res) => {
    const { name, type, description } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }
    if (type !== 'material' && type !== 'food') {
      res.status(400).json({ error: 'Category type must be material or food.' });
      return;
    }
    const id = createId('cat');
    const slug = `${type}-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(-4)}`;
    db.prepare('INSERT INTO categories (id, name, slug, type, description, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(
      id,
      name.trim(),
      slug,
      type,
      typeof description === 'string' ? description.trim() : ''
    );
    logAudit(req.user!.id, req.user!.name, 'CATEGORY_CREATED', 'category', id, `Created ${type} category: ${name.trim()}`);
    res.status(201).json({ ok: true, id });
  });

  app.patch('/api/categories/:id', requireAdmin, (req: AuthedRequest, res) => {
    const { isActive } = req.body ?? {};
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!cat) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }
    db.prepare('UPDATE categories SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, String(req.params.id));
    logAudit(req.user!.id, req.user!.name, 'CATEGORY_UPDATED', 'category', String(req.params.id), `Set active=${Boolean(isActive)}`);
    res.json({ ok: true });
  });

  // --- MATERIAL MARKETPLACE ---
  app.get('/api/materials', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const condition = typeof req.query.condition === 'string' ? req.query.condition.trim() : '';
    const location = typeof req.query.location === 'string' ? req.query.location.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';

    const rows = db
      .prepare(
        `SELECT * FROM material_listings
         WHERE is_demo = 0 AND is_hidden = 0 AND status != 'Cancelled'
         ORDER BY created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    const remote = await fetchPublicMaterialsFromFirestore();
    let items = mergeWithRemoteById(rows.map(mapMaterialListing), remote).filter(
      (m) => !m.isDemo && !m.isHidden && m.status !== 'Cancelled'
    );

    if (q) {
      items = items.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q) ||
          m.location.toLowerCase().includes(q) ||
          m.reuseApplications.some((r) => r.toLowerCase().includes(q))
      );
    }
    if (category && category !== 'All') {
      items = items.filter((m) => m.category === category);
    }
    if (condition && condition !== 'All') {
      items = items.filter((m) => m.condition === condition);
    }
    if (location) {
      items = items.filter((m) => m.location.toLowerCase().includes(location));
    }
    if (!status) {
      items = items.filter((m) => m.status === 'Active');
    } else if (status !== 'All') {
      items = items.filter((m) => m.status === status);
    }

    if (sort === 'quantity-desc') {
      items.sort((a, b) => b.quantity - a.quantity);
    } else if (sort === 'price-asc') {
      items.sort((a, b) => (a.indicativePrice ?? 999999) - (b.indicativePrice ?? 999999));
    } else {
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    res.json({ listings: items });
  });

  app.get('/api/my/materials', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM material_listings WHERE seller_id = ? AND is_demo = 0 ORDER BY created_at DESC')
      .all(req.user!.id) as Array<Record<string, unknown>>;
    res.json({ listings: rows.map(mapMaterialListing) });
  });

  app.post('/api/materials', requireAuth, (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const errors: string[] = [];
    if (typeof b.title !== 'string' || b.title.trim().length < 3) errors.push('Material title must be at least 3 characters.');
    if (typeof b.category !== 'string' || !b.category.trim()) errors.push('Category is required.');
    if (typeof b.description !== 'string' || b.description.trim().length < 10) errors.push('Description must be at least 10 characters.');
    const qty = Number(b.quantity);
    if (!Number.isFinite(qty) || qty <= 0) errors.push('Quantity must be greater than 0.');
    if (typeof b.unit !== 'string' || !b.unit.trim()) errors.push('Unit is required.');
    if (typeof b.condition !== 'string' || !b.condition.trim()) errors.push('Condition is required.');
    if (typeof b.location !== 'string' || b.location.trim().length < 2) errors.push('Approximate location is required.');
    if (b.whatsappNumber && !isValidPhone(b.whatsappNumber)) errors.push('Invalid WhatsApp number format.');
    if (b.indicativePrice !== undefined && b.indicativePrice !== null && b.indicativePrice !== '') {
      const parsedPrice = Number(b.indicativePrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) errors.push('Indicative price must be 0 or greater.');
    }
    if (b.availableUntil !== undefined && b.availableUntil !== null && String(b.availableUntil).trim() !== '') {
      if (typeof b.availableUntil !== 'string' || Number.isNaN(new Date(b.availableUntil).getTime())) {
        errors.push('Available until date is invalid.');
      }
    }
    if (b.imageUrl !== undefined && b.imageUrl !== null && String(b.imageUrl).trim() !== '' && !isValidListingImageUrl(b.imageUrl)) {
      errors.push('Listing photo must be a valid JPEG, PNG, WebP image (up to 5 MB) or preset.');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    const u = req.user!;
    const imageUrl =
      typeof b.imageUrl === 'string' && b.imageUrl.trim() ? b.imageUrl.trim() : 'media:aluminium';
    const price =
      b.indicativePrice !== undefined && b.indicativePrice !== null && b.indicativePrice !== ''
        ? Math.max(0, Number(b.indicativePrice))
        : null;

    const verificationCheck = validateAndLockListingVerification({
      verificationId: b.verificationId,
      userId: u.id,
      listingType: 'material',
      candidatePayload: {
        title: b.title.trim(),
        category: b.category.trim(),
        description: b.description.trim(),
        quantity: qty,
        unit: b.unit.trim(),
        condition: b.condition.trim(),
        location: b.location.trim(),
        indicativePrice: Number.isFinite(price as number) ? price : null,
        imageUrl,
      },
    });
    if (!verificationCheck.ok) {
      res.status(verificationCheck.statusCode).json({ error: verificationCheck.error });
      return;
    }

    const id = createId('mat');
    const now = new Date().toISOString();
    const availableUntil =
      typeof b.availableUntil === 'string' && b.availableUntil.trim()
        ? new Date(b.availableUntil).toISOString()
        : new Date(Date.now() + 21 * 86400_000).toISOString();

    const reuseApps = Array.isArray(b.reuseApplications)
      ? b.reuseApplications.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 8)
      : typeof b.reuseApplications === 'string'
        ? b.reuseApplications.split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 8)
        : [];

    const whatsapp =
      b.whatsappNumber !== undefined
        ? (normalizePhoneOrNull(b.whatsappNumber) ?? u.whatsapp_number)
        : u.whatsapp_number;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO material_listings (
          id, seller_id, seller_name, seller_organization, seller_verified, title, category,
          description, quantity, unit, condition, location, indicative_price, currency,
          image_url, available_until, pickup_preferences, reuse_applications, whatsapp_number,
          status, is_hidden, is_demo, verification_id, ai_verification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'Active', 0, 0, ?, ?, ?, ?)`
      ).run(
        id,
        u.id,
        u.name,
        u.organization,
        u.verification_status === 'Approved' ? 1 : 0,
        b.title.trim().slice(0, 120),
        b.category.trim(),
        b.description.trim().slice(0, 1500),
        qty,
        b.unit.trim().slice(0, 24),
        b.condition.trim(),
        b.location.trim().slice(0, 120),
        Number.isFinite(price as number) ? price : null,
        imageUrl,
        availableUntil,
        typeof b.pickupPreferences === 'string' ? b.pickupPreferences.trim().slice(0, 300) : '',
        JSON.stringify(reuseApps),
        whatsapp,
        verificationCheck.verificationId,
        verificationCheck.aiStatus,
        now,
        now
      );
      markVerificationPublished(verificationCheck.verificationId, id);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to publish listing.' });
      return;
    }

    invalidatePublicSyncCache('material_listings');
    touchUserActivity(u.id);
    const row = db.prepare('SELECT * FROM material_listings WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ listing: mapMaterialListing(row) });
  });

  function cancelMaterialListing(listingId: string, actor: DbUserRow): { statusCode: number; error?: string; listing?: ReturnType<typeof mapMaterialListing> } {
    try {
      db.exec('BEGIN IMMEDIATE');
      const existing = db.prepare('SELECT * FROM material_listings WHERE id = ?').get(listingId) as
        | Record<string, unknown>
        | undefined;
      if (!existing) {
        db.exec('ROLLBACK');
        return { statusCode: 404, error: 'Material listing not found.' };
      }
      if (existing.seller_id !== actor.id && actor.role !== 'admin') {
        db.exec('ROLLBACK');
        return { statusCode: 403, error: 'You do not have permission to cancel this listing.' };
      }
      const currentStatus = String(existing.status);
      if (currentStatus === 'Completed' || currentStatus === 'Cancelled') {
        db.exec('ROLLBACK');
        return { statusCode: 409, error: `Cannot cancel a listing that is already ${currentStatus}.` };
      }

      const blocking = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM material_requests
             WHERE listing_id = ? AND status IN ('Accepted','Coordination In Progress','Pickup Scheduled','Collected','Completed')`
          )
          .get(listingId) as { c: number }
      ).c;

      if (blocking > 0) {
        db.exec('ROLLBACK');
        return {
          statusCode: 409,
          error: 'Cannot cancel listing with accepted, scheduled, or completed material requests.',
        };
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE material_listings SET status = 'Cancelled', updated_at = ? WHERE id = ?`).run(now, listingId);

      const pendingRequests = db
        .prepare(`SELECT id, buyer_id FROM material_requests WHERE listing_id = ? AND status = 'Request Created'`)
        .all(listingId) as Array<{ id: string; buyer_id: string }>;

      if (pendingRequests.length > 0) {
        db.prepare(
          `UPDATE material_requests SET status = 'Declined', updated_at = ? WHERE listing_id = ? AND status = 'Request Created'`
        ).run(now, listingId);
        for (const pr of pendingRequests) {
          addNotification(
            pr.buyer_id,
            'Material Listing Cancelled',
            `The listing "${existing.title}" was cancelled by the supplier before your request was accepted.`,
            'workspace'
          );
        }
      }

      touchUserActivity(actor.id);
      if (actor.role === 'admin' && existing.seller_id !== actor.id) {
        logAudit(
          actor.id,
          actor.name,
          'LISTING_CANCELLED',
          'material',
          listingId,
          `Cancelled material listing "${existing.title}"`,
          { targetUserId: String(existing.seller_id) }
        );
      }

      const updated = db.prepare('SELECT * FROM material_listings WHERE id = ?').get(listingId) as Record<string, unknown>;
      db.exec('COMMIT');
      return { statusCode: 200, listing: mapMaterialListing(updated) };
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      return {
        statusCode: 500,
        error: err instanceof Error ? err.message : 'Failed to cancel material listing.',
      };
    }
  }

  app.post('/api/materials/:id/cancel', requireAuth, (req: AuthedRequest, res) => {
    const result = cancelMaterialListing(String(req.params.id), req.user!);
    if (result.error) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }
    invalidatePublicSyncCache('material_listings');
    res.json({ listing: result.listing });
  });

  app.patch('/api/materials/:id', requireAuth, (req: AuthedRequest, res) => {
    const existing = db.prepare('SELECT * FROM material_listings WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Material listing not found.' });
      return;
    }
    if (existing.seller_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You do not have permission to edit this listing.' });
      return;
    }

    const b = req.body ?? {};
    if (b.status === 'Cancelled') {
      const cancelResult = cancelMaterialListing(String(req.params.id), req.user!);
      if (cancelResult.error) {
        res.status(cancelResult.statusCode).json({ error: cancelResult.error });
        return;
      }
      res.json({ listing: cancelResult.listing });
      return;
    }

    const existingStatus = String(existing.status);
    if ((existingStatus === 'Completed' || existingStatus === 'Cancelled') && req.user!.role !== 'admin') {
      res.status(409).json({ error: `Cannot edit a listing that is already ${existingStatus}.` });
      return;
    }

    const errors: string[] = [];
    if (b.title !== undefined && (typeof b.title !== 'string' || b.title.trim().length < 3)) {
      errors.push('Material title must be at least 3 characters.');
    }
    if (b.category !== undefined && (typeof b.category !== 'string' || !b.category.trim())) {
      errors.push('Category is required.');
    }
    if (b.description !== undefined && (typeof b.description !== 'string' || b.description.trim().length < 10)) {
      errors.push('Description must be at least 10 characters.');
    }
    const nextQty = b.quantity !== undefined ? Number(b.quantity) : Number(existing.quantity);
    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      errors.push('Quantity must be greater than 0.');
    }
    if (b.unit !== undefined && (typeof b.unit !== 'string' || !b.unit.trim())) {
      errors.push('Unit is required.');
    }
    if (b.condition !== undefined && (typeof b.condition !== 'string' || !b.condition.trim())) {
      errors.push('Condition is required.');
    }
    if (b.location !== undefined && (typeof b.location !== 'string' || b.location.trim().length < 2)) {
      errors.push('Approximate location is required.');
    }
    if (b.whatsappNumber !== undefined && b.whatsappNumber !== null && String(b.whatsappNumber).trim() !== '' && !isValidPhone(b.whatsappNumber)) {
      errors.push('Invalid WhatsApp number format.');
    }
    if (b.indicativePrice !== undefined && b.indicativePrice !== null && b.indicativePrice !== '') {
      const parsedPrice = Number(b.indicativePrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        errors.push('Indicative price must be 0 or greater.');
      }
    }
    if (b.availableUntil !== undefined) {
      if (typeof b.availableUntil !== 'string' || !b.availableUntil.trim() || Number.isNaN(new Date(b.availableUntil).getTime())) {
        errors.push('Available until date is invalid.');
      }
    }
    if (b.imageUrl !== undefined) {
      if (!isValidListingImageUrl(b.imageUrl)) {
        errors.push('Listing photo must be a valid JPEG, PNG, WebP image (up to 5 MB) or preset.');
      }
    }

    const allowedStatuses =
      req.user!.role === 'admin'
        ? ['Active', 'Paused', 'Unavailable', 'Completed']
        : ['Active', 'Paused', 'Unavailable'];
    if (b.status !== undefined && !allowedStatuses.includes(String(b.status))) {
      errors.push('Invalid listing status transition.');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    const committedQty = (
      db
        .prepare(
          `SELECT COALESCE(SUM(requested_quantity), 0) as total
           FROM material_requests
           WHERE listing_id = ? AND status IN ('Accepted','Coordination In Progress','Pickup Scheduled','Collected','Completed')`
        )
        .get(req.params.id) as { total: number }
    ).total;

    if (b.quantity !== undefined && nextQty < committedQty) {
      res.status(409).json({
        error: `Cannot reduce quantity below ${committedQty} ${String(existing.unit)} already committed to accepted or completed requests.`,
      });
      return;
    }

    const nextStatus = b.status !== undefined ? String(b.status) : existingStatus;
    const reuseApps =
      b.reuseApplications !== undefined
        ? JSON.stringify(
            (Array.isArray(b.reuseApplications)
              ? b.reuseApplications.map((x: unknown) => String(x).trim())
              : typeof b.reuseApplications === 'string'
                ? b.reuseApplications.split(',').map((s: string) => s.trim())
                : []
            )
              .filter(Boolean)
              .slice(0, 8)
          )
        : String(existing.reuse_applications ?? '[]');

    const nextIndicativePrice =
      b.indicativePrice !== undefined
        ? (b.indicativePrice === null || b.indicativePrice === '' ? null : Math.max(0, Number(b.indicativePrice)))
        : (existing.indicative_price === null ? null : Number(existing.indicative_price));

    const nextAvailableUntil =
      b.availableUntil !== undefined ? new Date(b.availableUntil).toISOString() : String(existing.available_until);

    const nextImageUrl =
      b.imageUrl !== undefined ? String(b.imageUrl).trim() : String(existing.image_url);

    const nextWhatsapp =
      b.whatsappNumber !== undefined
        ? normalizePhoneOrNull(b.whatsappNumber)
        : (existing.whatsapp_number ? String(existing.whatsapp_number) : null);

    db.prepare(
      `UPDATE material_listings
       SET title = ?, category = ?, description = ?, quantity = ?, unit = ?, condition = ?,
           location = ?, indicative_price = ?, image_url = ?, available_until = ?,
           pickup_preferences = ?, reuse_applications = ?, whatsapp_number = ?,
           status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      b.title !== undefined ? String(b.title).trim().slice(0, 120) : String(existing.title),
      b.category !== undefined ? String(b.category).trim() : String(existing.category),
      b.description !== undefined ? String(b.description).trim().slice(0, 1500) : String(existing.description),
      nextQty,
      b.unit !== undefined ? String(b.unit).trim().slice(0, 24) : String(existing.unit),
      b.condition !== undefined ? String(b.condition).trim() : String(existing.condition),
      b.location !== undefined ? String(b.location).trim().slice(0, 120) : String(existing.location),
      nextIndicativePrice,
      nextImageUrl,
      nextAvailableUntil,
      b.pickupPreferences !== undefined
        ? String(b.pickupPreferences ?? '').trim().slice(0, 300)
        : String(existing.pickup_preferences ?? ''),
      reuseApps,
      nextWhatsapp,
      nextStatus,
      new Date().toISOString(),
      String(req.params.id)
    );

    touchUserActivity(req.user!.id);
    if (req.user!.role === 'admin' && existing.seller_id !== req.user!.id) {
      logAudit(
        req.user!.id,
        req.user!.name,
        'LISTING_MODERATED',
        'material',
        String(req.params.id),
        `Updated status=${nextStatus}`,
        { targetUserId: String(existing.seller_id) }
      );
    }

    invalidatePublicSyncCache('material_listings');
    const updated = db.prepare('SELECT * FROM material_listings WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ listing: mapMaterialListing(updated) });
  });

  // --- MATERIAL REQUESTS & PICKUP COORDINATION ---
  app.get('/api/material-requests', requireAuth, (req: AuthedRequest, res) => {
    const u = req.user!;
    const rows = db
      .prepare(
        `SELECT mr.*, ml.title as listing_title, ml.category as listing_category, ml.unit as listing_unit,
                ml.location as listing_location, ml.seller_id, ml.seller_name, ml.whatsapp_number as seller_whatsapp,
                bu.whatsapp_number as buyer_whatsapp
         FROM material_requests mr
         JOIN material_listings ml ON ml.id = mr.listing_id
         JOIN users bu ON bu.id = mr.buyer_id
         WHERE mr.is_demo = 0 AND (? = 'admin' OR mr.buyer_id = ? OR ml.seller_id = ?)
         ORDER BY mr.updated_at DESC`
      )
      .all(u.role, u.id, u.id) as Array<Record<string, unknown>>;

    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        listingId: r.listing_id,
        listingTitle: r.listing_title,
        listingCategory: r.listing_category,
        listingUnit: r.listing_unit,
        listingLocation: r.listing_location,
        sellerId: r.seller_id,
        sellerName: r.seller_name,
        sellerWhatsapp: r.seller_whatsapp,
        buyerId: r.buyer_id,
        buyerName: r.buyer_name,
        buyerWhatsapp: r.buyer_whatsapp,
        requestedQuantity: Number(r.requested_quantity),
        intendedUse: r.intended_use,
        preferredDate: r.preferred_date,
        preferredTime: r.preferred_time,
        arrangement: r.arrangement,
        notes: r.notes,
        status: r.status,
        handoverConfirmedByBuyer: Boolean(r.handover_confirmed_by_buyer),
        handoverConfirmedBySeller: Boolean(r.handover_confirmed_by_seller),
        isDemo: false,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  app.post('/api/material-requests', requireAuth, (req: AuthedRequest, res) => {
    const { listingId, requestedQuantity, intendedUse, preferredDate, preferredTime, arrangement, notes } = req.body ?? {};
    const listing = db
      .prepare('SELECT * FROM material_listings WHERE id = ? AND is_demo = 0 AND is_hidden = 0')
      .get(String(listingId || '')) as Record<string, unknown> | undefined;

    if (!listing) {
      res.status(404).json({ error: 'Material listing not found.' });
      return;
    }
    if (listing.status !== 'Active') {
      res.status(400).json({ error: `This listing is currently ${listing.status} and cannot accept new requests.` });
      return;
    }
    if (listing.seller_id === req.user!.id) {
      res.status(400).json({ error: 'You cannot request your own material listing.' });
      return;
    }
    const qty = Number(requestedQuantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > Number(listing.quantity)) {
      res.status(400).json({ error: `Requested quantity must be between 1 and ${listing.quantity} ${listing.unit}.` });
      return;
    }
    if (typeof intendedUse !== 'string' || intendedUse.trim().length < 4) {
      res.status(400).json({ error: 'Please briefly describe your intended reuse application.' });
      return;
    }
    const safeArrangement = arrangement === 'Delivery Coordination' ? 'Delivery Coordination' : 'Pickup';
    const id = createId('mreq');
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO material_requests (
        id, listing_id, buyer_id, buyer_name, requested_quantity, intended_use,
        preferred_date, preferred_time, arrangement, notes, status,
        handover_confirmed_by_buyer, handover_confirmed_by_seller, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Request Created', 0, 0, 0, ?, ?)`
    ).run(
      id,
      String(listing.id),
      req.user!.id,
      req.user!.name,
      qty,
      intendedUse.trim().slice(0, 300),
      typeof preferredDate === 'string' && preferredDate ? preferredDate : new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
      typeof preferredTime === 'string' && preferredTime ? preferredTime : '10:00',
      safeArrangement,
      typeof notes === 'string' ? notes.trim().slice(0, 500) : '',
      now,
      now
    );

    touchUserActivity(req.user!.id);
    addNotification(
      String(listing.seller_id),
      'New Material Request',
      `${req.user!.name} requested ${qty} ${listing.unit} of "${listing.title}".`,
      'workspace'
    );

    res.status(201).json({ ok: true, id });
  });

  app.patch('/api/material-requests/:id/status', requireAuth, (req: AuthedRequest, res) => {
    const { status, preferredDate, preferredTime, notes } = req.body ?? {};
    const validStatuses = [
      'Accepted',
      'Coordination In Progress',
      'Pickup Scheduled',
      'Collected',
      'Completed',
      'Declined',
      'Cancelled',
    ];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status transition.' });
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db
        .prepare(
          `SELECT mr.*, ml.seller_id, ml.seller_verified, ml.title as listing_title, ml.category as listing_category,
                  ml.unit as listing_unit, ml.quantity as listing_quantity
           FROM material_requests mr
           JOIN material_listings ml ON ml.id = mr.listing_id
           WHERE mr.id = ?`
        )
        .get(req.params.id) as Record<string, unknown> | undefined;

      if (!row) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Request not found.' });
        return;
      }

      const u = req.user!;
      const isSeller = row.seller_id === u.id;
      const isBuyer = row.buyer_id === u.id;
      const isAdmin = u.role === 'admin';
      if (!isSeller && !isBuyer && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Not authorized to modify this request.' });
        return;
      }

      const currentStatus = String(row.status);
      if (['Completed', 'Declined', 'Cancelled'].includes(currentStatus)) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: `Cannot transition a request that is already ${currentStatus}.` });
        return;
      }

      if ((status === 'Accepted' || status === 'Declined') && !isSeller && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Only the seller can accept or decline this request.' });
        return;
      }
      if (status === 'Cancelled' && !isBuyer && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Only the buyer can cancel this request.' });
        return;
      }

      const now = new Date().toISOString();
      const nextDate = typeof preferredDate === 'string' && preferredDate ? preferredDate : String(row.preferred_date);
      const nextTime = typeof preferredTime === 'string' && preferredTime ? preferredTime : String(row.preferred_time);
      const nextNotes = typeof notes === 'string' ? notes.trim().slice(0, 500) : String(row.notes ?? '');

      db.prepare(
        `UPDATE material_requests
         SET status = ?, preferred_date = ?, preferred_time = ?, notes = ?,
             handover_confirmed_by_seller = CASE WHEN ? = 'Completed' AND ? = 1 THEN 1 ELSE handover_confirmed_by_seller END,
             handover_confirmed_by_buyer = CASE WHEN ? = 'Completed' AND ? = 1 THEN 1 ELSE handover_confirmed_by_buyer END,
             updated_at = ?
         WHERE id = ?`
      ).run(
        status,
        nextDate,
        nextTime,
        nextNotes,
        status,
        isSeller ? 1 : 0,
        status,
        isBuyer ? 1 : 0,
        now,
        String(req.params.id)
      );

      if (status === 'Completed') {
        // Mark the purchased/handed-over product Completed so it is immediately removed from Marketplace discovery
        db.prepare(`UPDATE material_listings SET status = 'Completed', updated_at = ? WHERE id = ?`).run(
          now,
          String(row.listing_id)
        );

        // Decline any other open pending requests for the same completed listing
        const otherOpenReqs = db
          .prepare(
            `SELECT id, buyer_id FROM material_requests
             WHERE listing_id = ? AND id != ? AND status = 'Request Created'`
          )
          .all(String(row.listing_id), String(row.id)) as Array<{ id: string; buyer_id: string }>;

        if (otherOpenReqs.length > 0) {
          db.prepare(
            `UPDATE material_requests SET status = 'Declined', updated_at = ?
             WHERE listing_id = ? AND id != ? AND status = 'Request Created'`
          ).run(now, String(row.listing_id), String(row.id));

          for (const other of otherOpenReqs) {
            addNotification(
              other.buyer_id,
              'Listing Completed',
              `"${row.listing_title}" has already been completed with another buyer and is no longer available.`,
              'workspace'
            );
          }
        }

        const ledgerId = `mat_req_${String(row.id)}`;
        const alreadyRecorded = db.prepare('SELECT id FROM impact_ledger WHERE id = ?').get(ledgerId);
        if (!alreadyRecorded) {
          const massKg = convertToKgIfEligible(Number(row.requested_quantity), String(row.listing_unit));
          const points = 120;
          const isVerified = Number(row.seller_verified) === 1 ? 1 : 0;
          db.prepare(
            `INSERT INTO impact_ledger (id, source_type, source_id, user_id, category, mass_kg, portions, liters, points_awarded, is_verified, is_demo, completed_at)
             VALUES (?, 'material', ?, ?, ?, ?, 0, 0, ?, ?, 0, ?)`
          ).run(ledgerId, String(row.id), String(row.seller_id), String(row.listing_category), massKg, points, isVerified, now);

          db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(points, String(row.seller_id));
          db.prepare('UPDATE users SET points = points + 60 WHERE id = ?').run(String(row.buyer_id));
        }
      }

      touchUserActivity(u.id);
      const targetNotifyUser = isSeller ? String(row.buyer_id) : String(row.seller_id);
      addNotification(
        targetNotifyUser,
        `Material Request ${status}`,
        `Request for "${row.listing_title}" moved to ${status}.`,
        'workspace'
      );

      db.exec('COMMIT');
      invalidatePublicSyncCache('material_listings');
      res.json({ ok: true, status });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update material request.' });
    }
  });

  // --- FOOD RESCUE ---
  app.get('/api/food-donations', async (req, res) => {
    expireOutdatedFoodDonations();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const location = typeof req.query.location === 'string' ? req.query.location.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const includeEnded = req.query.includeEnded === 'true';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'deadline';

    const rows = db
      .prepare(
        `SELECT * FROM food_donations
         WHERE is_demo = 0 AND is_hidden = 0 AND status != 'Cancelled'
         ORDER BY created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    const remote = await fetchPublicFoodDonationsFromFirestore();
    let items = mergeWithRemoteById(rows.map(mapFoodDonation), remote).filter(
      (d) => !d.isDemo && !d.isHidden && d.status !== 'Cancelled'
    );

    if (q) {
      items = items.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q) ||
          d.dietaryInfo.toLowerCase().includes(q) ||
          d.location.toLowerCase().includes(q)
      );
    }
    if (category && category !== 'All') {
      items = items.filter((d) => d.category === category);
    }
    if (location) {
      items = items.filter((d) => d.location.toLowerCase().includes(location));
    }
    if (status && status !== 'All') {
      items = items.filter((d) => d.status === status);
    } else if (!includeEnded && status !== 'All') {
      items = items.filter((d) => !['Completed', 'Expired', 'Cancelled'].includes(d.status));
    }

    if (sort === 'portions-desc') {
      items.sort((a, b) => b.remainingPortions - a.remainingPortions);
    } else if (sort === 'newest') {
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      items.sort((a, b) => new Date(a.pickupDeadline).getTime() - new Date(b.pickupDeadline).getTime());
    }

    res.json({ donations: items });
  });

  app.get('/api/my/food-donations', requireAuth, (req: AuthedRequest, res) => {
    expireOutdatedFoodDonations();
    const rows = db
      .prepare('SELECT * FROM food_donations WHERE donor_id = ? AND is_demo = 0 ORDER BY created_at DESC')
      .all(req.user!.id) as Array<Record<string, unknown>>;
    res.json({ donations: rows.map(mapFoodDonation) });
  });

  app.post('/api/food-donations', requireAuth, (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const errors: string[] = [];
    if (typeof b.title !== 'string' || b.title.trim().length < 3) errors.push('Food title must be at least 3 characters.');
    if (typeof b.category !== 'string' || !b.category.trim()) errors.push('Food category is required.');
    if (typeof b.description !== 'string' || b.description.trim().length < 10) errors.push('Description must be at least 10 characters.');
    const qty = Number(b.quantity);
    const portions = Number(b.portions);
    if (!Number.isFinite(qty) || qty <= 0) errors.push('Quantity must be greater than 0.');
    if (!Number.isInteger(portions) || portions <= 0) errors.push('Portions must be a whole number greater than 0.');
    if (typeof b.location !== 'string' || b.location.trim().length < 2) errors.push('Pickup location is required.');
    if (typeof b.pickupDeadline !== 'string' || Number.isNaN(new Date(b.pickupDeadline).getTime())) {
      errors.push('Valid pickup deadline date/time is required.');
    } else if (new Date(b.pickupDeadline).getTime() <= Date.now()) {
      errors.push('Pickup deadline must be in the future.');
    }
    if (b.preparedAt !== undefined && b.preparedAt !== null && String(b.preparedAt).trim() !== '') {
      if (typeof b.preparedAt !== 'string' || Number.isNaN(new Date(b.preparedAt).getTime())) {
        errors.push('Preparation date/time is invalid.');
      }
    }
    if (b.whatsappNumber && !isValidPhone(b.whatsappNumber)) errors.push('Invalid WhatsApp number format.');
    if (b.imageUrl !== undefined && b.imageUrl !== null && String(b.imageUrl).trim() !== '' && !isValidListingImageUrl(b.imageUrl)) {
      errors.push('Food photo must be a valid JPEG, PNG, WebP image (up to 5 MB) or preset.');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    const u = req.user!;
    const unitVal = typeof b.unit === 'string' && b.unit.trim() ? b.unit.trim().slice(0, 24) : 'kg';
    const imageUrl = typeof b.imageUrl === 'string' && b.imageUrl.trim() ? b.imageUrl.trim() : 'media:bakery';
    const storageInfo = typeof b.storageInfo === 'string' ? b.storageInfo.trim().slice(0, 300) : '';
    const allergens = typeof b.allergens === 'string' ? b.allergens.trim().slice(0, 300) : '';

    const verificationCheck = validateAndLockListingVerification({
      verificationId: b.verificationId,
      userId: u.id,
      listingType: 'food',
      candidatePayload: {
        title: b.title.trim(),
        category: b.category.trim(),
        description: b.description.trim(),
        quantity: qty,
        unit: unitVal,
        portions,
        location: b.location.trim(),
        storageInfo,
        allergens,
        imageUrl,
      },
    });
    if (!verificationCheck.ok) {
      res.status(verificationCheck.statusCode).json({ error: verificationCheck.error });
      return;
    }

    const id = createId('food');
    const now = new Date().toISOString();
    const normalizedDeadline = new Date(b.pickupDeadline).toISOString();
    const availableUntil =
      typeof b.availableUntil === 'string' && !Number.isNaN(new Date(b.availableUntil).getTime())
        ? new Date(b.availableUntil).toISOString()
        : normalizedDeadline;
    const preparedAt =
      typeof b.preparedAt === 'string' && b.preparedAt.trim() ? new Date(b.preparedAt).toISOString() : null;
    const whatsapp =
      b.whatsappNumber !== undefined
        ? (normalizePhoneOrNull(b.whatsappNumber) ?? u.whatsapp_number)
        : u.whatsapp_number;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO food_donations (
          id, donor_id, donor_name, donor_organization, donor_verified, title, description,
          category, quantity, unit, portions, remaining_portions, prepared_at, available_until,
          pickup_deadline, storage_info, packaging_info, allergens, dietary_info, location,
          collection_instructions, image_url, whatsapp_number, status, is_hidden, is_demo,
          verification_id, ai_verification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available', 0, 0, ?, ?, ?, ?)`
      ).run(
        id,
        u.id,
        u.name,
        u.organization,
        u.verification_status === 'Approved' ? 1 : 0,
        b.title.trim().slice(0, 120),
        b.description.trim().slice(0, 1500),
        b.category.trim(),
        qty,
        unitVal,
        portions,
        portions,
        preparedAt,
        availableUntil,
        normalizedDeadline,
        storageInfo,
        typeof b.packagingInfo === 'string' ? b.packagingInfo.trim().slice(0, 300) : '',
        allergens,
        typeof b.dietaryInfo === 'string' ? b.dietaryInfo.trim().slice(0, 200) : '',
        b.location.trim().slice(0, 120),
        typeof b.collectionInstructions === 'string' ? b.collectionInstructions.trim().slice(0, 400) : '',
        imageUrl,
        whatsapp,
        verificationCheck.verificationId,
        verificationCheck.aiStatus,
        now,
        now
      );
      markVerificationPublished(verificationCheck.verificationId, id);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to publish food donation.' });
      return;
    }

    invalidatePublicSyncCache('food_donations');
    touchUserActivity(u.id);
    const created = db.prepare('SELECT * FROM food_donations WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ donation: mapFoodDonation(created) });
  });

  function cancelFoodDonation(donationId: string, actor: DbUserRow): { statusCode: number; error?: string; donation?: ReturnType<typeof mapFoodDonation> } {
    expireOutdatedFoodDonations();
    try {
      db.exec('BEGIN IMMEDIATE');
      const existing = db.prepare('SELECT * FROM food_donations WHERE id = ?').get(donationId) as
        | Record<string, unknown>
        | undefined;
      if (!existing) {
        db.exec('ROLLBACK');
        return { statusCode: 404, error: 'Food donation not found.' };
      }
      if (existing.donor_id !== actor.id && actor.role !== 'admin') {
        db.exec('ROLLBACK');
        return { statusCode: 403, error: 'You do not have permission to cancel this food donation.' };
      }

      const currentStatus = String(existing.status);
      if (['Completed', 'Cancelled', 'Expired'].includes(currentStatus)) {
        db.exec('ROLLBACK');
        return { statusCode: 409, error: `Cannot cancel a food donation that is already ${currentStatus}.` };
      }

      const blocking = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM food_requests
             WHERE donation_id = ? AND status IN ('Accepted','Coordination In Progress','Pickup Scheduled','Completed')`
          )
          .get(donationId) as { c: number }
      ).c;

      if (blocking > 0) {
        db.exec('ROLLBACK');
        return {
          statusCode: 409,
          error: 'Cannot cancel food donation with accepted, scheduled, or completed collection requests.',
        };
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE food_donations SET status = 'Cancelled', updated_at = ? WHERE id = ?`).run(now, donationId);

      const pendingRequests = db
        .prepare(`SELECT id, recipient_id FROM food_requests WHERE donation_id = ? AND status = 'Request Received'`)
        .all(donationId) as Array<{ id: string; recipient_id: string }>;

      if (pendingRequests.length > 0) {
        db.prepare(
          `UPDATE food_requests SET status = 'Declined', updated_at = ? WHERE donation_id = ? AND status = 'Request Received'`
        ).run(now, donationId);
        for (const pr of pendingRequests) {
          addNotification(
            pr.recipient_id,
            'Food Donation Cancelled',
            `The food donation "${existing.title}" was cancelled by the donor before acceptance.`,
            'workspace'
          );
        }
      }

      touchUserActivity(actor.id);
      if (actor.role === 'admin' && existing.donor_id !== actor.id) {
        logAudit(
          actor.id,
          actor.name,
          'FOOD_DONATION_CANCELLED',
          'food',
          donationId,
          `Cancelled food donation "${existing.title}"`,
          { targetUserId: String(existing.donor_id) }
        );
      }

      const updated = db.prepare('SELECT * FROM food_donations WHERE id = ?').get(donationId) as Record<string, unknown>;
      db.exec('COMMIT');
      return { statusCode: 200, donation: mapFoodDonation(updated) };
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      return {
        statusCode: 500,
        error: err instanceof Error ? err.message : 'Failed to cancel food donation.',
      };
    }
  }

  app.post('/api/food-donations/:id/cancel', requireAuth, (req: AuthedRequest, res) => {
    const result = cancelFoodDonation(String(req.params.id), req.user!);
    if (result.error) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }
    invalidatePublicSyncCache('food_donations');
    res.json({ donation: result.donation });
  });

  app.patch('/api/food-donations/:id', requireAuth, (req: AuthedRequest, res) => {
    expireOutdatedFoodDonations();
    const existing = db.prepare('SELECT * FROM food_donations WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Food donation not found.' });
      return;
    }
    if (existing.donor_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You do not have permission to edit this food donation.' });
      return;
    }

    const b = req.body ?? {};
    if (b.status === 'Cancelled') {
      const cancelResult = cancelFoodDonation(String(req.params.id), req.user!);
      if (cancelResult.error) {
        res.status(cancelResult.statusCode).json({ error: cancelResult.error });
        return;
      }
      res.json({ donation: cancelResult.donation });
      return;
    }

    const existingStatus = String(existing.status);
    if (['Completed', 'Cancelled', 'Expired'].includes(existingStatus) && req.user!.role !== 'admin') {
      res.status(409).json({ error: `Cannot edit a food donation that is already ${existingStatus}.` });
      return;
    }

    const errors: string[] = [];
    if (b.title !== undefined && (typeof b.title !== 'string' || b.title.trim().length < 3)) {
      errors.push('Food title must be at least 3 characters.');
    }
    if (b.category !== undefined && (typeof b.category !== 'string' || !b.category.trim())) {
      errors.push('Food category is required.');
    }
    if (b.description !== undefined && (typeof b.description !== 'string' || b.description.trim().length < 10)) {
      errors.push('Description must be at least 10 characters.');
    }
    const nextQty = b.quantity !== undefined ? Number(b.quantity) : Number(existing.quantity);
    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      errors.push('Quantity must be greater than 0.');
    }
    const nextPortions = b.portions !== undefined ? Number(b.portions) : Number(existing.portions);
    if (!Number.isInteger(nextPortions) || nextPortions <= 0) {
      errors.push('Portions must be a whole number greater than 0.');
    }
    if (b.unit !== undefined && (typeof b.unit !== 'string' || !b.unit.trim())) {
      errors.push('Unit is required.');
    }
    if (b.location !== undefined && (typeof b.location !== 'string' || b.location.trim().length < 2)) {
      errors.push('Pickup location is required.');
    }
    if (b.pickupDeadline !== undefined) {
      if (typeof b.pickupDeadline !== 'string' || Number.isNaN(new Date(b.pickupDeadline).getTime())) {
        errors.push('Valid pickup deadline date/time is required.');
      } else if (new Date(b.pickupDeadline).getTime() <= Date.now()) {
        errors.push('Pickup deadline must be in the future.');
      }
    }
    if (b.preparedAt !== undefined && b.preparedAt !== null && String(b.preparedAt).trim() !== '') {
      if (typeof b.preparedAt !== 'string' || Number.isNaN(new Date(b.preparedAt).getTime())) {
        errors.push('Preparation date/time is invalid.');
      }
    }
    if (b.whatsappNumber !== undefined && b.whatsappNumber !== null && String(b.whatsappNumber).trim() !== '' && !isValidPhone(b.whatsappNumber)) {
      errors.push('Invalid WhatsApp number format.');
    }
    if (b.imageUrl !== undefined && !isValidListingImageUrl(b.imageUrl)) {
      errors.push('Food photo must be a valid JPEG, PNG, WebP image (up to 5 MB) or preset.');
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    const claimedPortions = (
      db
        .prepare(
          `SELECT COALESCE(SUM(requested_portions), 0) as claimed
           FROM food_requests
           WHERE donation_id = ? AND status IN ('Accepted','Coordination In Progress','Pickup Scheduled','Completed')`
        )
        .get(req.params.id) as { claimed: number }
    ).claimed;

    if (nextPortions < claimedPortions) {
      res.status(409).json({
        error: `Cannot reduce portions below ${claimedPortions} portions already accepted or completed.`,
      });
      return;
    }

    const nextRemainingPortions = nextPortions - claimedPortions;
    const nextPickupDeadline =
      b.pickupDeadline !== undefined
        ? new Date(b.pickupDeadline).toISOString()
        : String(existing.pickup_deadline);
    const nextAvailableUntil =
      b.availableUntil !== undefined && !Number.isNaN(new Date(b.availableUntil).getTime())
        ? new Date(b.availableUntil).toISOString()
        : b.pickupDeadline !== undefined
          ? nextPickupDeadline
          : String(existing.available_until);
    const nextPreparedAt =
      b.preparedAt !== undefined
        ? (b.preparedAt && String(b.preparedAt).trim() ? new Date(b.preparedAt).toISOString() : null)
        : (existing.prepared_at ? String(existing.prepared_at) : null);
    const nextWhatsapp =
      b.whatsappNumber !== undefined
        ? normalizePhoneOrNull(b.whatsappNumber)
        : (existing.whatsapp_number ? String(existing.whatsapp_number) : null);

    db.prepare(
      `UPDATE food_donations
       SET title = ?, description = ?, category = ?, quantity = ?, unit = ?,
           portions = ?, remaining_portions = ?, prepared_at = ?, available_until = ?,
           pickup_deadline = ?, storage_info = ?, packaging_info = ?, allergens = ?,
           dietary_info = ?, location = ?, collection_instructions = ?, image_url = ?,
           whatsapp_number = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      b.title !== undefined ? String(b.title).trim().slice(0, 120) : String(existing.title),
      b.description !== undefined ? String(b.description).trim().slice(0, 1500) : String(existing.description),
      b.category !== undefined ? String(b.category).trim() : String(existing.category),
      nextQty,
      b.unit !== undefined ? String(b.unit).trim().slice(0, 24) : String(existing.unit),
      nextPortions,
      nextRemainingPortions,
      nextPreparedAt,
      nextAvailableUntil,
      nextPickupDeadline,
      b.storageInfo !== undefined ? String(b.storageInfo ?? '').trim().slice(0, 300) : String(existing.storage_info ?? ''),
      b.packagingInfo !== undefined ? String(b.packagingInfo ?? '').trim().slice(0, 300) : String(existing.packaging_info ?? ''),
      b.allergens !== undefined ? String(b.allergens ?? '').trim().slice(0, 300) : String(existing.allergens ?? ''),
      b.dietaryInfo !== undefined ? String(b.dietaryInfo ?? '').trim().slice(0, 200) : String(existing.dietary_info ?? ''),
      b.location !== undefined ? String(b.location).trim().slice(0, 120) : String(existing.location),
      b.collectionInstructions !== undefined
        ? String(b.collectionInstructions ?? '').trim().slice(0, 400)
        : String(existing.collection_instructions ?? ''),
      b.imageUrl !== undefined ? String(b.imageUrl).trim() : String(existing.image_url),
      nextWhatsapp,
      new Date().toISOString(),
      String(req.params.id)
    );

    touchUserActivity(req.user!.id);
    if (req.user!.role === 'admin' && existing.donor_id !== req.user!.id) {
      logAudit(
        req.user!.id,
        req.user!.name,
        'FOOD_DONATION_MODERATED',
        'food',
        String(req.params.id),
        `Edited food donation "${existing.title}"`,
        { targetUserId: String(existing.donor_id) }
      );
    }

    invalidatePublicSyncCache('food_donations');
    const updated = db.prepare('SELECT * FROM food_donations WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ donation: mapFoodDonation(updated) });
  });

  app.get('/api/food-requests', requireAuth, (req: AuthedRequest, res) => {
    const u = req.user!;
    const rows = db
      .prepare(
        `SELECT fr.*, fd.title as donation_title, fd.location as donation_location, fd.pickup_deadline,
                fd.donor_id, fd.donor_name, fd.whatsapp_number as donor_whatsapp,
                ru.whatsapp_number as recipient_whatsapp
         FROM food_requests fr
         JOIN food_donations fd ON fd.id = fr.donation_id
         JOIN users ru ON ru.id = fr.recipient_id
         WHERE fr.is_demo = 0 AND (? = 'admin' OR fr.recipient_id = ? OR fd.donor_id = ?)
         ORDER BY fr.updated_at DESC`
      )
      .all(u.role, u.id, u.id) as Array<Record<string, unknown>>;

    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        donationId: r.donation_id,
        donationTitle: r.donation_title,
        donationLocation: r.donation_location,
        pickupDeadline: r.pickup_deadline,
        donorId: r.donor_id,
        donorName: r.donor_name,
        donorWhatsapp: r.donor_whatsapp,
        recipientId: r.recipient_id,
        recipientName: r.recipient_name,
        recipientWhatsapp: r.recipient_whatsapp,
        requestedPortions: Number(r.requested_portions),
        preferredTime: r.preferred_time,
        notes: r.notes,
        status: r.status,
        isDemo: false,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  app.post('/api/food-requests', requireAuth, (req: AuthedRequest, res) => {
    expireOutdatedFoodDonations();
    const { donationId, requestedPortions, preferredTime, notes } = req.body ?? {};
    const donation = db
      .prepare('SELECT * FROM food_donations WHERE id = ? AND is_demo = 0 AND is_hidden = 0')
      .get(String(donationId || '')) as Record<string, unknown> | undefined;

    if (!donation) {
      res.status(404).json({ error: 'Food donation not found.' });
      return;
    }
    if (['Completed', 'Cancelled', 'Expired'].includes(String(donation.status))) {
      res.status(400).json({ error: `This food donation is ${donation.status} and cannot accept requests.` });
      return;
    }
    if (donation.donor_id === req.user!.id) {
      res.status(400).json({ error: 'You cannot request your own donation.' });
      return;
    }
    const reqPortions = Number(requestedPortions);
    if (!Number.isInteger(reqPortions) || reqPortions <= 0 || reqPortions > Number(donation.remaining_portions)) {
      res.status(400).json({ error: `Requested portions must be between 1 and ${donation.remaining_portions}.` });
      return;
    }

    const id = createId('freq');
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO food_requests (
        id, donation_id, recipient_id, recipient_name, requested_portions,
        preferred_time, notes, status, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Request Received', 0, ?, ?)`
    ).run(
      id,
      String(donation.id),
      req.user!.id,
      req.user!.name,
      reqPortions,
      typeof preferredTime === 'string' && preferredTime ? preferredTime : 'Within 2 hours',
      typeof notes === 'string' ? notes.trim().slice(0, 400) : '',
      now,
      now
    );

    if (donation.status === 'Available') {
      db.prepare(`UPDATE food_donations SET status = 'Request Received', updated_at = ? WHERE id = ?`).run(
        now,
        String(donation.id)
      );
    }

    touchUserActivity(req.user!.id);
    addNotification(
      String(donation.donor_id),
      'Food Rescue Request Received',
      `${req.user!.name} requested ${reqPortions} portions of "${donation.title}".`,
      'workspace'
    );

    res.status(201).json({ ok: true, id });
  });

  app.patch('/api/food-requests/:id/status', requireAuth, (req: AuthedRequest, res) => {
    expireOutdatedFoodDonations();
    const { status, preferredTime, notes } = req.body ?? {};
    const validStatuses = [
      'Accepted',
      'Coordination In Progress',
      'Pickup Scheduled',
      'Completed',
      'Declined',
      'Cancelled',
    ];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status transition.' });
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db
        .prepare(
          `SELECT fr.*, fd.donor_id, fd.donor_verified, fd.title as donation_title, fd.category as donation_category,
                  fd.portions as total_portions, fd.remaining_portions, fd.quantity as total_quantity,
                  fd.unit as donation_unit, fd.status as donation_status
           FROM food_requests fr
           JOIN food_donations fd ON fd.id = fr.donation_id
           WHERE fr.id = ?`
        )
        .get(req.params.id) as Record<string, unknown> | undefined;

      if (!row) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Food request not found.' });
        return;
      }

      const u = req.user!;
      const isDonor = row.donor_id === u.id;
      const isRecipient = row.recipient_id === u.id;
      const isAdmin = u.role === 'admin';
      if (!isDonor && !isRecipient && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Not authorized to update this food request.' });
        return;
      }

      const currentStatus = String(row.status);
      if (['Completed', 'Declined', 'Cancelled'].includes(currentStatus)) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: `Request is already ${currentStatus}.` });
        return;
      }

      if (['Accepted', 'Declined'].includes(status) && !isDonor && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Only the donor can accept or decline this request.' });
        return;
      }

      const now = new Date().toISOString();
      let nextRemaining = Number(row.remaining_portions);

      const donationId = String(row.donation_id);
      if (status === 'Accepted' && currentStatus === 'Request Received') {
        if (String(row.donation_status) === 'Expired' || String(row.donation_status) === 'Cancelled') {
          db.exec('ROLLBACK');
          res.status(409).json({ error: `Cannot accept because donation is ${row.donation_status}.` });
          return;
        }
        if (nextRemaining < Number(row.requested_portions)) {
          db.exec('ROLLBACK');
          res.status(409).json({
            error: `Only ${nextRemaining} portions remain available, so ${row.requested_portions} portions cannot be claimed.`,
          });
          return;
        }
        nextRemaining -= Number(row.requested_portions);
        db.prepare('UPDATE food_donations SET remaining_portions = ?, status = ?, updated_at = ? WHERE id = ?').run(
          nextRemaining,
          'Accepted',
          now,
          donationId
        );
      } else if (status === 'Cancelled' && ['Accepted', 'Coordination In Progress', 'Pickup Scheduled'].includes(currentStatus)) {
        nextRemaining += Number(row.requested_portions);
        db.prepare('UPDATE food_donations SET remaining_portions = ?, status = ?, updated_at = ? WHERE id = ?').run(
          Math.min(Number(row.total_portions), nextRemaining),
          'Available',
          now,
          donationId
        );
      } else if (status === 'Coordination In Progress' || status === 'Pickup Scheduled') {
        db.prepare('UPDATE food_donations SET status = ?, updated_at = ? WHERE id = ?').run(status, now, donationId);
      }

      db.prepare('UPDATE food_requests SET status = ?, preferred_time = ?, notes = ?, updated_at = ? WHERE id = ?').run(
        status,
        typeof preferredTime === 'string' && preferredTime ? preferredTime : String(row.preferred_time),
        typeof notes === 'string' ? notes.trim().slice(0, 400) : String(row.notes ?? ''),
        now,
        String(req.params.id)
      );

      if (status === 'Completed') {
        const ledgerId = `food_req_${String(row.id)}`;
        const existingLedger = db.prepare('SELECT id FROM impact_ledger WHERE id = ?').get(ledgerId);
        if (!existingLedger) {
          const totalMassKg = convertToKgIfEligible(Number(row.total_quantity), String(row.donation_unit));
          const ratio = Number(row.requested_portions) / Math.max(1, Number(row.total_portions));
          const portionMassKg = totalMassKg !== null ? Number((totalMassKg * ratio).toFixed(2)) : null;
          const points = 140;
          const isVerified = Number(row.donor_verified) === 1 ? 1 : 0;

          db.prepare(
            `INSERT INTO impact_ledger (id, source_type, source_id, user_id, category, mass_kg, portions, liters, points_awarded, is_verified, is_demo, completed_at)
             VALUES (?, 'food', ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`
          ).run(
            ledgerId,
            String(row.id),
            String(row.donor_id),
            String(row.donation_category),
            portionMassKg,
            Number(row.requested_portions),
            points,
            isVerified,
            now
          );

          db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(points, String(row.donor_id));
          db.prepare('UPDATE users SET points = points + 70 WHERE id = ?').run(String(row.recipient_id));
        }

        if (nextRemaining === 0) {
          db.prepare(`UPDATE food_donations SET status = 'Completed', updated_at = ? WHERE id = ?`).run(now, donationId);
        }
      }

      touchUserActivity(u.id);
      const targetNotifyUser = isDonor ? String(row.recipient_id) : String(row.donor_id);
      addNotification(
        targetNotifyUser,
        `Food Rescue ${status}`,
        `Donation "${row.donation_title}" status updated to ${status}.`,
        'workspace'
      );

      db.exec('COMMIT');
      invalidatePublicSyncCache('food_donations');
      res.json({ ok: true, status });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update food request.' });
    }
  });

  // --- USED COOKING OIL RECOVERY ---
  registerOilRoutes(app);

  // --- SAVED BOOKMARKS ---
  app.get('/api/saved', requireAuth, (req: AuthedRequest, res) => {
    const rows = db.prepare('SELECT item_type, item_id FROM saved_items WHERE user_id = ?').all(req.user!.id) as Array<{
      item_type: 'material' | 'food';
      item_id: string;
    }>;
    res.json({ saved: rows.map((r) => ({ itemType: r.item_type, itemId: r.item_id })) });
  });

  app.post('/api/saved/toggle', requireAuth, (req: AuthedRequest, res) => {
    const { itemType, itemId } = req.body ?? {};
    if ((itemType !== 'material' && itemType !== 'food') || typeof itemId !== 'string' || !itemId) {
      res.status(400).json({ error: 'Invalid item reference.' });
      return;
    }
    const existing = db
      .prepare('SELECT 1 FROM saved_items WHERE user_id = ? AND item_type = ? AND item_id = ?')
      .get(req.user!.id, itemType, itemId);
    if (existing) {
      db.prepare('DELETE FROM saved_items WHERE user_id = ? AND item_type = ? AND item_id = ?').run(req.user!.id, itemType, itemId);
      res.json({ saved: false });
    } else {
      db.prepare('INSERT INTO saved_items (user_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)').run(
        req.user!.id,
        itemType,
        itemId,
        new Date().toISOString()
      );
      res.json({ saved: true });
    }
  });

  // --- VERIFICATION & REPORTS ---
  app.get('/api/verifications', requireAuth, (req: AuthedRequest, res) => {
    const u = req.user!;
    const rows =
      u.role === 'admin'
        ? (db.prepare('SELECT * FROM verification_requests ORDER BY submitted_at DESC').all() as Array<Record<string, unknown>>)
        : (db.prepare('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY submitted_at DESC').all(u.id) as Array<
            Record<string, unknown>
          >);

    res.json({
      verifications: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name,
        userEmail: r.user_email,
        organization: r.organization,
        materialsHandled: r.materials_handled,
        businessSummary: r.business_summary,
        status: r.status,
        reviewerNotes: r.reviewer_notes,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
      })),
    });
  });

  app.post('/api/verifications', requireAuth, (req: AuthedRequest, res) => {
    const { organization, materialsHandled, businessSummary } = req.body ?? {};
    if (typeof organization !== 'string' || organization.trim().length < 2) {
      res.status(400).json({ error: 'Organization or studio name is required.' });
      return;
    }
    if (typeof materialsHandled !== 'string' || materialsHandled.trim().length < 3) {
      res.status(400).json({ error: 'Please specify the materials or food categories handled.' });
      return;
    }
    if (typeof businessSummary !== 'string' || businessSummary.trim().length < 15) {
      res.status(400).json({ error: 'Please provide at least 15 characters describing your operations.' });
      return;
    }

    const u = req.user!;
    const id = createId('ver');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO verification_requests (
        id, user_id, user_name, user_email, organization, materials_handled, business_summary, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Submitted', ?)`
    ).run(id, u.id, u.name, u.email, organization.trim(), materialsHandled.trim(), businessSummary.trim(), now);

    db.prepare(`UPDATE users SET verification_status = 'Submitted', organization = ?, last_activity_at = ? WHERE id = ?`).run(
      organization.trim(),
      now,
      u.id
    );
    res.status(201).json({ ok: true, id, status: 'Submitted' });
  });

  app.patch('/api/verifications/:id', requireAdmin, (req: AuthedRequest, res) => {
    const { status, reviewerNotes } = req.body ?? {};
    const validStatuses = ['Under Review', 'Approved', 'Rejected', 'More Information Required'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid verification decision.' });
      return;
    }
    const row = db.prepare('SELECT * FROM verification_requests WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Verification request not found.' });
      return;
    }
    const now = new Date().toISOString();
    const notes = typeof reviewerNotes === 'string' && reviewerNotes.trim() ? reviewerNotes.trim() : null;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE verification_requests SET status = ?, reviewer_notes = ?, reviewed_at = ? WHERE id = ?').run(
        status,
        notes,
        now,
        String(req.params.id)
      );
      db.prepare('UPDATE users SET verification_status = ?, verification_notes = ?, updated_at = ? WHERE id = ?').run(
        status,
        notes,
        now,
        String(row.user_id)
      );

      const verifiedInt = status === 'Approved' ? 1 : 0;
      db.prepare('UPDATE material_listings SET seller_verified = ? WHERE seller_id = ?').run(verifiedInt, String(row.user_id));
      db.prepare('UPDATE food_donations SET donor_verified = ? WHERE donor_id = ?').run(verifiedInt, String(row.user_id));
      db.prepare('UPDATE oil_recovery_listings SET supplier_verified = ? WHERE supplier_id = ?').run(verifiedInt, String(row.user_id));

      addNotification(
        String(row.user_id),
        `Verification ${status}`,
        `Your organization verification status is now ${status}.${notes ? ` Note: ${notes}` : ''}`,
        'workspace'
      );
      logAudit(
        req.user!.id,
        req.user!.name,
        `VERIFICATION_${status.toUpperCase().replace(/\s+/g, '_')}`,
        'verification',
        String(req.params.id),
        `Reviewed ${row.organization} -> ${status}`,
        { targetUserId: String(row.user_id), reason: notes, result: 'Success' }
      );
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to review verification.' });
      return;
    }

    res.json({ ok: true, status });
  });

  app.post('/api/reports', requireAuth, (req: AuthedRequest, res) => {
    const { targetType, targetId, targetTitle, reason, details } = req.body ?? {};
    if (!['material', 'food', 'oil', 'user'].includes(targetType) || !targetId || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ error: 'Report target and reason are required.' });
      return;
    }
    const id = createId('rep');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO reports (
        id, reporter_id, reporter_name, target_type, target_id, target_title, reason, details, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)`
    ).run(
      id,
      req.user!.id,
      req.user!.name,
      targetType,
      String(targetId),
      String(targetTitle || targetId),
      reason.trim(),
      typeof details === 'string' ? details.trim().slice(0, 600) : '',
      now,
      now
    );
    touchUserActivity(req.user!.id);
    res.status(201).json({ ok: true, id });
  });

  app.get('/api/reports', requireAdmin, (_req, res) => {
    const rows = db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    res.json({
      reports: rows.map((r) => ({
        id: r.id,
        reporterId: r.reporter_id,
        reporterName: r.reporter_name,
        targetType: r.target_type,
        targetId: r.target_id,
        targetTitle: r.target_title,
        reason: r.reason,
        details: r.details,
        status: r.status,
        adminNotes: r.admin_notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  app.patch('/api/reports/:id', requireAdmin, (req: AuthedRequest, res) => {
    const { status, adminNotes, pauseTarget } = req.body ?? {};
    const validStatuses = ['Under Review', 'Resolved', 'Dismissed'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid report status.' });
      return;
    }
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!rep) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    const now = new Date().toISOString();
    const cleanNotes = typeof adminNotes === 'string' && adminNotes.trim() ? adminNotes.trim() : null;

    db.prepare('UPDATE reports SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?').run(
      status,
      cleanNotes ?? (rep.admin_notes ? String(rep.admin_notes) : null),
      now,
      String(req.params.id)
    );

    if (pauseTarget) {
      if (rep.target_type === 'material') {
        db.prepare(`UPDATE material_listings SET status = 'Paused', is_hidden = 1, hidden_reason = ?, updated_at = ? WHERE id = ?`).run(
          cleanNotes || String(rep.reason),
          now,
          String(rep.target_id)
        );
      } else if (rep.target_type === 'food') {
        db.prepare(`UPDATE food_donations SET status = 'Cancelled', is_hidden = 1, hidden_reason = ?, updated_at = ? WHERE id = ?`).run(
          cleanNotes || String(rep.reason),
          now,
          String(rep.target_id)
        );
      } else if (rep.target_type === 'oil') {
        db.prepare(`UPDATE oil_recovery_listings SET collection_status = 'Paused', is_hidden = 1, hidden_reason = ?, updated_at = ? WHERE id = ?`).run(
          cleanNotes || String(rep.reason),
          now,
          String(rep.target_id)
        );
      }
    }

    logAudit(
      req.user!.id,
      req.user!.name,
      'REPORT_REVIEWED',
      String(rep.target_type),
      String(rep.target_id),
      `Report ${req.params.id} -> ${status}${pauseTarget ? ' (target hidden/paused)' : ''}`,
      { reason: cleanNotes || String(rep.reason), result: 'Success' }
    );
    res.json({ ok: true });
  });

  // --- NOTIFICATIONS ---
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 25')
      .all(req.user!.id) as Array<Record<string, unknown>>;
    res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        title: r.title,
        message: r.message,
        linkTab: r.link_tab,
        isRead: Boolean(r.is_read),
        createdAt: r.created_at,
      })),
    });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  // --- ADMIN SYSTEM ROUTES ---
  registerAdminRoutes(app);

  // --- REAL IMPACT & LEADERBOARD (ZERO DEMO RECORDS) ---
  app.get('/api/impact', async (_req, res) => {
    expireOutdatedFoodDonations();

    const matStats = db
      .prepare(
        `SELECT COUNT(*) as handovers,
                COALESCE(SUM(CASE WHEN mass_kg IS NOT NULL THEN mass_kg ELSE 0 END), 0) as kg,
                COALESCE(SUM(CASE WHEN mass_kg IS NOT NULL AND is_verified = 1 THEN mass_kg ELSE 0 END), 0) as verified_kg,
                SUM(CASE WHEN mass_kg IS NULL THEN 1 ELSE 0 END) as non_mass
         FROM impact_ledger WHERE source_type = 'material' AND is_demo = 0`
      )
      .get() as { handovers: number; kg: number; verified_kg: number; non_mass: number };

    const foodStats = db
      .prepare(
        `SELECT COUNT(*) as handovers,
                COALESCE(SUM(portions), 0) as portions,
                COALESCE(SUM(CASE WHEN is_verified = 1 THEN portions ELSE 0 END), 0) as verified_portions
         FROM impact_ledger WHERE source_type = 'food' AND is_demo = 0`
      )
      .get() as { handovers: number; portions: number; verified_portions: number };

    const oilStats = db
      .prepare(
        `SELECT COUNT(*) as handovers,
                COALESCE(SUM(liters), 0) as liters,
                COALESCE(SUM(CASE WHEN is_verified = 1 THEN liters ELSE 0 END), 0) as verified_liters
         FROM impact_ledger WHERE source_type = 'oil' AND is_demo = 0`
      )
      .get() as { handovers: number; liters: number; verified_liters: number };

    const localMatRows = db
      .prepare(`SELECT * FROM material_listings WHERE status = 'Active' AND is_hidden = 0 AND is_demo = 0`)
      .all() as Array<Record<string, unknown>>;
    const localFoodRows = db
      .prepare(
        `SELECT * FROM food_donations WHERE status IN ('Available','Request Received','Accepted') AND remaining_portions > 0 AND is_hidden = 0 AND is_demo = 0`
      )
      .all() as Array<Record<string, unknown>>;
    const localOilRows = db
      .prepare(
        `SELECT * FROM oil_recovery_listings WHERE collection_status IN ('Available','Enquiry Pending','Scheduled') AND is_hidden = 0`
      )
      .all() as Array<Record<string, unknown>>;

    const [remoteMats, remoteFoods, remoteOils] = await Promise.all([
      fetchPublicMaterialsFromFirestore(),
      fetchPublicFoodDonationsFromFirestore(),
      fetchPublicOilListingsFromFirestore(),
    ]);

    const activeMat = mergeWithRemoteById(localMatRows.map(mapMaterialListing), remoteMats).filter(
      (m) => !m.isHidden && !m.isDemo && m.status === 'Active'
    ).length;
    const activeFood = mergeWithRemoteById(localFoodRows.map(mapFoodDonation), remoteFoods).filter(
      (d) =>
        !d.isHidden &&
        !d.isDemo &&
        ['Available', 'Request Received', 'Accepted'].includes(d.status) &&
        d.remainingPortions > 0 &&
        new Date(d.pickupDeadline).getTime() >= Date.now()
    ).length;
    const activeOil = mergeWithRemoteById(localOilRows.map(mapOilListing), remoteOils).filter(
      (o) => !o.isHidden && ['Available', 'Enquiry Pending', 'Scheduled'].includes(o.collectionStatus)
    ).length;
    const pendingMatReq = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM material_requests WHERE status IN ('Request Created','Accepted','Coordination In Progress','Pickup Scheduled','Collected') AND is_demo = 0`
        )
        .get() as { c: number }
    ).c;
    const pendingFoodReq = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM food_requests WHERE status IN ('Request Received','Accepted','Coordination In Progress','Pickup Scheduled') AND is_demo = 0`
        )
        .get() as { c: number }
    ).c;
    const pendingOilEnq = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM oil_buyer_enquiries WHERE status IN ('Pending','Accepted','Scheduled','Collected')`
        )
        .get() as { c: number }
    ).c;
    const usersCount = (
      db.prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin' AND account_status = 'Active'`).get() as {
        c: number;
      }
    ).c;

    const catRows = db
      .prepare(
        `SELECT category, COUNT(*) as handovers,
                COALESCE(SUM(CASE WHEN mass_kg IS NOT NULL THEN mass_kg ELSE 0 END), 0) as mass_kg,
                COALESCE(SUM(portions), 0) as portions,
                COALESCE(SUM(liters), 0) as liters
         FROM impact_ledger
         WHERE is_demo = 0
         GROUP BY category
         ORDER BY handovers DESC, mass_kg DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const monthRows = db
      .prepare(
        `SELECT substr(completed_at, 1, 7) as month,
                COALESCE(SUM(CASE WHEN source_type = 'material' AND mass_kg IS NOT NULL THEN mass_kg ELSE 0 END), 0) as material_kg,
                COALESCE(SUM(CASE WHEN source_type = 'food' THEN portions ELSE 0 END), 0) as food_portions,
                COALESCE(SUM(CASE WHEN source_type = 'oil' THEN liters ELSE 0 END), 0) as oil_liters,
                COUNT(*) as handovers
         FROM impact_ledger
         WHERE is_demo = 0
         GROUP BY substr(completed_at, 1, 7)
         ORDER BY month ASC`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      live: {
        materialsRecoveredKg: Number(Number(matStats.kg || 0).toFixed(1)),
        verifiedMaterialsRecoveredKg: Number(Number(matStats.verified_kg || 0).toFixed(1)),
        materialHandoversCompleted: Number(matStats.handovers || 0),
        nonMassMaterialUnitsCompleted: Number(matStats.non_mass || 0),
        foodPortionsRescued: Number(foodStats.portions || 0),
        verifiedFoodPortionsRescued: Number(foodStats.verified_portions || 0),
        foodHandoversCompleted: Number(foodStats.handovers || 0),
        oilLitersRecovered: Number(Number(oilStats.liters || 0).toFixed(1)),
        verifiedOilLitersRecovered: Number(Number(oilStats.verified_liters || 0).toFixed(1)),
        oilRecoveriesCompleted: Number(oilStats.handovers || 0),
        activeMaterialListings: activeMat,
        activeFoodDonations: activeFood,
        activeOilListings: activeOil,
        pendingMaterialRequests: pendingMatReq,
        pendingFoodRequests: pendingFoodReq,
        pendingOilEnquiries: pendingOilEnq,
        communityParticipants: usersCount,
      },
      categoryBreakdown: catRows.map((r) => ({
        category: String(r.category),
        handovers: Number(r.handovers),
        massKg: Number(Number(r.mass_kg).toFixed(1)),
        portions: Number(r.portions),
        liters: Number(Number(r.liters).toFixed(1)),
      })),
      monthlySeries: monthRows.map((r) => ({
        month: String(r.month),
        materialKg: Number(Number(r.material_kg).toFixed(1)),
        foodPortions: Number(r.food_portions),
        oilLiters: Number(Number(r.oil_liters).toFixed(1)),
        handovers: Number(r.handovers),
      })),
      methodology: {
        massRule: 'Only completed handovers recorded in kilograms, grams, or metric tonnes are summed into material kilogram totals.',
        exclusionRule: 'Unit-based quantities such as pallets or pieces are tracked under completed handover counts and excluded from kg totals.',
        duplicateRule: 'Each handover is locked by a unique primary ledger key so repeated confirmations cannot double-count metrics.',
        verifiedDistinction: 'Verified impact sums handovers from human-approved verified organizations; estimated/unverified claims are tracked separately and never fabricated.',
        carbonPolicy: 'VERDORA does not report unverified CO2e savings; figures strictly reflect recorded platform quantities.',
      },
    });
  });

  // Personal Impact Summary (Strictly authenticated user's own handovers & achievements; no leaderboard or comparative rankings)
  app.get('/api/my/impact-summary', requireAuth, (req: AuthedRequest, res) => {
    const u = req.user!;
    const ledgerStats = db
      .prepare(
        `SELECT COUNT(*) as handovers,
                SUM(CASE WHEN source_type = 'material' THEN 1 ELSE 0 END) as mat_count,
                SUM(CASE WHEN source_type = 'food' THEN 1 ELSE 0 END) as food_count,
                SUM(CASE WHEN source_type = 'oil' THEN 1 ELSE 0 END) as oil_count
         FROM impact_ledger
         WHERE user_id = ? AND is_demo = 0`
      )
      .get(u.id) as {
      handovers: number;
      mat_count: number;
      food_count: number;
      oil_count: number;
    };

    const listingCount = (
      db.prepare('SELECT COUNT(*) as c FROM material_listings WHERE seller_id = ? AND is_demo = 0').get(u.id) as { c: number }
    ).c;

    const achievements: string[] = [];
    if (listingCount > 0) achievements.push('Verified Material Contributor');
    if ((ledgerStats.mat_count || 0) > 0) achievements.push('Material Handover Contributor');
    if ((ledgerStats.food_count || 0) > 0) achievements.push('Food Rescue Contributor');
    if ((ledgerStats.oil_count || 0) > 0) achievements.push('Oil Recovery Contributor');
    if (Number(u.points) >= 300) achievements.push('Circular Economy Pioneer');
    if (u.verification_status === 'Approved') achievements.push('Verified Organization');

    res.json({
      points: Number(u.points || 0),
      completedHandovers: Number(ledgerStats.handovers || 0),
      achievements,
    });
  });

  // Register AI-Powered Listing Verification & Admin Human-Review Routes
  registerListingVerificationRoutes(app);

  // --- AI ENDPOINTS (SERVER-SIDE ONLY) ---
  function extractValidatedImagePayload(imageDataUrl: unknown): {
    base64Data: string | null;
    mimeType: string | null;
    error?: string;
  } {
    if (imageDataUrl === undefined || imageDataUrl === null || imageDataUrl === '') {
      return { base64Data: null, mimeType: null };
    }
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      return { base64Data: null, mimeType: null, error: 'Please upload a valid JPEG, PNG, or WebP image.' };
    }
    const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
    if (!match) {
      return { base64Data: null, mimeType: null, error: 'Unsupported image format. Please use JPEG, PNG, or WebP.' };
    }
    const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    const base64Data = match[2];
    const approxBytes = Math.ceil((base64Data.length * 3) / 4);
    if (approxBytes > 5 * 1024 * 1024) {
      return { base64Data: null, mimeType: null, error: 'Image size exceeds the 5 MB limit.' };
    }
    return { base64Data, mimeType };
  }

  async function getLiveMarketplaceContext(): Promise<LiveMarketplaceContext> {
    expireOutdatedFoodDonations();
    const matRows = db
      .prepare(
        `SELECT * FROM material_listings
         WHERE is_demo = 0 AND is_hidden = 0 AND status = 'Active'
         ORDER BY created_at DESC LIMIT 30`
      )
      .all() as Array<Record<string, unknown>>;

    const foodRows = db
      .prepare(
        `SELECT * FROM food_donations
         WHERE is_demo = 0 AND is_hidden = 0
           AND status NOT IN ('Completed','Cancelled','Expired')
           AND remaining_portions > 0
         ORDER BY pickup_deadline ASC LIMIT 30`
      )
      .all() as Array<Record<string, unknown>>;

    const [remoteMats, remoteFoods] = await Promise.all([
      fetchPublicMaterialsFromFirestore(),
      fetchPublicFoodDonationsFromFirestore(),
    ]);

    const mergedMats = mergeWithRemoteById(matRows.map(mapMaterialListing), remoteMats)
      .filter((m) => !m.isDemo && !m.isHidden && m.status === 'Active')
      .slice(0, 30);

    const mergedFoods = mergeWithRemoteById(foodRows.map(mapFoodDonation), remoteFoods)
      .filter(
        (d) =>
          !d.isDemo &&
          !d.isHidden &&
          !['Completed', 'Cancelled', 'Expired'].includes(d.status) &&
          d.remainingPortions > 0 &&
          new Date(d.pickupDeadline).getTime() >= Date.now()
      )
      .slice(0, 30);

    return {
      activeMaterials: mergedMats.map((m) => ({
        id: m.id,
        title: m.title,
        category: m.category,
        quantity: m.quantity,
        unit: m.unit,
        condition: m.condition,
        location: m.location,
        indicativePrice: m.indicativePrice,
        reuseApplications: m.reuseApplications,
      })),
      activeFoodDonations: mergedFoods.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        remainingPortions: d.remainingPortions,
        portions: d.portions,
        location: d.location,
        pickupDeadline: d.pickupDeadline,
        storageInfo: d.storageInfo,
        allergens: d.allergens,
        dietaryInfo: d.dietaryInfo,
      })),
    };
  }

  app.post('/api/ai/scan-material', async (req, res) => {
    try {
      const { imageDataUrl, contextText } = req.body ?? {};
      const cleanContext = typeof contextText === 'string' ? contextText.trim().slice(0, 400) : '';
      const img = extractValidatedImagePayload(imageDataUrl);
      if (img.error) {
        res.status(400).json({ error: img.error });
        return;
      }
      if (!img.base64Data && cleanContext.length < 5) {
        res.status(400).json({ error: 'Please upload a material image or describe the object (at least 5 characters).' });
        return;
      }

      const result = await analyzeMaterialImage(img.base64Data, img.mimeType, cleanContext);
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to complete AI material scan right now.',
      });
    }
  });

  app.post('/api/ai/scan-food', async (req, res) => {
    try {
      const { imageDataUrl, contextText } = req.body ?? {};
      const cleanContext = typeof contextText === 'string' ? contextText.trim().slice(0, 400) : '';
      const img = extractValidatedImagePayload(imageDataUrl);
      if (img.error) {
        res.status(400).json({ error: img.error });
        return;
      }
      if (!img.base64Data && cleanContext.length < 5) {
        res.status(400).json({ error: 'Please upload a food photo or describe the surplus food (at least 5 characters).' });
        return;
      }

      const result = await analyzeFoodDonation(img.base64Data, img.mimeType, cleanContext);
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to analyze surplus food right now.',
      });
    }
  });

  app.post('/api/ai/guide', async (req, res) => {
    try {
      const { kind, query, location, quantityOrPortions } = req.body ?? {};
      if (kind !== 'food' && kind !== 'material') {
        res.status(400).json({ error: 'Invalid guide kind. Expected "food" or "material".' });
        return;
      }
      const cleanQuery = typeof query === 'string' ? query.trim().slice(0, 500) : '';
      if (cleanQuery.length < 2) {
        res.status(400).json({ error: 'Please enter what food or object you are looking for.' });
        return;
      }
      const parsedTarget =
        quantityOrPortions !== undefined && quantityOrPortions !== null && quantityOrPortions !== ''
          ? Number(quantityOrPortions)
          : undefined;

      const result = await guideResourceSeeker({
        kind,
        query: cleanQuery,
        location: typeof location === 'string' ? location.trim().slice(0, 120) : undefined,
        quantityOrPortions: Number.isFinite(parsedTarget) && (parsedTarget as number) > 0 ? parsedTarget : undefined,
        liveContext: await getLiveMarketplaceContext(),
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to generate AI guide right now.',
      });
    }
  });

  app.post('/api/ai/assistant', async (req, res) => {
    try {
      const { message, history } = req.body ?? {};
      if (typeof message !== 'string' || message.trim().length < 2) {
        res.status(400).json({ error: 'Please enter a question for the Eco AI Assistant.' });
        return;
      }
      const safeHistory: AssistantTurn[] = Array.isArray(history)
        ? history
            .filter(
              (t): t is AssistantTurn =>
                Boolean(t) && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'
            )
            .slice(-8)
        : [];

      const result = await askEcoAssistant(
        message.trim().slice(0, 1000),
        safeHistory,
        await getLiveMarketplaceContext()
      );
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to reach Eco AI Assistant right now.',
      });
    }
  });

  // Explicit 404 for unknown API routes so SPA fallback never masks removed/invalid API endpoints
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // --- VITE / STATIC SERVING ---
  const skipVite = process.env.VERDORA_SKIP_VITE === 'true';
  const isProd = process.env.NODE_ENV === 'production';
  if (!skipVite && !isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!skipVite) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VERDORA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start VERDORA server:', err);
  process.exit(1);
});
