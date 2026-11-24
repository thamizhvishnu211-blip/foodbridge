import fs from 'node:fs';
import path from 'node:path';
import type { mapFoodDonation, mapMaterialListing, mapOilListing } from './shared.ts';

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
  apiKey?: string;
}

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

type MappedMaterial = ReturnType<typeof mapMaterialListing> & { sellerUid?: string };
type MappedFood = ReturnType<typeof mapFoodDonation> & { donorUid?: string };
type MappedOil = ReturnType<typeof mapOilListing> & { supplierUid?: string };

let cachedConfig: FirebaseAppletConfig | null | undefined;
const queryCache = new Map<string, { expiresAt: number; data: unknown[] }>();
const CACHE_TTL_MS = 4000;

function getFirebaseConfig(): FirebaseAppletConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  if (process.env.VERDORA_DISABLE_FIRESTORE_SYNC === 'true' || process.env.VERDORA_DB_PATH) {
    cachedConfig = null;
    return null;
  }
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(cfgPath)) {
    cachedConfig = null;
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as FirebaseAppletConfig;
    if (!parsed.projectId || parsed.projectId === 'remixed-project-id') {
      cachedConfig = null;
      return null;
    }
    cachedConfig = parsed;
    return parsed;
  } catch {
    cachedConfig = null;
    return null;
  }
}

function decodeFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values ?? []).map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields ?? {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function decodeDocumentFields(fields?: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

async function runPublicCollectionQuery(collectionId: string): Promise<Array<Record<string, unknown>>> {
  const cfg = getFirebaseConfig();
  if (!cfg?.projectId) return [];

  const cached = queryCache.get(collectionId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data as Array<Record<string, unknown>>;
  }

  const databaseId = cfg.firestoreDatabaseId || '(default)';
  const apiKeySuffix = cfg.apiKey ? `?key=${encodeURIComponent(cfg.apiKey)}` : '';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(databaseId)}/documents:runQuery${apiKeySuffix}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'isPublic' },
              op: 'EQUAL',
              value: { booleanValue: true },
            },
          },
          limit: 100,
        },
      }),
    });

    if (!res.ok) {
      return [];
    }

    const rows = (await res.json()) as Array<{
      document?: { name?: string; fields?: Record<string, FirestoreValue> };
    }>;

    const docs = rows
      .filter((r) => Boolean(r.document?.fields))
      .map((r) => {
        const decoded = decodeDocumentFields(r.document?.fields);
        if (!decoded.id && r.document?.name) {
          const parts = r.document.name.split('/');
          decoded.id = parts[parts.length - 1];
        }
        return decoded;
      });

    queryCache.set(collectionId, { expiresAt: now + CACHE_TTL_MS, data: docs });
    return docs;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function invalidatePublicSyncCache(collectionId?: string): void {
  if (collectionId) {
    queryCache.delete(collectionId);
  } else {
    queryCache.clear();
  }
}

export async function fetchPublicMaterialsFromFirestore(): Promise<MappedMaterial[]> {
  const docs = await runPublicCollectionQuery('material_listings');
  return docs
    .filter((d) => typeof d.id === 'string' && typeof d.title === 'string')
    .map((d) => ({
      id: String(d.id),
      sellerId: String(d.sellerId || d.sellerUid || ''),
      sellerUid: typeof d.sellerUid === 'string' ? d.sellerUid : undefined,
      sellerName: String(d.sellerName || 'VERDORA Supplier'),
      sellerOrganization: String(d.sellerOrganization || ''),
      sellerVerified: Boolean(d.sellerVerified),
      title: String(d.title),
      category: String(d.category || 'Other reusable materials'),
      description: String(d.description || ''),
      quantity: Number(d.quantity || 0),
      unit: String(d.unit || 'kg'),
      condition: String(d.condition || 'Good'),
      location: String(d.location || ''),
      indicativePrice: d.indicativePrice === null || d.indicativePrice === undefined ? null : Number(d.indicativePrice),
      currency: String(d.currency || 'INR'),
      imageUrl: String(d.imageUrl || 'media:aluminium'),
      availableUntil: String(d.availableUntil || new Date().toISOString()),
      pickupPreferences: String(d.pickupPreferences || ''),
      reuseApplications: Array.isArray(d.reuseApplications) ? d.reuseApplications.map(String) : [],
      whatsappNumber: null,
      status: String(d.status || 'Active'),
      isHidden: Boolean(d.isHidden),
      hiddenReason: null,
      isDemo: false,
      createdAt: String(d.createdAt || new Date().toISOString()),
      updatedAt: String(d.updatedAt || d.createdAt || new Date().toISOString()),
    }));
}

export async function fetchPublicFoodDonationsFromFirestore(): Promise<MappedFood[]> {
  const docs = await runPublicCollectionQuery('food_donations');
  return docs
    .filter((d) => typeof d.id === 'string' && typeof d.title === 'string')
    .map((d) => {
      const deadline = String(d.pickupDeadline || new Date().toISOString());
      const rawStatus = String(d.status || 'Available');
      const isExpiredNow =
        new Date(deadline).getTime() < Date.now() &&
        !['Completed', 'Cancelled', 'Expired'].includes(rawStatus);
      return {
        id: String(d.id),
        donorId: String(d.donorId || d.donorUid || ''),
        donorUid: typeof d.donorUid === 'string' ? d.donorUid : undefined,
        donorName: String(d.donorName || 'VERDORA Donor'),
        donorOrganization: String(d.donorOrganization || ''),
        donorVerified: Boolean(d.donorVerified),
        title: String(d.title),
        description: String(d.description || ''),
        category: String(d.category || 'Other surplus food'),
        quantity: Number(d.quantity || 0),
        unit: String(d.unit || 'kg'),
        portions: Number(d.portions || 0),
        remainingPortions: Number(d.remainingPortions ?? d.portions ?? 0),
        preparedAt: d.preparedAt ? String(d.preparedAt) : null,
        availableUntil: String(d.availableUntil || deadline),
        pickupDeadline: deadline,
        storageInfo: String(d.storageInfo || ''),
        packagingInfo: String(d.packagingInfo || ''),
        allergens: String(d.allergens || ''),
        dietaryInfo: String(d.dietaryInfo || ''),
        location: String(d.location || ''),
        collectionInstructions: String(d.collectionInstructions || ''),
        imageUrl: String(d.imageUrl || 'media:bakery'),
        whatsappNumber: null,
        status: isExpiredNow ? 'Expired' : rawStatus,
        isHidden: Boolean(d.isHidden),
        hiddenReason: null,
        isDemo: false,
        createdAt: String(d.createdAt || new Date().toISOString()),
        updatedAt: String(d.updatedAt || d.createdAt || new Date().toISOString()),
      };
    });
}

export async function fetchPublicOilListingsFromFirestore(): Promise<MappedOil[]> {
  const docs = await runPublicCollectionQuery('oil_recovery_listings');
  return docs
    .filter((d) => typeof d.id === 'string' && typeof d.title === 'string')
    .map((d) => ({
      id: String(d.id),
      supplierId: String(d.supplierId || d.supplierUid || ''),
      supplierUid: typeof d.supplierUid === 'string' ? d.supplierUid : undefined,
      supplierName: String(d.supplierName || 'VERDORA Supplier'),
      supplierOrganization: String(d.supplierOrganization || ''),
      supplierVerified: Boolean(d.supplierVerified),
      title: String(d.title),
      oilType: String(d.oilType || 'Used Cooking Oil'),
      volumeLiters: Number(d.volumeLiters || 0),
      qualityGrade: String(d.qualityGrade || 'Standard'),
      containerType: String(d.containerType || 'Sealed Drum'),
      filtrationStatus: String(d.filtrationStatus || 'Filtered'),
      pickupWindow: String(d.pickupWindow || ''),
      location: String(d.location || ''),
      collectionStatus: String(d.collectionStatus || 'Available'),
      whatsappNumber: null,
      isHidden: Boolean(d.isHidden),
      hiddenReason: null,
      createdAt: String(d.createdAt || new Date().toISOString()),
      updatedAt: String(d.updatedAt || d.createdAt || new Date().toISOString()),
    }));
}

export function mergeWithRemoteById<T extends { id: string; updatedAt: string; whatsappNumber: string | null }>(
  localItems: T[],
  remoteItems: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const item of remoteItems) {
    byId.set(item.id, item);
  }
  for (const local of localItems) {
    const remote = byId.get(local.id);
    if (!remote) {
      byId.set(local.id, local);
      continue;
    }
    const localTime = new Date(local.updatedAt).getTime() || 0;
    const remoteTime = new Date(remote.updatedAt).getTime() || 0;
    if (localTime >= remoteTime) {
      byId.set(local.id, local);
    } else {
      byId.set(local.id, {
        ...remote,
        whatsappNumber: remote.whatsappNumber ?? local.whatsappNumber,
      });
    }
  }
  return Array.from(byId.values());
}
