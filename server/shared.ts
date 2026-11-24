import { NextFunction, Request, Response } from 'express';
import { AccountStatus, AccountType, createId, db } from './db.ts';

export interface DbUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'member' | 'seller' | 'donor' | 'admin';
  account_type: AccountType;
  account_status: AccountStatus;
  organization: string;
  location: string;
  whatsapp_number: string | null;
  verification_status: string;
  verification_notes: string | null;
  public_leaderboard: number;
  points: number;
  is_demo: number;
  google_id: string | null;
  firebase_uid: string | null;
  avatar_url: string | null;
  auth_provider: string | null;
  last_login_at: string | null;
  role_selected: number | null;
  last_activity_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AuthedRequest extends Request {
  user?: DbUserRow;
  sessionToken?: string;
}

export const SESSION_COOKIE = 'verdora_session';

export function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  if (proto === 'http') return false;
  if (req.secure) return true;
  const host = String(req.headers.host || '').toLowerCase();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return false;
  return Boolean(process.env.APP_URL?.startsWith('https://'));
}

export function buildSessionCookieHeader(req: Request, token: string, maxAgeSeconds: number): string {
  const secure = isHttpsRequest(req);
  const sameSite = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${sameSite}; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(req: Request): string {
  const secure = isHttpsRequest(req);
  const sameSite = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; ${sameSite}; Max-Age=0`;
}

export function sanitizeUser(u: DbUserRow) {
  return {
    id: String(u.id),
    name: String(u.name),
    email: String(u.email),
    role: u.role,
    accountType: (u.account_type || 'buyer') as AccountType,
    accountStatus: (u.account_status || 'Active') as AccountStatus,
    organization: String(u.organization ?? ''),
    location: String(u.location ?? ''),
    whatsappNumber: u.whatsapp_number ? String(u.whatsapp_number) : null,
    verificationStatus: String(u.verification_status ?? 'Not Submitted'),
    verificationNotes: u.verification_notes ? String(u.verification_notes) : null,
    publicLeaderboard: Boolean(u.public_leaderboard),
    points: Number(u.points ?? 0),
    isDemo: Boolean(u.is_demo),
    avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
    authProvider: String(u.auth_provider || 'email') as 'email' | 'google' | 'email+google',
    lastLoginAt: u.last_login_at ? String(u.last_login_at) : null,
    firebaseUid: u.firebase_uid ? String(u.firebase_uid) : null,
    needsRoleSelection: Number(u.role_selected ?? 1) === 0,
    lastActivityAt: u.last_activity_at ? String(u.last_activity_at) : null,
    createdAt: String(u.created_at),
  };
}

export function isValidPhone(raw?: string | null): boolean {
  if (!raw) return true;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  return /^\+?[1-9]\d{7,14}$/.test(cleaned);
}

export function normalizePhoneOrNull(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(cleaned)) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

export function touchUserActivity(userId: string) {
  db.prepare('UPDATE users SET last_activity_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
}

export function logAudit(
  actorId: string,
  actorName: string,
  action: string,
  targetType: string,
  targetId: string,
  details: string,
  options?: { targetUserId?: string | null; reason?: string | null; result?: string }
) {
  db.prepare(
    `INSERT INTO audit_logs (
      id, actor_id, actor_name, action, target_type, target_id, target_user_id, reason, result, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId('aud'),
    actorId,
    actorName,
    action,
    targetType,
    targetId,
    options?.targetUserId ?? null,
    options?.reason ?? null,
    options?.result ?? 'Success',
    details,
    new Date().toISOString()
  );
}

export function addNotification(userId: string, title: string, message: string, linkTab = 'workspace') {
  db.prepare(
    'INSERT INTO notifications (id, user_id, title, message, link_tab, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).run(createId('ntf'), userId, title, message, linkTab, new Date().toISOString());
}

export function expireOutdatedFoodDonations() {
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE food_donations
     SET status = 'Expired', updated_at = ?
     WHERE status IN ('Available', 'Request Received', 'Accepted', 'Coordination In Progress', 'Pickup Scheduled')
       AND pickup_deadline < ?`
  ).run(nowIso, nowIso);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
    return;
  }
  if (req.user.account_status !== 'Active') {
    res.status(403).json({ error: `Account is currently ${req.user.account_status.toLowerCase()}. Contact platform support.` });
    return;
  }
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.user.account_status !== 'Active') {
    res.status(403).json({ error: 'Administrator account is not active.' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator authorization required.' });
    return;
  }
  next();
}

export function createRateLimiter(windowMs: number, maxRequests: number, keyPrefix: string) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

export function mapMaterialListing(row: Record<string, unknown>) {
  let reuseApplications: string[] = [];
  try {
    reuseApplications = JSON.parse(String(row.reuse_applications || '[]'));
  } catch {
    reuseApplications = [];
  }
  return {
    id: String(row.id),
    sellerId: String(row.seller_id),
    sellerName: String(row.seller_name),
    sellerOrganization: String(row.seller_organization ?? ''),
    sellerVerified: Boolean(row.seller_verified),
    title: String(row.title),
    category: String(row.category),
    description: String(row.description),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    condition: String(row.condition),
    location: String(row.location),
    indicativePrice: row.indicative_price === null ? null : Number(row.indicative_price),
    currency: String(row.currency ?? 'INR'),
    imageUrl: String(row.image_url),
    availableUntil: String(row.available_until),
    pickupPreferences: String(row.pickup_preferences ?? ''),
    reuseApplications,
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    status: String(row.status),
    isHidden: Boolean(row.is_hidden),
    hiddenReason: row.hidden_reason ? String(row.hidden_reason) : null,
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapFoodDonation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    donorId: String(row.donor_id),
    donorName: String(row.donor_name),
    donorOrganization: String(row.donor_organization ?? ''),
    donorVerified: Boolean(row.donor_verified),
    title: String(row.title),
    description: String(row.description),
    category: String(row.category),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    portions: Number(row.portions),
    remainingPortions: Number(row.remaining_portions),
    preparedAt: row.prepared_at ? String(row.prepared_at) : null,
    availableUntil: String(row.available_until),
    pickupDeadline: String(row.pickup_deadline),
    storageInfo: String(row.storage_info ?? ''),
    packagingInfo: String(row.packaging_info ?? ''),
    allergens: String(row.allergens ?? ''),
    dietaryInfo: String(row.dietary_info ?? ''),
    location: String(row.location),
    collectionInstructions: String(row.collection_instructions ?? ''),
    imageUrl: String(row.image_url),
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    status: String(row.status),
    isHidden: Boolean(row.is_hidden),
    hiddenReason: row.hidden_reason ? String(row.hidden_reason) : null,
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapOilListing(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    supplierId: String(row.supplier_id),
    supplierName: String(row.supplier_name),
    supplierOrganization: String(row.supplier_organization ?? ''),
    supplierVerified: Boolean(row.supplier_verified),
    title: String(row.title),
    oilType: String(row.oil_type),
    volumeLiters: Number(row.volume_liters),
    qualityGrade: String(row.quality_grade),
    containerType: String(row.container_type),
    filtrationStatus: String(row.filtration_status),
    pickupWindow: String(row.pickup_window),
    location: String(row.location),
    collectionStatus: String(row.collection_status),
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    isHidden: Boolean(row.is_hidden),
    hiddenReason: row.hidden_reason ? String(row.hidden_reason) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
