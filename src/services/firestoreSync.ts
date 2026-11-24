import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type {
  FoodDonation,
  FoodDonationStatus,
  FoodRequest,
  FoodRequestStatus,
  MaterialListing,
  MaterialRequest,
  MaterialRequestStatus,
  MaterialStatus,
  OilBuyerEnquiry,
  OilCollectionStatus,
  OilEnquiryStatus,
  OilRecoveryListing,
  User,
} from '../types';
import { compressImageDataUrlForFirestore } from '../utils/image';

function isPermissionDeniedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  return code.includes('permission-denied') || msg.includes('missing or insufficient permissions');
}

function toIso(value: unknown, fallback = new Date().toISOString()): string {
  if (!value) return fallback;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

function sanitizeDocId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export function isOwnerOfResource(
  user: User | null,
  ownerId: string,
  ownerUid?: string
): boolean {
  if (!user) return false;
  if (ownerId === user.id) return true;
  const activeFbUid = auth.currentUser?.uid || user.firebaseUid;
  return Boolean(ownerUid && activeFbUid && ownerUid === activeFbUid);
}

function mapMaterialDoc(id: string, d: Record<string, unknown>): MaterialListing {
  return {
    id: String(d.id || id),
    sellerId: String(d.sellerId || d.sellerUid || ''),
    sellerUid: typeof d.sellerUid === 'string' ? d.sellerUid : undefined,
    sellerName: String(d.sellerName || 'VERDORA Supplier'),
    sellerOrganization: String(d.sellerOrganization || ''),
    sellerVerified: Boolean(d.sellerVerified),
    title: String(d.title || ''),
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
    status: String(d.status || 'Active') as MaterialStatus,
    isHidden: Boolean(d.isHidden),
    hiddenReason: null,
    isDemo: false,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt, toIso(d.createdAt)),
  };
}

function mapFoodDoc(id: string, d: Record<string, unknown>): FoodDonation {
  return {
    id: String(d.id || id),
    donorId: String(d.donorId || d.donorUid || ''),
    donorUid: typeof d.donorUid === 'string' ? d.donorUid : undefined,
    donorName: String(d.donorName || 'VERDORA Donor'),
    donorOrganization: String(d.donorOrganization || ''),
    donorVerified: Boolean(d.donorVerified),
    title: String(d.title || ''),
    description: String(d.description || ''),
    category: String(d.category || 'Other surplus food'),
    quantity: Number(d.quantity || 0),
    unit: String(d.unit || 'kg'),
    portions: Number(d.portions || 0),
    remainingPortions: Number(d.remainingPortions ?? d.portions ?? 0),
    preparedAt: typeof d.preparedAt === 'string' ? d.preparedAt : null,
    availableUntil: String(d.availableUntil || d.pickupDeadline || new Date().toISOString()),
    pickupDeadline: String(d.pickupDeadline || new Date().toISOString()),
    storageInfo: String(d.storageInfo || ''),
    packagingInfo: String(d.packagingInfo || ''),
    allergens: String(d.allergens || ''),
    dietaryInfo: String(d.dietaryInfo || ''),
    location: String(d.location || ''),
    collectionInstructions: String(d.collectionInstructions || ''),
    imageUrl: String(d.imageUrl || 'media:bakery'),
    whatsappNumber: null,
    status: String(d.status || 'Available') as FoodDonationStatus,
    isHidden: Boolean(d.isHidden),
    hiddenReason: null,
    isDemo: false,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt, toIso(d.createdAt)),
  };
}

function mapOilDoc(id: string, d: Record<string, unknown>): OilRecoveryListing {
  return {
    id: String(d.id || id),
    supplierId: String(d.supplierId || d.supplierUid || ''),
    supplierUid: typeof d.supplierUid === 'string' ? d.supplierUid : undefined,
    supplierName: String(d.supplierName || 'VERDORA Supplier'),
    supplierOrganization: String(d.supplierOrganization || ''),
    supplierVerified: Boolean(d.supplierVerified),
    title: String(d.title || ''),
    oilType: String(d.oilType || 'Used Cooking Oil'),
    volumeLiters: Number(d.volumeLiters || 0),
    qualityGrade: String(d.qualityGrade || 'Standard'),
    containerType: String(d.containerType || 'Sealed Drum'),
    filtrationStatus: String(d.filtrationStatus || 'Filtered'),
    pickupWindow: String(d.pickupWindow || ''),
    location: String(d.location || ''),
    collectionStatus: String(d.collectionStatus || 'Available') as OilCollectionStatus,
    whatsappNumber: null,
    isHidden: Boolean(d.isHidden),
    hiddenReason: null,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt, toIso(d.createdAt)),
  };
}

function mapMaterialReqDoc(id: string, d: Record<string, unknown>): MaterialRequest {
  return {
    id: String(d.id || id),
    listingId: String(d.listingId || ''),
    listingTitle: String(d.listingTitle || ''),
    listingCategory: String(d.listingCategory || ''),
    listingUnit: String(d.listingUnit || 'kg'),
    listingLocation: String(d.listingLocation || ''),
    sellerId: String(d.sellerId || d.sellerUid || ''),
    sellerUid: typeof d.sellerUid === 'string' ? d.sellerUid : undefined,
    sellerName: String(d.sellerName || ''),
    sellerWhatsapp: typeof d.sellerWhatsapp === 'string' ? d.sellerWhatsapp : null,
    buyerId: String(d.buyerId || d.buyerUid || ''),
    buyerUid: typeof d.buyerUid === 'string' ? d.buyerUid : undefined,
    buyerName: String(d.buyerName || ''),
    buyerWhatsapp: typeof d.buyerWhatsapp === 'string' ? d.buyerWhatsapp : null,
    requestedQuantity: Number(d.requestedQuantity || 0),
    intendedUse: String(d.intendedUse || ''),
    preferredDate: String(d.preferredDate || ''),
    preferredTime: String(d.preferredTime || ''),
    arrangement: (d.arrangement === 'Delivery Coordination' ? 'Delivery Coordination' : 'Pickup'),
    notes: String(d.notes || ''),
    status: String(d.status || 'Request Created') as MaterialRequestStatus,
    handoverConfirmedByBuyer: Boolean(d.handoverConfirmedByBuyer),
    handoverConfirmedBySeller: Boolean(d.handoverConfirmedBySeller),
    isDemo: false,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt, toIso(d.createdAt)),
  };
}

function mapFoodReqDoc(id: string, d: Record<string, unknown>): FoodRequest {
  return {
    id: String(d.id || id),
    donationId: String(d.donationId || ''),
    donationTitle: String(d.donationTitle || ''),
    donationLocation: String(d.donationLocation || ''),
    pickupDeadline: String(d.pickupDeadline || ''),
    donorId: String(d.donorId || d.donorUid || ''),
    donorUid: typeof d.donorUid === 'string' ? d.donorUid : undefined,
    donorName: String(d.donorName || ''),
    donorWhatsapp: typeof d.donorWhatsapp === 'string' ? d.donorWhatsapp : null,
    recipientId: String(d.recipientId || d.recipientUid || ''),
    recipientUid: typeof d.recipientUid === 'string' ? d.recipientUid : undefined,
    recipientName: String(d.recipientName || ''),
    recipientWhatsapp: typeof d.recipientWhatsapp === 'string' ? d.recipientWhatsapp : null,
    requestedPortions: Number(d.requestedPortions || 0),
    preferredTime: String(d.preferredTime || ''),
    notes: String(d.notes || ''),
    status: String(d.status || 'Request Received') as FoodRequestStatus,
    isDemo: false,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt, toIso(d.createdAt)),
  };
}

function mapOilEnquiryDoc(id: string, d: Record<string, unknown>): OilBuyerEnquiry {
  return {
    id: String(d.id || id),
    listingId: String(d.listingId || ''),
    listingTitle: String(d.listingTitle || ''),
    oilType: String(d.oilType || ''),
    listingLocation: String(d.listingLocation || ''),
    supplierId: String(d.supplierId || d.supplierUid || ''),
    supplierUid: typeof d.supplierUid === 'string' ? d.supplierUid : undefined,
    supplierName: String(d.supplierName || ''),
    supplierWhatsapp: typeof d.supplierWhatsapp === 'string' ? d.supplierWhatsapp : null,
    buyerId: String(d.buyerId || d.buyerUid || ''),
    buyerUid: typeof d.buyerUid === 'string' ? d.buyerUid : undefined,
    buyerName: String(d.buyerName || ''),
    buyerOrganization: String(d.buyerOrganization || ''),
    buyerWhatsapp: typeof d.buyerWhatsapp === 'string' ? d.buyerWhatsapp : null,
    requestedLiters: Number(d.requestedLiters || 0),
    intendedProcessing: String(d.intendedProcessing || ''),
    preferredCollectionDate: String(d.preferredCollectionDate || ''),
    notes: String(d.notes || ''),
    processingNotes: String(d.processingNotes || ''),
    status: String(d.status || 'Pending') as OilEnquiryStatus,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt, toIso(d.createdAt)),
  };
}

export function mergeCatalogItems<T extends { id: string; updatedAt: string }>(
  localItems: T[],
  remoteItems: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const r of remoteItems) {
    byId.set(r.id, r);
  }
  for (const l of localItems) {
    const r = byId.get(l.id);
    if (!r) {
      byId.set(l.id, l);
      continue;
    }
    const localTs = new Date(l.updatedAt).getTime() || 0;
    const remoteTs = new Date(r.updatedAt).getTime() || 0;
    if (remoteTs > localTs) {
      byId.set(l.id, {
        ...l,
        ...r,
        ...('whatsappNumber' in l && (l as { whatsappNumber?: string | null }).whatsappNumber
          ? { whatsappNumber: (l as { whatsappNumber?: string | null }).whatsappNumber }
          : {}),
      });
    } else {
      byId.set(l.id, {
        ...r,
        ...l,
      });
    }
  }
  return Array.from(byId.values());
}

export async function fetchPublicCatalogFromFirestore(): Promise<{
  materials: MaterialListing[];
  donations: FoodDonation[];
  oilListings: OilRecoveryListing[];
}> {
  const [matSnap, foodSnap, oilSnap] = await Promise.all([
    getDocsFromServer(query(collection(db, 'material_listings'), where('isPublic', '==', true))).catch((err) => {
      if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.LIST, 'material_listings');
      return null;
    }),
    getDocsFromServer(query(collection(db, 'food_donations'), where('isPublic', '==', true))).catch((err) => {
      if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.LIST, 'food_donations');
      return null;
    }),
    getDocsFromServer(query(collection(db, 'oil_recovery_listings'), where('isPublic', '==', true))).catch((err) => {
      if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.LIST, 'oil_recovery_listings');
      return null;
    }),
  ]);

  return {
    materials: matSnap ? matSnap.docs.map((docSnap) => mapMaterialDoc(docSnap.id, docSnap.data())) : [],
    donations: foodSnap ? foodSnap.docs.map((docSnap) => mapFoodDoc(docSnap.id, docSnap.data())) : [],
    oilListings: oilSnap ? oilSnap.docs.map((docSnap) => mapOilDoc(docSnap.id, docSnap.data())) : [],
  };
}

export async function fetchMyCatalogFromFirestore(uid: string): Promise<{
  materials: MaterialListing[];
  donations: FoodDonation[];
}> {
  if (!uid) return { materials: [], donations: [] };
  const [matSnap, foodSnap] = await Promise.all([
    getDocsFromServer(query(collection(db, 'material_listings'), where('sellerUid', '==', uid))).catch((err) => {
      if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.LIST, 'material_listings');
      return null;
    }),
    getDocsFromServer(query(collection(db, 'food_donations'), where('donorUid', '==', uid))).catch((err) => {
      if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.LIST, 'food_donations');
      return null;
    }),
  ]);

  return {
    materials: matSnap ? matSnap.docs.map((d) => mapMaterialDoc(d.id, d.data())) : [],
    donations: foodSnap ? foodSnap.docs.map((d) => mapFoodDoc(d.id, d.data())) : [],
  };
}

export function subscribePublicCatalogFromFirestore(handlers: {
  onMaterials: (items: MaterialListing[]) => void;
  onDonations: (items: FoodDonation[]) => void;
  onOilListings: (items: OilRecoveryListing[]) => void;
}): Unsubscribe {
  const unsubMat = onSnapshot(
    query(collection(db, 'material_listings'), where('isPublic', '==', true)),
    (snap) => {
      handlers.onMaterials(snap.docs.map((d) => mapMaterialDoc(d.id, d.data())));
    },
    (err) => {
      if (isPermissionDeniedError(err)) {
        handleFirestoreError(err, OperationType.LIST, 'material_listings');
      }
    }
  );

  const unsubFood = onSnapshot(
    query(collection(db, 'food_donations'), where('isPublic', '==', true)),
    (snap) => {
      handlers.onDonations(snap.docs.map((d) => mapFoodDoc(d.id, d.data())));
    },
    (err) => {
      if (isPermissionDeniedError(err)) {
        handleFirestoreError(err, OperationType.LIST, 'food_donations');
      }
    }
  );

  const unsubOil = onSnapshot(
    query(collection(db, 'oil_recovery_listings'), where('isPublic', '==', true)),
    (snap) => {
      handlers.onOilListings(snap.docs.map((d) => mapOilDoc(d.id, d.data())));
    },
    (err) => {
      if (isPermissionDeniedError(err)) {
        handleFirestoreError(err, OperationType.LIST, 'oil_recovery_listings');
      }
    }
  );

  return () => {
    unsubMat();
    unsubFood();
    unsubOil();
  };
}

export async function syncMaterialToFirestore(listing: MaterialListing): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  const docId = sanitizeDocId(listing.id);
  const path = `material_listings/${docId}`;
  const ref = doc(db, 'material_listings', docId);
  const safeImageUrl = await compressImageDataUrlForFirestore(listing.imageUrl, 'media:aluminium');
  const safeStatus = listing.status || 'Active';
  const isHidden = Boolean(listing.isHidden);
  const isPublic = !isHidden && safeStatus !== 'Cancelled';

  let existingSnapData: Record<string, unknown> | null = null;
  try {
    const snap = await getDocFromServer(ref);
    if (snap.exists()) existingSnapData = snap.data();
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  }

  const basePayload = {
    title: listing.title.trim().slice(0, 120),
    category: listing.category.trim().slice(0, 80),
    description: listing.description.trim().slice(0, 1500),
    quantity: Number(listing.quantity),
    unit: listing.unit.trim().slice(0, 24),
    condition: listing.condition.trim().slice(0, 60),
    location: listing.location.trim().slice(0, 120),
    indicativePrice:
      listing.indicativePrice === null || listing.indicativePrice === undefined
        ? null
        : Math.max(0, Number(listing.indicativePrice)),
    imageUrl: safeImageUrl,
    availableUntil: String(listing.availableUntil).slice(0, 64),
    pickupPreferences: (listing.pickupPreferences || '').trim().slice(0, 300),
    reuseApplications: (listing.reuseApplications || []).map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 8),
    hasWhatsapp: Boolean(listing.whatsappNumber),
    status: safeStatus,
    isPublic,
    sellerName: (listing.sellerName || fbUser.displayName || 'VERDORA Supplier').trim().slice(0, 120),
    sellerOrganization: (listing.sellerOrganization || '').trim().slice(0, 140),
    updatedAt: serverTimestamp(),
  };

  try {
    if (!existingSnapData) {
      await setDoc(ref, {
        id: docId,
        sellerId: sanitizeDocId(listing.sellerId || fbUser.uid),
        sellerUid: fbUser.uid,
        sellerVerified: Boolean(listing.sellerVerified),
        currency: 'INR',
        isHidden: false,
        ...basePayload,
        status: 'Active',
        isPublic: true,
        createdAt: serverTimestamp(),
      });
      if (safeStatus !== 'Active') {
        await updateDoc(ref, { status: safeStatus, isPublic, updatedAt: serverTimestamp() });
      }
    } else if (existingSnapData.sellerUid === fbUser.uid) {
      await updateDoc(ref, basePayload);
    }
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, existingSnapData ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  }
}

export async function syncFoodDonationToFirestore(donation: FoodDonation): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  const docId = sanitizeDocId(donation.id);
  const path = `food_donations/${docId}`;
  const ref = doc(db, 'food_donations', docId);
  const safeImageUrl = await compressImageDataUrlForFirestore(donation.imageUrl, 'media:bakery');
  const safeStatus = donation.status || 'Available';
  const isHidden = Boolean(donation.isHidden);
  const isPublic = !isHidden && safeStatus !== 'Cancelled';
  const safePortions = Math.max(1, Math.round(Number(donation.portions)));
  const safeRemaining = Math.max(0, Math.min(safePortions, Math.round(Number(donation.remainingPortions))));

  let existingSnapData: Record<string, unknown> | null = null;
  try {
    const snap = await getDocFromServer(ref);
    if (snap.exists()) existingSnapData = snap.data();
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  }

  const basePayload = {
    title: donation.title.trim().slice(0, 120),
    description: donation.description.trim().slice(0, 1500),
    category: donation.category.trim().slice(0, 80),
    quantity: Number(donation.quantity),
    unit: donation.unit.trim().slice(0, 24),
    portions: safePortions,
    remainingPortions: safeRemaining,
    preparedAt: donation.preparedAt ? String(donation.preparedAt).slice(0, 64) : null,
    availableUntil: String(donation.availableUntil || donation.pickupDeadline).slice(0, 64),
    pickupDeadline: String(donation.pickupDeadline).slice(0, 64),
    storageInfo: (donation.storageInfo || '').trim().slice(0, 300),
    packagingInfo: (donation.packagingInfo || '').trim().slice(0, 300),
    allergens: (donation.allergens || '').trim().slice(0, 300),
    dietaryInfo: (donation.dietaryInfo || '').trim().slice(0, 200),
    location: donation.location.trim().slice(0, 120),
    collectionInstructions: (donation.collectionInstructions || '').trim().slice(0, 400),
    imageUrl: safeImageUrl,
    hasWhatsapp: Boolean(donation.whatsappNumber),
    status: safeStatus,
    isPublic,
    donorName: (donation.donorName || fbUser.displayName || 'VERDORA Donor').trim().slice(0, 120),
    donorOrganization: (donation.donorOrganization || '').trim().slice(0, 140),
    updatedAt: serverTimestamp(),
  };

  try {
    if (!existingSnapData) {
      await setDoc(ref, {
        id: docId,
        donorId: sanitizeDocId(donation.donorId || fbUser.uid),
        donorUid: fbUser.uid,
        donorVerified: Boolean(donation.donorVerified),
        isHidden: false,
        ...basePayload,
        remainingPortions: safePortions,
        status: 'Available',
        isPublic: true,
        createdAt: serverTimestamp(),
      });
      if (safeStatus !== 'Available' || safeRemaining !== safePortions) {
        await updateDoc(ref, {
          status: safeStatus,
          isPublic,
          remainingPortions: safeRemaining,
          updatedAt: serverTimestamp(),
        });
      }
    } else if (existingSnapData.donorUid === fbUser.uid) {
      await updateDoc(ref, basePayload);
    }
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, existingSnapData ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  }
}

export async function syncOilListingToFirestore(lot: OilRecoveryListing): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  const docId = sanitizeDocId(lot.id);
  const path = `oil_recovery_listings/${docId}`;
  const ref = doc(db, 'oil_recovery_listings', docId);
  const safeStatus = lot.collectionStatus || 'Available';
  const isHidden = Boolean(lot.isHidden);
  const isPublic = !isHidden && safeStatus !== 'Cancelled';

  let existingSnapData: Record<string, unknown> | null = null;
  try {
    const snap = await getDocFromServer(ref);
    if (snap.exists()) existingSnapData = snap.data();
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  }

  try {
    if (!existingSnapData) {
      await setDoc(ref, {
        id: docId,
        supplierId: sanitizeDocId(lot.supplierId || fbUser.uid),
        supplierUid: fbUser.uid,
        supplierName: (lot.supplierName || fbUser.displayName || 'VERDORA Supplier').trim().slice(0, 120),
        supplierOrganization: (lot.supplierOrganization || '').trim().slice(0, 140),
        supplierVerified: Boolean(lot.supplierVerified),
        title: lot.title.trim().slice(0, 120),
        oilType: lot.oilType.trim().slice(0, 80),
        volumeLiters: Number(lot.volumeLiters),
        qualityGrade: lot.qualityGrade.trim().slice(0, 60),
        containerType: lot.containerType.trim().slice(0, 80),
        filtrationStatus: lot.filtrationStatus.trim().slice(0, 80),
        pickupWindow: lot.pickupWindow.trim().slice(0, 140),
        location: lot.location.trim().slice(0, 120),
        collectionStatus: 'Available',
        hasWhatsapp: Boolean(lot.whatsappNumber),
        isHidden: false,
        isPublic: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (safeStatus !== 'Available') {
        await updateDoc(ref, {
          collectionStatus: safeStatus,
          isPublic,
          updatedAt: serverTimestamp(),
        });
      }
    } else if (existingSnapData.supplierUid === fbUser.uid) {
      await updateDoc(ref, {
        collectionStatus: safeStatus,
        isPublic,
        hasWhatsapp: Boolean(lot.whatsappNumber),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, existingSnapData ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  }
}

export async function cancelMaterialInFirestore(listingId: string): Promise<MaterialListing | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return null;
  const docId = sanitizeDocId(listingId);
  const path = `material_listings/${docId}`;
  const ref = doc(db, 'material_listings', docId);
  try {
    await updateDoc(ref, {
      status: 'Cancelled',
      isPublic: false,
      updatedAt: serverTimestamp(),
    });
    const snap = await getDocFromServer(ref);
    return snap.exists() ? mapMaterialDoc(snap.id, snap.data()) : null;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
    throw err;
  }
}

export async function cancelFoodDonationInFirestore(donationId: string): Promise<FoodDonation | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return null;
  const docId = sanitizeDocId(donationId);
  const path = `food_donations/${docId}`;
  const ref = doc(db, 'food_donations', docId);
  try {
    await updateDoc(ref, {
      status: 'Cancelled',
      isPublic: false,
      updatedAt: serverTimestamp(),
    });
    const snap = await getDocFromServer(ref);
    return snap.exists() ? mapFoodDoc(snap.id, snap.data()) : null;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
    throw err;
  }
}

export async function fetchSavedFromFirestore(uid: string): Promise<Array<{ itemType: 'material' | 'food'; itemId: string }>> {
  if (!uid) return [];
  const path = `users/${uid}/saved`;
  try {
    const snap = await getDocsFromServer(collection(db, 'users', uid, 'saved'));
    return snap.docs.map((d): { itemType: 'material' | 'food'; itemId: string } => ({
      itemType: d.data().itemType === 'food' ? 'food' : 'material',
      itemId: String(d.data().itemId || ''),
    })).filter((s) => Boolean(s.itemId));
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

export async function toggleSavedInFirestore(
  itemType: 'material' | 'food',
  itemId: string
): Promise<boolean | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return null;
  const savedId = sanitizeDocId(`${itemType}_${itemId}`);
  const path = `users/${fbUser.uid}/saved/${savedId}`;
  const ref = doc(db, 'users', fbUser.uid, 'saved', savedId);
  try {
    const snap = await getDocFromServer(ref);
    if (snap.exists()) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, {
      id: savedId,
      userUid: fbUser.uid,
      itemType,
      itemId: sanitizeDocId(itemId),
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.WRITE, path);
    return null;
  }
}

export async function createMaterialRequestInFirestore(
  listing: MaterialListing,
  buyer: User,
  payload: {
    requestedQuantity: number;
    intendedUse: string;
    preferredDate: string;
    preferredTime: string;
    arrangement: 'Pickup' | 'Delivery Coordination';
    notes?: string;
  },
  existingId?: string
): Promise<string | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified || !listing.sellerUid) return null;
  if (listing.sellerUid === fbUser.uid) return null;

  const id = sanitizeDocId(existingId || `mreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const path = `material_requests/${id}`;
  const ref = doc(db, 'material_requests', id);

  try {
    await setDoc(ref, {
      id,
      listingId: sanitizeDocId(listing.id),
      listingTitle: listing.title.trim().slice(0, 120),
      listingCategory: listing.category.trim().slice(0, 80),
      listingUnit: listing.unit.trim().slice(0, 24),
      listingLocation: listing.location.trim().slice(0, 120),
      sellerId: sanitizeDocId(listing.sellerId || listing.sellerUid),
      sellerUid: sanitizeDocId(listing.sellerUid),
      sellerName: listing.sellerName.trim().slice(0, 120),
      buyerId: sanitizeDocId(buyer.id || fbUser.uid),
      buyerUid: fbUser.uid,
      buyerName: (buyer.name || fbUser.displayName || 'VERDORA Buyer').trim().slice(0, 120),
      requestedQuantity: Number(payload.requestedQuantity),
      intendedUse: payload.intendedUse.trim().slice(0, 300),
      preferredDate: (payload.preferredDate || '').slice(0, 40),
      preferredTime: (payload.preferredTime || '').slice(0, 40),
      arrangement: payload.arrangement,
      notes: (payload.notes || '').trim().slice(0, 600),
      status: 'Request Created',
      handoverConfirmedByBuyer: false,
      handoverConfirmedBySeller: false,
      ...(buyer.whatsappNumber ? { buyerWhatsapp: buyer.whatsappNumber.slice(0, 24) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.CREATE, path);
    return null;
  }
}

export async function createFoodRequestInFirestore(
  donation: FoodDonation,
  recipient: User,
  payload: { requestedPortions: number; preferredTime: string; notes?: string },
  existingId?: string
): Promise<string | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified || !donation.donorUid) return null;
  if (donation.donorUid === fbUser.uid) return null;

  const id = sanitizeDocId(existingId || `freq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const path = `food_requests/${id}`;
  const ref = doc(db, 'food_requests', id);

  try {
    await setDoc(ref, {
      id,
      donationId: sanitizeDocId(donation.id),
      donationTitle: donation.title.trim().slice(0, 120),
      donationLocation: donation.location.trim().slice(0, 120),
      pickupDeadline: String(donation.pickupDeadline).slice(0, 64),
      donorId: sanitizeDocId(donation.donorId || donation.donorUid),
      donorUid: sanitizeDocId(donation.donorUid),
      donorName: donation.donorName.trim().slice(0, 120),
      recipientId: sanitizeDocId(recipient.id || fbUser.uid),
      recipientUid: fbUser.uid,
      recipientName: (recipient.name || fbUser.displayName || 'VERDORA Recipient').trim().slice(0, 120),
      requestedPortions: Math.max(1, Math.round(Number(payload.requestedPortions))),
      preferredTime: (payload.preferredTime || '').trim().slice(0, 80),
      notes: (payload.notes || '').trim().slice(0, 600),
      status: 'Request Received',
      ...(recipient.whatsappNumber ? { recipientWhatsapp: recipient.whatsappNumber.slice(0, 24) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.CREATE, path);
    return null;
  }
}

export async function createOilEnquiryInFirestore(
  listing: OilRecoveryListing,
  buyer: User,
  payload: {
    requestedLiters: number;
    intendedProcessing: string;
    preferredCollectionDate: string;
    notes?: string;
  },
  existingId?: string
): Promise<string | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified || !listing.supplierUid) return null;
  if (listing.supplierUid === fbUser.uid) return null;

  const id = sanitizeDocId(existingId || `oenq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const path = `oil_buyer_enquiries/${id}`;
  const ref = doc(db, 'oil_buyer_enquiries', id);

  try {
    await setDoc(ref, {
      id,
      listingId: sanitizeDocId(listing.id),
      listingTitle: listing.title.trim().slice(0, 120),
      oilType: listing.oilType.trim().slice(0, 80),
      listingLocation: listing.location.trim().slice(0, 120),
      supplierId: sanitizeDocId(listing.supplierId || listing.supplierUid),
      supplierUid: sanitizeDocId(listing.supplierUid),
      supplierName: listing.supplierName.trim().slice(0, 120),
      buyerId: sanitizeDocId(buyer.id || fbUser.uid),
      buyerUid: fbUser.uid,
      buyerName: (buyer.name || fbUser.displayName || 'VERDORA Buyer').trim().slice(0, 120),
      buyerOrganization: (buyer.organization || '').trim().slice(0, 140),
      requestedLiters: Number(payload.requestedLiters),
      intendedProcessing: payload.intendedProcessing.trim().slice(0, 200),
      preferredCollectionDate: (payload.preferredCollectionDate || '').slice(0, 40),
      notes: (payload.notes || '').trim().slice(0, 500),
      processingNotes: '',
      status: 'Pending',
      ...(buyer.whatsappNumber ? { buyerWhatsapp: buyer.whatsappNumber.slice(0, 24) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.CREATE, path);
    return null;
  }
}

export async function fetchWorkspaceRequestsFromFirestore(): Promise<{
  materialRequests: MaterialRequest[];
  foodRequests: FoodRequest[];
  oilEnquiries: OilBuyerEnquiry[];
}> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) {
    return { materialRequests: [], foodRequests: [], oilEnquiries: [] };
  }
  const uid = fbUser.uid;

  const [mBuyer, mSeller, fRecip, fDonor, oBuyer, oSupplier] = await Promise.all([
    getDocsFromServer(query(collection(db, 'material_requests'), where('buyerUid', '==', uid))).catch(() => null),
    getDocsFromServer(query(collection(db, 'material_requests'), where('sellerUid', '==', uid))).catch(() => null),
    getDocsFromServer(query(collection(db, 'food_requests'), where('recipientUid', '==', uid))).catch(() => null),
    getDocsFromServer(query(collection(db, 'food_requests'), where('donorUid', '==', uid))).catch(() => null),
    getDocsFromServer(query(collection(db, 'oil_buyer_enquiries'), where('buyerUid', '==', uid))).catch(() => null),
    getDocsFromServer(query(collection(db, 'oil_buyer_enquiries'), where('supplierUid', '==', uid))).catch(() => null),
  ]);

  const mMap = new Map<string, MaterialRequest>();
  for (const snap of [mBuyer, mSeller]) {
    snap?.docs.forEach((d) => mMap.set(d.id, mapMaterialReqDoc(d.id, d.data())));
  }
  const fMap = new Map<string, FoodRequest>();
  for (const snap of [fRecip, fDonor]) {
    snap?.docs.forEach((d) => fMap.set(d.id, mapFoodReqDoc(d.id, d.data())));
  }
  const oMap = new Map<string, OilBuyerEnquiry>();
  for (const snap of [oBuyer, oSupplier]) {
    snap?.docs.forEach((d) => oMap.set(d.id, mapOilEnquiryDoc(d.id, d.data())));
  }

  return {
    materialRequests: Array.from(mMap.values()),
    foodRequests: Array.from(fMap.values()),
    oilEnquiries: Array.from(oMap.values()),
  };
}

export async function updateMaterialRequestStatusInFirestore(
  reqItem: MaterialRequest,
  nextStatus: string,
  user: User
): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;
  const docId = sanitizeDocId(reqItem.id);
  const path = `material_requests/${docId}`;
  const ref = doc(db, 'material_requests', docId);
  try {
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) return false;
    const isSeller = snap.data().sellerUid === fbUser.uid;
    const patch: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    };
    if (isSeller && user.whatsappNumber) {
      patch.sellerWhatsapp = user.whatsappNumber.slice(0, 24);
    }
    if (!isSeller && nextStatus === 'Completed') {
      patch.handoverConfirmedByBuyer = true;
    }
    if (isSeller && nextStatus === 'Completed') {
      patch.handoverConfirmedBySeller = true;
    }
    await updateDoc(ref, patch);
    return true;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
    return false;
  }
}

export async function updateFoodRequestStatusInFirestore(
  reqItem: FoodRequest,
  nextStatus: string,
  user: User
): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;
  const docId = sanitizeDocId(reqItem.id);
  const path = `food_requests/${docId}`;
  const ref = doc(db, 'food_requests', docId);
  try {
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) return false;
    const data = snap.data();
    const isDonor = data.donorUid === fbUser.uid;
    const patch: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    };
    if (isDonor && user.whatsappNumber) {
      patch.donorWhatsapp = user.whatsappNumber.slice(0, 24);
    }
    await updateDoc(ref, patch);

    if (isDonor && nextStatus === 'Accepted' && data.status === 'Request Received') {
      const donRef = doc(db, 'food_donations', sanitizeDocId(reqItem.donationId));
      const donSnap = await getDocFromServer(donRef);
      if (donSnap.exists() && donSnap.data().donorUid === fbUser.uid) {
        const currentRemaining = Number(donSnap.data().remainingPortions ?? donSnap.data().portions ?? 0);
        const requested = Number(data.requestedPortions ?? reqItem.requestedPortions ?? 0);
        const nextRemaining = Math.max(0, currentRemaining - requested);
        await updateDoc(donRef, {
          remainingPortions: nextRemaining,
          status: nextRemaining === 0 ? 'Accepted' : 'Request Received',
          updatedAt: serverTimestamp(),
        });
      }
    }
    return true;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
    return false;
  }
}

export async function updateOilEnquiryStatusInFirestore(
  enqItem: OilBuyerEnquiry,
  nextStatus: string,
  user: User
): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return false;
  const docId = sanitizeDocId(enqItem.id);
  const path = `oil_buyer_enquiries/${docId}`;
  const ref = doc(db, 'oil_buyer_enquiries', docId);
  try {
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) return false;
    const data = snap.data();
    const isSupplier = data.supplierUid === fbUser.uid;
    const patch: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    };
    if (isSupplier && user.whatsappNumber) {
      patch.supplierWhatsapp = user.whatsappNumber.slice(0, 24);
    }
    await updateDoc(ref, patch);
    return true;
  } catch (err) {
    if (isPermissionDeniedError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
    return false;
  }
}

export async function backfillOwnedSQLiteRecordsToFirestore(params: {
  myMaterials: MaterialListing[];
  myDonations: FoodDonation[];
  myOilListings: OilRecoveryListing[];
}): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  for (const m of params.myMaterials) {
    if (!m.isDemo && !m.isHidden && m.status !== 'Cancelled') {
      const snap = await getDocFromServer(doc(db, 'material_listings', sanitizeDocId(m.id))).catch(() => null);
      if (snap && !snap.exists()) {
        await syncMaterialToFirestore(m).catch(() => {});
      }
    }
  }
  for (const d of params.myDonations) {
    if (!d.isDemo && !d.isHidden && !['Cancelled', 'Expired'].includes(d.status)) {
      const snap = await getDocFromServer(doc(db, 'food_donations', sanitizeDocId(d.id))).catch(() => null);
      if (snap && !snap.exists()) {
        await syncFoodDonationToFirestore(d).catch(() => {});
      }
    }
  }
  for (const o of params.myOilListings) {
    if (!o.isHidden && o.collectionStatus !== 'Cancelled') {
      const snap = await getDocFromServer(doc(db, 'oil_recovery_listings', sanitizeDocId(o.id))).catch(() => null);
      if (snap && !snap.exists()) {
        await syncOilListingToFirestore(o).catch(() => {});
      }
    }
  }
}
