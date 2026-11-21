import crypto from 'node:crypto';
import type { Express } from 'express';
import { createId, db } from './db.ts';
import {
  DuplicateCandidate,
  VerificationCheckItem,
  VerificationStatus,
  verifyListingWithAI,
} from './ai.ts';
import {
  addNotification,
  AuthedRequest,
  createRateLimiter,
  isValidPhone,
  logAudit,
  requireAdmin,
  requireAuth,
  touchUserActivity,
} from './shared.ts';

export type ListingKind = 'material' | 'food' | 'oil';

export interface PublicVerificationRecord {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  listingType: ListingKind;
  status: VerificationStatus;
  humanReviewStatus: 'none' | 'pending' | 'approved' | 'rejected';
  humanReviewNotes: string | null;
  riskScore: number;
  summary: string;
  reasons: string[];
  actionRequired: string | null;
  checks: VerificationCheckItem[];
  duplicateMatches: DuplicateCandidate[];
  evidenceNotes: string;
  hasEvidenceImage: boolean;
  canPublish: boolean;
  publishedListingId: string | null;
  payload: Record<string, unknown>;
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const VERIFICATION_DISCLAIMER =
  'Verdora AI checks for common authenticity, duplicate, pricing, and quality indicators to protect the community, but AI review cannot guarantee that any listing is genuine. Always inspect items and confirm details directly before handover.';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: unknown): Set<string> {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'have', 'has',
    'available', 'pickup', 'good', 'clean', 'surplus', 'items', 'item', 'batch', 'listing',
  ]);
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((t) => t.length >= 3 && !stopWords.has(t))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function computeImageHash(imageUrl: unknown): string | null {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) {
    return null;
  }
  const commaIdx = imageUrl.indexOf(',');
  const raw = commaIdx >= 0 ? imageUrl.slice(commaIdx + 1) : imageUrl;
  if (!raw || raw.length < 32) return null;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function extractImageData(imageDataUrl: unknown): {
  base64Data: string;
  mimeType: string;
  approxBytes: number;
} | null {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    return null;
  }
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
  if (!match) return null;
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const base64Data = match[2];
  const approxBytes = Math.ceil((base64Data.length * 3) / 4);
  return { base64Data, mimeType, approxBytes };
}

export function computeListingPayloadHash(listingType: ListingKind, payload: Record<string, unknown>): string {
  const imageHash = computeImageHash(payload.imageUrl) ?? String(payload.imageUrl ?? '').trim();
  let canonical: Record<string, unknown>;
  if (listingType === 'material') {
    canonical = {
      listingType,
      title: String(payload.title ?? '').trim(),
      category: String(payload.category ?? '').trim(),
      description: String(payload.description ?? '').trim(),
      quantity: Number(payload.quantity ?? 0),
      unit: String(payload.unit ?? '').trim(),
      condition: String(payload.condition ?? '').trim(),
      location: String(payload.location ?? '').trim(),
      indicativePrice:
        payload.indicativePrice === null || payload.indicativePrice === undefined || payload.indicativePrice === ''
          ? null
          : Number(payload.indicativePrice),
      imageHash,
    };
  } else if (listingType === 'food') {
    canonical = {
      listingType,
      title: String(payload.title ?? '').trim(),
      category: String(payload.category ?? '').trim(),
      description: String(payload.description ?? '').trim(),
      quantity: Number(payload.quantity ?? 0),
      unit: String(payload.unit ?? '').trim(),
      portions: Math.round(Number(payload.portions ?? 0)),
      location: String(payload.location ?? '').trim(),
      storageInfo: String(payload.storageInfo ?? '').trim(),
      allergens: String(payload.allergens ?? '').trim(),
      imageHash,
    };
  } else {
    canonical = {
      listingType,
      title: String(payload.title ?? '').trim(),
      oilType: String(payload.oilType ?? '').trim(),
      volumeLiters: Number(payload.volumeLiters ?? 0),
      qualityGrade: String(payload.qualityGrade ?? '').trim(),
      containerType: String(payload.containerType ?? '').trim(),
      filtrationStatus: String(payload.filtrationStatus ?? '').trim(),
      pickupWindow: String(payload.pickupWindow ?? '').trim(),
      location: String(payload.location ?? '').trim(),
    };
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function findDuplicateListings(params: {
  listingType: ListingKind;
  title: string;
  description: string;
  location: string;
  imageHash: string | null;
}): DuplicateCandidate[] {
  const { listingType, title, description, location, imageHash } = params;
  const normTitle = normalizeText(title);
  const titleTokens = tokenize(title);
  const descTokens = tokenize(`${title} ${description}`);
  const normLoc = normalizeText(location);
  const matches: DuplicateCandidate[] = [];

  if (listingType === 'material') {
    const rows = db
      .prepare(
        `SELECT id, title, description, location, image_url
         FROM material_listings
         WHERE is_demo = 0 AND is_hidden = 0 AND status = 'Active'
         ORDER BY created_at DESC LIMIT 200`
      )
      .all() as Array<Record<string, unknown>>;

    for (const r of rows) {
      const rTitle = String(r.title ?? '');
      const rDesc = String(r.description ?? '');
      const rLoc = String(r.location ?? '');
      const rImgHash = computeImageHash(r.image_url);

      if (imageHash && rImgHash && imageHash === rImgHash) {
        matches.push({
          id: String(r.id),
          title: rTitle,
          location: rLoc,
          reason: 'Identical image already used in an active Marketplace listing',
          similarityScore: 98,
        });
        continue;
      }

      const rNormTitle = normalizeText(rTitle);
      const titleSim = normTitle && rNormTitle === normTitle ? 1 : jaccardSimilarity(titleTokens, tokenize(rTitle));
      const descSim = jaccardSimilarity(descTokens, tokenize(`${rTitle} ${rDesc}`));
      const sameLoc = Boolean(normLoc && normalizeText(rLoc) === normLoc);

      if (titleSim >= 0.85 || (titleSim >= 0.65 && descSim >= 0.65) || (descSim >= 0.78 && sameLoc)) {
        const score = Math.round(Math.max(titleSim, descSim) * 100);
        matches.push({
          id: String(r.id),
          title: rTitle,
          location: rLoc,
          reason:
            titleSim >= 0.9
              ? 'Identical or near-identical title to an active listing'
              : 'Very similar title and description to an existing listing',
          similarityScore: Math.min(97, Math.max(70, score)),
        });
      }
    }
  } else if (listingType === 'food') {
    const rows = db
      .prepare(
        `SELECT id, title, description, location, image_url
         FROM food_donations
         WHERE is_demo = 0 AND is_hidden = 0 AND status NOT IN ('Completed','Cancelled','Expired')
         ORDER BY created_at DESC LIMIT 200`
      )
      .all() as Array<Record<string, unknown>>;

    for (const r of rows) {
      const rTitle = String(r.title ?? '');
      const rDesc = String(r.description ?? '');
      const rLoc = String(r.location ?? '');
      const rImgHash = computeImageHash(r.image_url);

      if (imageHash && rImgHash && imageHash === rImgHash) {
        matches.push({
          id: String(r.id),
          title: rTitle,
          location: rLoc,
          reason: 'Identical image already used in an active Food Rescue donation',
          similarityScore: 98,
        });
        continue;
      }

      const rNormTitle = normalizeText(rTitle);
      const titleSim = normTitle && rNormTitle === normTitle ? 1 : jaccardSimilarity(titleTokens, tokenize(rTitle));
      const descSim = jaccardSimilarity(descTokens, tokenize(`${rTitle} ${rDesc}`));
      if (titleSim >= 0.85 || (titleSim >= 0.65 && descSim >= 0.7)) {
        matches.push({
          id: String(r.id),
          title: rTitle,
          location: rLoc,
          reason: 'Matches an active Food Rescue donation already published',
          similarityScore: Math.min(96, Math.round(Math.max(titleSim, descSim) * 100)),
        });
      }
    }
  } else {
    const rows = db
      .prepare(
        `SELECT id, title, oil_type, location
         FROM oil_recovery_listings
         WHERE is_hidden = 0 AND collection_status NOT IN ('Processed','Cancelled')
         ORDER BY created_at DESC LIMIT 200`
      )
      .all() as Array<Record<string, unknown>>;

    for (const r of rows) {
      const rTitle = String(r.title ?? '');
      const rLoc = String(r.location ?? '');
      const rNormTitle = normalizeText(rTitle);
      const titleSim = normTitle && rNormTitle === normTitle ? 1 : jaccardSimilarity(titleTokens, tokenize(rTitle));
      const sameLoc = Boolean(normLoc && normalizeText(rLoc) === normLoc);
      if (titleSim >= 0.85 && sameLoc) {
        matches.push({
          id: String(r.id),
          title: rTitle,
          location: rLoc,
          reason: 'Matches an active Used Cooking Oil lot in the same area',
          similarityScore: Math.min(95, Math.round(titleSim * 100)),
        });
      }
    }
  }

  matches.sort((a, b) => b.similarityScore - a.similarityScore);
  return matches.slice(0, 3);
}

function collectHeuristicFlags(params: {
  listingType: ListingKind;
  payload: Record<string, unknown>;
  primaryImage: ReturnType<typeof extractImageData>;
  evidenceImage: ReturnType<typeof extractImageData>;
  evidenceNotes: string;
  duplicates: DuplicateCandidate[];
  sellerVerified: boolean;
}): Array<{ severity: 'warning' | 'high'; code: string; message: string }> {
  const { listingType, payload, primaryImage, evidenceImage, evidenceNotes, duplicates, sellerVerified } = params;
  const flags: Array<{ severity: 'warning' | 'high'; code: string; message: string }> = [];

  const title = String(payload.title ?? '').trim();
  const description = String(payload.description ?? '').trim();
  const combined = `${title} ${description} ${evidenceNotes}`.toLowerCase();

  // Duplicate signals
  if (duplicates.some((d) => d.similarityScore >= 85)) {
    flags.push({
      severity: 'high',
      code: 'duplicate_listing',
      message: `A closely matching active listing ("${duplicates[0].title}") is already live. Duplicate listings cannot be published.`,
    });
  } else if (duplicates.length > 0) {
    flags.push({
      severity: 'warning',
      code: 'possible_duplicate',
      message: `This submission looks similar to an active listing ("${duplicates[0].title}"). Please clarify what makes this batch distinct.`,
    });
  }

  // Off-platform advance payment / solicitation patterns
  const offPlatformPatterns = [
    /\b(pay\s+advance|advance\s+payment|wire\s+transfer|crypto\s+only|gift\s+card|send\s+money\s+first|upi\s+first\s+before\s+inspection|guaranteed\s+double\s+return)\b/i,
  ];
  if (offPlatformPatterns.some((rx) => rx.test(combined))) {
    flags.push({
      severity: 'high',
      code: 'off_platform_payment',
      message:
        'Verdora does not permit advance payment demands or off-platform prepayment solicitation. All handovers must allow direct inspection.',
    });
  }

  // Placeholder / gibberish / misleading text checks
  if (/^(test+|asdf+|qwerty+|aaaa+|xxxx+|fake\b|dummy\b)/i.test(title) || /(.)\1{6,}/.test(combined)) {
    flags.push({
      severity: 'high',
      code: 'misleading_text',
      message: 'The listing title or description appears to contain placeholder or non-genuine text.',
    });
  }

  if (listingType !== 'oil' && description.length < 20) {
    flags.push({
      severity: 'warning',
      code: 'thin_description',
      message: 'Description is quite brief. Add specific condition, dimensions, or batch details so recipients can verify quality.',
    });
  }

  // Image presence & quality checks
  if (listingType !== 'oil') {
    const imgUrl = String(payload.imageUrl ?? '').trim();
    if (!imgUrl) {
      flags.push({
        severity: 'warning',
        code: 'missing_image',
        message: 'No item photograph was uploaded. Adding a clear photo of the actual item helps verify authenticity.',
      });
    } else if (primaryImage && primaryImage.approxBytes < 1200) {
      flags.push({
        severity: 'warning',
        code: 'tiny_image',
        message: 'The uploaded image is very small or low resolution. Please upload a clearer photo of the item.',
      });
    }
  }

  // Pricing & quantity sanity (Material Marketplace)
  if (listingType === 'material') {
    const qty = Number(payload.quantity ?? 0);
    const price =
      payload.indicativePrice === null || payload.indicativePrice === undefined || payload.indicativePrice === ''
        ? null
        : Number(payload.indicativePrice);

    if (price !== null) {
      if (price > 50_00_000) {
        flags.push({
          severity: 'high',
          code: 'unrealistic_price',
          message: `The indicative price (₹${price.toLocaleString('en-IN')}) appears unrealistic for a circular reuse listing.`,
        });
      } else if (price >= 1_00_000 && !sellerVerified && !evidenceNotes.trim() && !evidenceImage) {
        flags.push({
          severity: 'warning',
          code: 'needs_evidence',
          message:
            'High-value listings (₹1,00,000+) from unverified accounts require supporting documentation or source evidence before publishing.',
        });
      } else if (price > 0 && price <= 5 && qty >= 500) {
        flags.push({
          severity: 'high',
          code: 'unrealistic_price',
          message:
            'The indicative price appears unusually low relative to the bulk quantity listed. Enter ₹0 for Free Pickup or provide a realistic ₹ INR estimate.',
        });
      }
    }

    if (qty > 100_000) {
      flags.push({
        severity: 'warning',
        code: 'needs_evidence',
        message: 'Very large bulk quantities require supporting warehouse or batch documentation for review.',
      });
    }
  }

  // Food Rescue disclosure completeness
  if (listingType === 'food') {
    const storageInfo = String(payload.storageInfo ?? '').trim();
    const allergens = String(payload.allergens ?? '').trim();
    const portions = Number(payload.portions ?? 0);
    if (!storageInfo || !allergens) {
      flags.push({
        severity: 'warning',
        code: 'missing_food_safety',
        message: 'Storage conditions and allergen disclosures should be clearly stated before publishing surplus food.',
      });
    }
    if (portions > 1000 && !sellerVerified && !evidenceNotes.trim() && !evidenceImage) {
      flags.push({
        severity: 'warning',
        code: 'needs_evidence',
        message: 'Large food batches (over 1,000 portions) require kitchen or event source confirmation for review.',
      });
    }
  }

  // Oil recovery sanity
  if (listingType === 'oil') {
    const liters = Number(payload.volumeLiters ?? 0);
    if (liters > 50_000 && !sellerVerified && !evidenceNotes.trim() && !evidenceImage) {
      flags.push({
        severity: 'warning',
        code: 'needs_evidence',
        message: 'Very large used cooking oil volumes require facility storage confirmation before publishing.',
      });
    }
  }

  return flags;
}

function mapVerificationRow(row: Record<string, unknown>): PublicVerificationRecord {
  const status = String(row.status) as VerificationStatus;
  const humanReviewStatus = String(row.human_review_status || 'none') as PublicVerificationRecord['humanReviewStatus'];
  const publishedListingId = row.published_listing_id ? String(row.published_listing_id) : null;
  const expiresAt = String(row.expires_at);
  const notExpired = new Date(expiresAt).getTime() > Date.now();
  const canPublish =
    !publishedListingId &&
    notExpired &&
    (status === 'VERIFIED' || humanReviewStatus === 'approved');

  let reasons: string[] = [];
  let checks: VerificationCheckItem[] = [];
  let duplicateMatches: DuplicateCandidate[] = [];
  let payload: Record<string, unknown> = {};

  try {
    reasons = JSON.parse(String(row.reasons_json || '[]'));
  } catch {
    reasons = [];
  }
  try {
    checks = JSON.parse(String(row.checks_json || '[]'));
  } catch {
    checks = [];
  }
  try {
    duplicateMatches = JSON.parse(String(row.duplicate_matches_json || '[]'));
  } catch {
    duplicateMatches = [];
  }
  try {
    payload = JSON.parse(String(row.payload_json || '{}'));
  } catch {
    payload = {};
  }

  const actionRequired =
    status === 'VERIFIED' || humanReviewStatus === 'approved'
      ? null
      : status === 'HIGH_RISK'
        ? 'Resolve the flagged concerns and re-run Verdora AI verification before publishing.'
        : humanReviewStatus === 'pending'
          ? 'Your listing and supporting evidence are queued for human administrator review.'
          : humanReviewStatus === 'rejected'
            ? String(row.human_review_notes || 'Administrator declined this submission. Revise the listing and verify again.')
            : 'Provide supporting evidence or clarify the flagged details, then re-verify or submit for human review.';

  return {
    id: String(row.id),
    userId: String(row.user_id),
    userName: row.user_name ? String(row.user_name) : undefined,
    userEmail: row.user_email ? String(row.user_email) : undefined,
    listingType: String(row.listing_type) as ListingKind,
    status,
    humanReviewStatus,
    humanReviewNotes: row.human_review_notes ? String(row.human_review_notes) : null,
    riskScore: Number(row.risk_score || 0),
    summary: String(row.summary || ''),
    reasons,
    actionRequired,
    checks,
    duplicateMatches,
    evidenceNotes: String(row.evidence_notes || ''),
    hasEvidenceImage: Boolean(row.evidence_image_url),
    canPublish,
    publishedListingId,
    payload,
    disclaimer: VERIFICATION_DISCLAIMER,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiresAt,
  };
}

export function validateAndLockListingVerification(params: {
  verificationId: unknown;
  userId: string;
  listingType: ListingKind;
  candidatePayload: Record<string, unknown>;
}): { ok: true; verificationId: string; aiStatus: string } | { ok: false; statusCode: number; error: string } {
  const { verificationId, userId, listingType, candidatePayload } = params;
  if (typeof verificationId !== 'string' || !verificationId.trim()) {
    return {
      ok: false,
      statusCode: 403,
      error:
        'AI listing verification is required before publishing. Click "Add to List" and verify your listing with Verdora AI first.',
    };
  }

  const row = db
    .prepare('SELECT * FROM listing_verifications WHERE id = ?')
    .get(verificationId.trim()) as Record<string, unknown> | undefined;

  if (!row) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Invalid or unknown AI verification record. Please verify your listing with Verdora AI.',
    };
  }

  if (String(row.user_id) !== userId) {
    return {
      ok: false,
      statusCode: 403,
      error: 'This AI verification belongs to a different account.',
    };
  }

  if (String(row.listing_type) !== listingType) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Verification record type does not match the listing category being published.',
    };
  }

  if (row.published_listing_id) {
    return {
      ok: false,
      statusCode: 409,
      error: 'This verification has already been used to publish a listing. Run a new AI verification for additional listings.',
    };
  }

  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    return {
      ok: false,
      statusCode: 410,
      error: 'This AI verification has expired. Please re-verify your listing with Verdora AI.',
    };
  }

  const status = String(row.status) as VerificationStatus;
  const humanStatus = String(row.human_review_status || 'none');

  if (status === 'HIGH_RISK' && humanStatus !== 'approved') {
    return {
      ok: false,
      statusCode: 403,
      error: 'Publishing is blocked because Verdora AI flagged this listing as HIGH RISK. Resolve the concerns and re-verify.',
    };
  }

  if (status !== 'VERIFIED' && humanStatus !== 'approved') {
    return {
      ok: false,
      statusCode: 403,
      error:
        humanStatus === 'pending'
          ? 'This listing is currently awaiting human administrator review before publishing.'
          : 'This listing requires additional verification or human review before it can be published.',
    };
  }

  const candidateHash = computeListingPayloadHash(listingType, candidatePayload);
  if (candidateHash !== String(row.payload_hash)) {
    return {
      ok: false,
      statusCode: 409,
      error:
        'Listing details were modified after AI verification. Please re-run Verdora AI verification on the updated details before publishing.',
    };
  }

  const aiStatus = humanStatus === 'approved' ? 'Human Reviewed & Approved' : 'AI Verified';
  return { ok: true, verificationId: String(row.id), aiStatus };
}

export function markVerificationPublished(verificationId: string, listingId: string): void {
  db.prepare(
    'UPDATE listing_verifications SET published_listing_id = ?, updated_at = ? WHERE id = ?'
  ).run(listingId, new Date().toISOString(), verificationId);
}

export function registerListingVerificationRoutes(app: Express): void {
  const verifyLimiter = createRateLimiter(60_000, 20, 'ai-verify');
  const adminLimiter = createRateLimiter(60_000, 60, 'admin-ai-verify');

  // 1. Run Verdora AI Listing Verification
  app.post('/api/ai/verify-listing', requireAuth, verifyLimiter, async (req: AuthedRequest, res) => {
    try {
      const u = req.user!;
      const body = req.body ?? {};
      const listingType = body.listingType as ListingKind;
      if (!['material', 'food', 'oil'].includes(listingType)) {
        res.status(400).json({ error: 'Invalid listing type. Expected material, food, or oil.' });
        return;
      }

      const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;
      const evidenceNotes = typeof body.evidenceNotes === 'string' ? body.evidenceNotes.trim().slice(0, 1000) : '';
      const evidenceImageUrl =
        typeof body.evidenceImageUrl === 'string' && body.evidenceImageUrl.startsWith('data:image/')
          ? body.evidenceImageUrl
          : null;

      // Validate basic required listing fields before AI verification
      const errors: string[] = [];
      const title = typeof payload.title === 'string' ? payload.title.trim() : '';
      const location = typeof payload.location === 'string' ? payload.location.trim() : '';
      if (title.length < 3) errors.push('Listing title must be at least 3 characters.');
      if (location.length < 2) errors.push('Approximate location is required.');
      if (typeof payload.whatsappNumber === 'string' && payload.whatsappNumber.trim() && !isValidPhone(payload.whatsappNumber)) {
        errors.push('Invalid WhatsApp number format.');
      }

      if (listingType === 'material') {
        if (typeof payload.category !== 'string' || !payload.category.trim()) errors.push('Category is required.');
        if (typeof payload.description !== 'string' || payload.description.trim().length < 10) {
          errors.push('Description must be at least 10 characters.');
        }
        const qty = Number(payload.quantity);
        if (!Number.isFinite(qty) || qty <= 0) errors.push('Quantity must be greater than 0.');
        if (typeof payload.unit !== 'string' || !payload.unit.trim()) errors.push('Unit is required.');
        if (typeof payload.condition !== 'string' || !payload.condition.trim()) errors.push('Condition is required.');
        if (payload.indicativePrice !== undefined && payload.indicativePrice !== null && payload.indicativePrice !== '') {
          const p = Number(payload.indicativePrice);
          if (!Number.isFinite(p) || p < 0) errors.push('Indicative price must be 0 or greater.');
        }
      } else if (listingType === 'food') {
        if (typeof payload.category !== 'string' || !payload.category.trim()) errors.push('Food category is required.');
        if (typeof payload.description !== 'string' || payload.description.trim().length < 10) {
          errors.push('Description must be at least 10 characters.');
        }
        const qty = Number(payload.quantity);
        const portions = Number(payload.portions);
        if (!Number.isFinite(qty) || qty <= 0) errors.push('Quantity must be greater than 0.');
        if (!Number.isFinite(portions) || portions < 1) errors.push('Portions must be at least 1.');
        if (typeof payload.pickupDeadline !== 'string' || !payload.pickupDeadline.trim()) {
          errors.push('Pickup deadline is required.');
        } else if (new Date(payload.pickupDeadline).getTime() <= Date.now()) {
          errors.push('Pickup deadline must be in the future.');
        }
      } else {
        if (typeof payload.oilType !== 'string' || payload.oilType.trim().length < 2) {
          errors.push('Oil type is required.');
        }
        const liters = Number(payload.volumeLiters);
        if (!Number.isFinite(liters) || liters <= 0) errors.push('Volume in liters must be greater than 0.');
        if (typeof payload.qualityGrade !== 'string' || !payload.qualityGrade.trim()) errors.push('Quality grade is required.');
        if (typeof payload.containerType !== 'string' || !payload.containerType.trim()) errors.push('Container type is required.');
        if (typeof payload.filtrationStatus !== 'string' || !payload.filtrationStatus.trim()) errors.push('Filtration status is required.');
        if (typeof payload.pickupWindow !== 'string' || !payload.pickupWindow.trim()) errors.push('Pickup window is required.');
      }

      const primaryImage = extractImageData(payload.imageUrl);
      if (primaryImage && primaryImage.approxBytes > 5 * 1024 * 1024) {
        errors.push('Listing photo exceeds the 5 MB upload limit.');
      }
      const evidenceImage = extractImageData(evidenceImageUrl);
      if (evidenceImage && evidenceImage.approxBytes > 5 * 1024 * 1024) {
        errors.push('Supporting evidence image exceeds the 5 MB upload limit.');
      }

      if (errors.length > 0) {
        res.status(400).json({ error: errors[0], errors });
        return;
      }

      const imageHash = computeImageHash(payload.imageUrl);
      const description =
        listingType === 'oil'
          ? `${String(payload.oilType ?? '')} · ${String(payload.qualityGrade ?? '')} · ${String(payload.filtrationStatus ?? '')} · ${String(payload.containerType ?? '')}`
          : String(payload.description ?? '').trim();

      const duplicateMatches = findDuplicateListings({
        listingType,
        title,
        description,
        location,
        imageHash,
      });

      const heuristicFlags = collectHeuristicFlags({
        listingType,
        payload,
        primaryImage,
        evidenceImage,
        evidenceNotes,
        duplicates: duplicateMatches,
        sellerVerified: u.verification_status === 'Approved',
      });

      const assessment = await verifyListingWithAI({
        listingType,
        title,
        category: listingType === 'oil' ? String(payload.oilType ?? 'Used Cooking Oil') : String(payload.category ?? ''),
        description,
        quantity: listingType === 'oil' ? Number(payload.volumeLiters ?? 0) : Number(payload.quantity ?? 0),
        unit: listingType === 'oil' ? 'L' : String(payload.unit ?? 'kg'),
        condition: typeof payload.condition === 'string' ? payload.condition : undefined,
        location,
        indicativePrice:
          payload.indicativePrice === null || payload.indicativePrice === undefined || payload.indicativePrice === ''
            ? null
            : Number(payload.indicativePrice),
        portions: payload.portions !== undefined ? Math.round(Number(payload.portions)) : undefined,
        preparedAt: typeof payload.preparedAt === 'string' ? payload.preparedAt : null,
        pickupDeadline: typeof payload.pickupDeadline === 'string' ? payload.pickupDeadline : undefined,
        storageInfo: typeof payload.storageInfo === 'string' ? payload.storageInfo : undefined,
        packagingInfo: typeof payload.packagingInfo === 'string' ? payload.packagingInfo : undefined,
        allergens: typeof payload.allergens === 'string' ? payload.allergens : undefined,
        oilType: typeof payload.oilType === 'string' ? payload.oilType : undefined,
        qualityGrade: typeof payload.qualityGrade === 'string' ? payload.qualityGrade : undefined,
        containerType: typeof payload.containerType === 'string' ? payload.containerType : undefined,
        filtrationStatus: typeof payload.filtrationStatus === 'string' ? payload.filtrationStatus : undefined,
        pickupWindow: typeof payload.pickupWindow === 'string' ? payload.pickupWindow : undefined,
        sellerName: u.name,
        sellerOrganization: u.organization || '',
        sellerVerified: u.verification_status === 'Approved',
        evidenceNotes,
        primaryImage: primaryImage ? { base64Data: primaryImage.base64Data, mimeType: primaryImage.mimeType } : null,
        evidenceImage: evidenceImage ? { base64Data: evidenceImage.base64Data, mimeType: evidenceImage.mimeType } : null,
        duplicateMatches,
        heuristicFlags,
      });

      const id = createId('verai');
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
      const payloadHash = computeListingPayloadHash(listingType, payload);

      db.prepare(
        `INSERT INTO listing_verifications (
          id, user_id, listing_type, payload_json, payload_hash, image_hash,
          status, human_review_status, risk_score, summary, reasons_json,
          checks_json, duplicate_matches_json, evidence_notes, evidence_image_url,
          created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        u.id,
        listingType,
        JSON.stringify(payload),
        payloadHash,
        imageHash,
        assessment.status,
        assessment.riskScore,
        assessment.summary,
        JSON.stringify(assessment.reasons),
        JSON.stringify(assessment.checks),
        JSON.stringify(duplicateMatches),
        evidenceNotes,
        evidenceImageUrl ? evidenceImageUrl.slice(0, 750000) : null,
        now,
        now,
        expiresAt
      );

      touchUserActivity(u.id);
      const saved = db.prepare('SELECT * FROM listing_verifications WHERE id = ?').get(id) as Record<string, unknown>;
      res.status(201).json({
        verification: mapVerificationRow(saved),
        mode: assessment.mode,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to complete AI listing verification right now.',
      });
    }
  });

  // 2. Submit a NEEDS_REVIEW verification for Human Administrator Review
  app.post('/api/ai/verifications/:id/request-review', requireAuth, (req: AuthedRequest, res) => {
    const u = req.user!;
    const row = db
      .prepare('SELECT * FROM listing_verifications WHERE id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Verification record not found.' });
      return;
    }
    if (String(row.user_id) !== u.id) {
      res.status(403).json({ error: 'Not authorized to submit this verification for review.' });
      return;
    }
    if (String(row.status) === 'HIGH_RISK') {
      res.status(409).json({
        error: 'High-risk submissions cannot be sent for review until the flagged issues are corrected and re-verified.',
      });
      return;
    }
    if (row.published_listing_id) {
      res.status(409).json({ error: 'This listing has already been published.' });
      return;
    }

    const { evidenceNotes, evidenceImageUrl } = req.body ?? {};
    const cleanNotes =
      typeof evidenceNotes === 'string' && evidenceNotes.trim()
        ? evidenceNotes.trim().slice(0, 1000)
        : String(row.evidence_notes || '');
    const cleanEvidenceImg =
      typeof evidenceImageUrl === 'string' && evidenceImageUrl.startsWith('data:image/')
        ? evidenceImageUrl.slice(0, 750000)
        : row.evidence_image_url
          ? String(row.evidence_image_url)
          : null;

    const now = new Date().toISOString();
    const extendedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `UPDATE listing_verifications
       SET human_review_status = 'pending', evidence_notes = ?, evidence_image_url = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(cleanNotes, cleanEvidenceImg, extendedExpiry, now, String(row.id));

    touchUserActivity(u.id);
    const updated = db.prepare('SELECT * FROM listing_verifications WHERE id = ?').get(String(row.id)) as Record<string, unknown>;
    res.json({ verification: mapVerificationRow(updated) });
  });

  // 3. List current user's recent verification records
  app.get('/api/ai/verifications/mine', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM listing_verifications
         WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 30`
      )
      .all(req.user!.id) as Array<Record<string, unknown>>;
    res.json({ verifications: rows.map(mapVerificationRow) });
  });

  // 4. Admin queue of AI listing verifications & human reviews
  app.get('/api/admin/ai-verifications', requireAdmin, (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'All';
    const review = typeof req.query.review === 'string' ? req.query.review : 'All';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const rows = db
      .prepare(
        `SELECT lv.*, u.name as user_name, u.email as user_email
         FROM listing_verifications lv
         JOIN users u ON u.id = lv.user_id
         ORDER BY
           CASE WHEN lv.human_review_status = 'pending' THEN 0 ELSE 1 END,
           lv.created_at DESC
         LIMIT 200`
      )
      .all() as Array<Record<string, unknown>>;

    let items = rows.map(mapVerificationRow);
    if (status !== 'All') {
      items = items.filter((v) => v.status === status);
    }
    if (review !== 'All') {
      items = items.filter((v) => v.humanReviewStatus === review);
    }
    if (q) {
      items = items.filter((v) => {
        const title = String(v.payload.title ?? '').toLowerCase();
        return (
          title.includes(q) ||
          (v.userName ?? '').toLowerCase().includes(q) ||
          (v.userEmail ?? '').toLowerCase().includes(q) ||
          v.summary.toLowerCase().includes(q)
        );
      });
    }

    res.json({ verifications: items });
  });

  // 5. Admin Approve / Reject a human-review listing verification
  app.patch('/api/admin/ai-verifications/:id', requireAdmin, adminLimiter, (req: AuthedRequest, res) => {
    const { decision, notes } = req.body ?? {};
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'Decision must be "approved" or "rejected".' });
      return;
    }

    const row = db
      .prepare('SELECT * FROM listing_verifications WHERE id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Verification record not found.' });
      return;
    }

    const now = new Date().toISOString();
    const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 400) : '';
    const extendedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `UPDATE listing_verifications
       SET human_review_status = ?, human_reviewer_id = ?, human_review_notes = ?,
           expires_at = CASE WHEN ? = 'approved' THEN ? ELSE expires_at END,
           updated_at = ?
       WHERE id = ?`
    ).run(decision, req.user!.id, cleanNotes || null, decision, extendedExpiry, now, String(row.id));

    let payloadTitle = 'your listing';
    try {
      const parsed = JSON.parse(String(row.payload_json || '{}')) as { title?: string };
      if (parsed.title) payloadTitle = `"${parsed.title}"`;
    } catch {
      /* ignore */
    }

    addNotification(
      String(row.user_id),
      decision === 'approved' ? 'Listing Verification Approved' : 'Listing Verification Declined',
      decision === 'approved'
        ? `Administrator approved ${payloadTitle}. Open AI Assistant -> Verification History to publish it.`
        : `Administrator declined ${payloadTitle}.${cleanNotes ? ` Note: ${cleanNotes}` : ''}`,
      'ai-lab'
    );

    logAudit(
      req.user!.id,
      req.user!.name,
      decision === 'approved' ? 'AI_LISTING_VERIFICATION_APPROVED' : 'AI_LISTING_VERIFICATION_REJECTED',
      'listing_verification',
      String(row.id),
      `${decision.toUpperCase()} AI verification for ${payloadTitle}`,
      { targetUserId: String(row.user_id), reason: cleanNotes || null, result: 'Success' }
    );

    const updated = db
      .prepare(
        `SELECT lv.*, u.name as user_name, u.email as user_email
         FROM listing_verifications lv
         JOIN users u ON u.id = lv.user_id
         WHERE lv.id = ?`
      )
      .get(String(row.id)) as Record<string, unknown>;
    res.json({ verification: mapVerificationRow(updated) });
  });
}
