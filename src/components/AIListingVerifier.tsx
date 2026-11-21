import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Droplets,
  FileCheck2,
  History,
  Loader2,
  Package,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  Utensils,
  XCircle,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { resolveImageSrc } from '../data/media';
import { auth } from '../firebase';
import { api } from '../services/api';
import {
  syncFoodDonationToFirestore,
  syncMaterialToFirestore,
  syncOilListingToFirestore,
} from '../services/firestoreSync';
import type {
  Category,
  FoodDonation,
  ListingKind,
  ListingVerificationRecord,
  MaterialListing,
  OilRecoveryListing,
  User,
} from '../types';
import { formatDateTime, formatINR, toLocalDateInputValue, toLocalDateTimeInputValue } from '../utils/format';
import { compressImageDataUrlForFirestore } from '../utils/image';

export interface AIScannerPrefillDraft {
  nonce: number;
  kind: 'material' | 'food';
  title: string;
  category: string;
  description: string;
  imageUrl?: string;
  condition?: string;
  reuseApplications?: string[];
  quantity?: number;
  unit?: string;
  portions?: number;
  storageInfo?: string;
  packagingInfo?: string;
  allergens?: string;
  dietaryInfo?: string;
}

interface AIListingVerifierProps {
  initialType?: ListingKind;
  prefillDraft?: AIScannerPrefillDraft | null;
  user: User | null;
  categories: Category[];
  onRequireAuth: () => void;
  onPublished: (
    kind: ListingKind,
    item: MaterialListing | FoodDonation | OilRecoveryListing
  ) => Promise<void>;
  onToast: (msg: string) => void;
}

const CONDITIONS = ['Unused Surplus', 'Like New', 'Good', 'Fair / Needs Cleaning'];

const PROGRESS_STEPS = [
  'Checking title, category & detail consistency',
  'Scanning active listings & photos for duplicates',
  'Reviewing ₹ INR pricing & safety disclosures',
  'Preparing plain-English authenticity report',
];

export function AIListingVerifier({
  initialType = 'material',
  prefillDraft = null,
  user,
  categories,
  onRequireAuth,
  onPublished,
  onToast,
}: AIListingVerifierProps) {
  const [subMode, setSubMode] = useState<'form' | 'history'>('form');
  const [listingType, setListingType] = useState<ListingKind>(
    prefillDraft?.kind || initialType
  );

  useEffect(() => {
    if (!prefillDraft) {
      setListingType(initialType);
    }
  }, [initialType, prefillDraft]);

  const materialCategories = useMemo(
    () => categories.filter((c) => c.type === 'material' && c.isActive),
    [categories]
  );
  const foodCategories = useMemo(
    () => categories.filter((c) => c.type === 'food' && c.isActive),
    [categories]
  );

  // Common fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState(user?.location || '');
  const [whatsappNumber, setWhatsappNumber] = useState(user?.whatsappNumber || '');
  const [imageUrl, setImageUrl] = useState<string>('');

  // Material fields
  const [matCategory, setMatCategory] = useState(materialCategories[0]?.name || 'Aluminium');
  const [matQuantity, setMatQuantity] = useState('50');
  const [matUnit, setMatUnit] = useState('kg');
  const [matCondition, setMatCondition] = useState('Good');
  const [matPrice, setMatPrice] = useState('');
  const [matAvailableUntil, setMatAvailableUntil] = useState(
    toLocalDateInputValue(new Date(Date.now() + 21 * 86400_000))
  );
  const [matPickupPrefs, setMatPickupPrefs] = useState('Weekday daytime pickup preferred');
  const [matReuseText, setMatReuseText] = useState('');

  // Food fields
  const [foodCategory, setFoodCategory] = useState(foodCategories[0]?.name || 'Bakery items');
  const [foodQuantity, setFoodQuantity] = useState('12');
  const [foodUnit, setFoodUnit] = useState('kg');
  const [foodPortions, setFoodPortions] = useState('25');
  const [foodPreparedAt, setFoodPreparedAt] = useState(toLocalDateTimeInputValue(new Date()));
  const [foodPickupDeadline, setFoodPickupDeadline] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 5 * 3600_000))
  );
  const [foodStorage, setFoodStorage] = useState('');
  const [foodPackaging, setFoodPackaging] = useState('');
  const [foodAllergens, setFoodAllergens] = useState('');
  const [foodDietary, setFoodDietary] = useState('Vegetarian');
  const [foodInstructions, setFoodInstructions] = useState('');

  // Oil fields
  const [oilType, setOilType] = useState('Used Cooking Oil (Sunflower / Vegetable)');
  const [oilVolume, setOilVolume] = useState('120');
  const [oilGrade, setOilGrade] = useState('Filtered Commercial Grade');
  const [oilContainer, setOilContainer] = useState('Sealed HDPE 200L Drum');
  const [oilFiltration, setOilFiltration] = useState('Settled & Mesh-Filtered');
  const [oilPickupWindow, setOilPickupWindow] = useState('Weekdays 08:00–16:00');

  // Evidence fields
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [evidenceImageUrl, setEvidenceImageUrl] = useState<string | null>(null);

  // Verification workflow state
  const [verifying, setVerifying] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [autoFilling, setAutoFilling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verification, setVerification] = useState<ListingVerificationRecord | null>(null);
  const [isDirtySinceVerify, setIsDirtySinceVerify] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [requestingReview, setRequestingReview] = useState(false);
  const [publishedSuccess, setPublishedSuccess] = useState<{
    kind: ListingKind;
    item: MaterialListing | FoodDonation | OilRecoveryListing;
  } | null>(null);

  // History state
  const [history, setHistory] = useState<ListingVerificationRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [publishingHistoryId, setPublishingHistoryId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setLocation((prev) => prev || user.location || '');
      setWhatsappNumber((prev) => prev || user.whatsappNumber || '');
    }
  }, [user]);

  useEffect(() => {
    if (!prefillDraft) return;
    setSubMode('form');
    setListingType(prefillDraft.kind);
    setTitle(prefillDraft.title || '');
    setDescription(prefillDraft.description || '');
    if (prefillDraft.imageUrl) {
      setImageUrl(prefillDraft.imageUrl);
    }
    if (prefillDraft.kind === 'material') {
      if (prefillDraft.category) setMatCategory(prefillDraft.category);
      if (prefillDraft.condition) {
        const lowerCond = prefillDraft.condition.toLowerCase();
        const matchedCond =
          CONDITIONS.find((c) => lowerCond.includes(c.toLowerCase())) ||
          (lowerCond.includes('new') || lowerCond.includes('unused')
            ? 'Unused Surplus'
            : lowerCond.includes('fair') || lowerCond.includes('clean')
              ? 'Fair / Needs Cleaning'
              : 'Good');
        setMatCondition(matchedCond);
      }
      if (prefillDraft.reuseApplications && prefillDraft.reuseApplications.length > 0) {
        setMatReuseText(prefillDraft.reuseApplications.join(', '));
      }
    } else if (prefillDraft.kind === 'food') {
      if (prefillDraft.category) setFoodCategory(prefillDraft.category);
      if (prefillDraft.quantity && prefillDraft.quantity > 0) {
        setFoodQuantity(String(prefillDraft.quantity));
      }
      if (prefillDraft.unit) setFoodUnit(prefillDraft.unit);
      if (prefillDraft.portions && prefillDraft.portions > 0) {
        setFoodPortions(String(prefillDraft.portions));
      }
      if (prefillDraft.storageInfo) setFoodStorage(prefillDraft.storageInfo);
      if (prefillDraft.packagingInfo) setFoodPackaging(prefillDraft.packagingInfo);
      if (prefillDraft.allergens) setFoodAllergens(prefillDraft.allergens);
      if (prefillDraft.dietaryInfo) setFoodDietary(prefillDraft.dietaryInfo);
    }
    setVerification(null);
    setIsDirtySinceVerify(false);
    setErrorMsg(null);
    setPublishedSuccess(null);
  }, [prefillDraft]);

  useEffect(() => {
    if (!verifying) {
      setProgressStep(0);
      return;
    }
    const timer = setInterval(() => {
      setProgressStep((prev) => (prev < PROGRESS_STEPS.length - 1 ? prev + 1 : prev));
    }, 900);
    return () => clearInterval(timer);
  }, [verifying]);

  const loadHistory = useCallback(async () => {
    if (!user) {
      setHistory([]);
      return;
    }
    setLoadingHistory(true);
    try {
      const res = await api.getMyVerifications();
      setHistory(res.verifications);
    } catch {
      // ignore transient error
    } finally {
      setLoadingHistory(false);
    }
  }, [user]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const markDirty = () => {
    if (verification) {
      setIsDirtySinceVerify(true);
    }
    setPublishedSuccess(null);
  };

  const handleSwitchType = (next: ListingKind) => {
    setListingType(next);
    setVerification(null);
    setIsDirtySinceVerify(false);
    setErrorMsg(null);
    setPublishedSuccess(null);
  };

  const handleImageFile = (
    file: File | undefined,
    onLoaded: (dataUrl: string) => void
  ) => {
    if (!file) return;
    setErrorMsg(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image exceeds the 5 MB upload limit.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onLoaded(reader.result);
        markDirty();
      }
    };
    reader.onerror = () => setErrorMsg('Could not read the selected image file.');
    reader.readAsDataURL(file);
  };

  const handleAutoFillFromPhoto = async () => {
    if (listingType === 'oil') return;
    if (!imageUrl && description.trim().length < 5) {
      setErrorMsg('Upload an item photo or write a short note in the description first so Verdora AI can help draft details.');
      return;
    }
    setErrorMsg(null);
    setAutoFilling(true);
    try {
      if (listingType === 'material') {
        const res = await api.scanMaterial(imageUrl || null, description.trim() || title.trim());
        setTitle(res.suggestedTitle);
        setMatCategory(res.suggestedCategory);
        setDescription(res.suggestedDescription);
        setMatReuseText(res.reuseApplications.join(', '));
        markDirty();
        onToast('Draft fields suggested from your photo. Review and click "Verify Listing with Verdora AI".');
      } else {
        const res = await api.scanFood(imageUrl || null, description.trim() || title.trim());
        setTitle(res.suggestedTitle);
        setFoodCategory(res.suggestedCategory);
        setDescription(res.suggestedDescription);
        setFoodQuantity(String(res.estimatedQuantity));
        setFoodUnit(res.estimatedUnit);
        setFoodPortions(String(res.estimatedPortions));
        setFoodStorage(res.storageAdvice);
        setFoodPackaging(res.packagingAdvice);
        setFoodAllergens(res.potentialAllergens);
        setFoodDietary(res.dietaryTags);
        markDirty();
        onToast('Food donation fields suggested. Review accuracy and verify with Verdora AI.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to auto-fill from photo right now.');
    } finally {
      setAutoFilling(false);
    }
  };

  const buildPayload = async (): Promise<Record<string, unknown>> => {
    if (listingType === 'material') {
      const parsedDate = matAvailableUntil ? new Date(`${matAvailableUntil}T23:59:59`) : null;
      if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
        throw new Error('Please select a valid Available Until date.');
      }
      const optimizedImg = imageUrl
        ? await compressImageDataUrlForFirestore(imageUrl, 'none')
        : '';
      return {
        title: title.trim(),
        category: matCategory,
        description: description.trim(),
        quantity: Number(matQuantity),
        unit: matUnit.trim(),
        condition: matCondition,
        location: location.trim(),
        indicativePrice: matPrice.trim() ? Number(matPrice) : null,
        availableUntil: parsedDate.toISOString(),
        pickupPreferences: matPickupPrefs.trim(),
        reuseApplications: matReuseText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        whatsappNumber: whatsappNumber.trim() || null,
        imageUrl: optimizedImg,
      };
    }

    if (listingType === 'food') {
      const parsedDeadline = foodPickupDeadline ? new Date(foodPickupDeadline) : null;
      if (!parsedDeadline || Number.isNaN(parsedDeadline.getTime())) {
        throw new Error('Please choose a valid pickup deadline.');
      }
      if (parsedDeadline.getTime() <= Date.now()) {
        throw new Error('Pickup deadline must be in the future.');
      }
      const parsedPrepared = foodPreparedAt.trim() ? new Date(foodPreparedAt) : null;
      if (parsedPrepared && Number.isNaN(parsedPrepared.getTime())) {
        throw new Error('Preparation date/time is invalid.');
      }
      const optimizedImg = imageUrl
        ? await compressImageDataUrlForFirestore(imageUrl, 'none')
        : '';
      return {
        title: title.trim(),
        category: foodCategory,
        description: description.trim(),
        quantity: Number(foodQuantity),
        unit: foodUnit.trim(),
        portions: Math.round(Number(foodPortions)),
        preparedAt: parsedPrepared ? parsedPrepared.toISOString() : null,
        pickupDeadline: parsedDeadline.toISOString(),
        availableUntil: parsedDeadline.toISOString(),
        storageInfo: foodStorage.trim(),
        packagingInfo: foodPackaging.trim(),
        allergens: foodAllergens.trim(),
        dietaryInfo: foodDietary.trim(),
        location: location.trim(),
        collectionInstructions: foodInstructions.trim(),
        whatsappNumber: whatsappNumber.trim() || null,
        imageUrl: optimizedImg,
      };
    }

    return {
      title: title.trim(),
      oilType: oilType.trim(),
      volumeLiters: Number(oilVolume),
      qualityGrade: oilGrade.trim(),
      containerType: oilContainer.trim(),
      filtrationStatus: oilFiltration.trim(),
      pickupWindow: oilPickupWindow.trim(),
      location: location.trim(),
      whatsappNumber: whatsappNumber.trim() || null,
    };
  };

  const handleVerifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    if (verifying) return;
    setErrorMsg(null);
    setPublishedSuccess(null);
    setVerifying(true);
    try {
      const payload = await buildPayload();
      const compressedEvidence = evidenceImageUrl
        ? await compressImageDataUrlForFirestore(evidenceImageUrl, '')
        : null;
      const res = await api.verifyListing({
        listingType,
        payload,
        evidenceNotes: evidenceNotes.trim(),
        evidenceImageUrl: compressedEvidence || null,
      });
      setVerification(res.verification);
      setIsDirtySinceVerify(false);
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to complete AI listing verification.');
    } finally {
      setVerifying(false);
    }
  };

  const publishVerificationRecord = async (record: ListingVerificationRecord) => {
    if (!user) {
      onRequireAuth();
      return;
    }
    const payloadWithVerification = {
      ...record.payload,
      verificationId: record.id,
    };
    if (record.listingType === 'material') {
      const res = await api.createMaterial(payloadWithVerification);
      const saved: MaterialListing = {
        ...res.listing,
        sellerUid: res.listing.sellerUid || auth.currentUser?.uid || user.firebaseUid || undefined,
      };
      await syncMaterialToFirestore(saved).catch(() => {});
      await onPublished('material', saved);
      return saved;
    }
    if (record.listingType === 'food') {
      const res = await api.createFoodDonation(payloadWithVerification);
      const saved: FoodDonation = {
        ...res.donation,
        donorUid: res.donation.donorUid || auth.currentUser?.uid || user.firebaseUid || undefined,
      };
      await syncFoodDonationToFirestore(saved).catch(() => {});
      await onPublished('food', saved);
      return saved;
    }
    const res = await api.createOilListing(payloadWithVerification);
    const saved: OilRecoveryListing = {
      ...res.listing,
      supplierUid: res.listing.supplierUid || auth.currentUser?.uid || user.firebaseUid || undefined,
    };
    await syncOilListingToFirestore(saved).catch(() => {});
    await onPublished('oil', saved);
    return saved;
  };

  const handlePublishCurrent = async () => {
    if (!verification || !verification.canPublish || isDirtySinceVerify || publishing) return;
    setErrorMsg(null);
    setPublishing(true);
    try {
      const saved = await publishVerificationRecord(verification);
      if (!saved) return;
      setPublishedSuccess({ kind: verification.listingType, item: saved });
      setVerification(null);
      setTitle('');
      setDescription('');
      setImageUrl('');
      setEvidenceNotes('');
      setEvidenceImageUrl(null);
      await loadHistory();
      onToast('Verified listing published live on VERDORA!');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not publish verified listing.');
    } finally {
      setPublishing(false);
    }
  };

  const handleRequestHumanReview = async () => {
    if (!verification || requestingReview) return;
    setErrorMsg(null);
    setRequestingReview(true);
    try {
      const compressedEvidence = evidenceImageUrl
        ? await compressImageDataUrlForFirestore(evidenceImageUrl, '')
        : null;
      const res = await api.requestVerificationHumanReview(verification.id, {
        evidenceNotes: evidenceNotes.trim(),
        evidenceImageUrl: compressedEvidence || null,
      });
      setVerification(res.verification);
      await loadHistory();
      onToast('Submitted for human administrator review. You will be notified once reviewed.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not request human review.');
    } finally {
      setRequestingReview(false);
    }
  };

  const handlePublishFromHistory = async (record: ListingVerificationRecord) => {
    if (!record.canPublish || publishingHistoryId) return;
    setPublishingHistoryId(record.id);
    setErrorMsg(null);
    try {
      await publishVerificationRecord(record);
      await loadHistory();
      onToast('Approved listing published live on VERDORA!');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not publish approved listing.');
    } finally {
      setPublishingHistoryId(null);
    }
  };

  const statusMeta = (v: ListingVerificationRecord) => {
    if (v.humanReviewStatus === 'approved') {
      return {
        label: 'APPROVED FOR PUBLISHING',
        badgeClass: 'border-[#7CE0A3]/40 bg-[#143023] text-[#7CE0A3]',
        borderClass: 'border-[#7CE0A3]/35',
        icon: ShieldCheck,
      };
    }
    if (v.status === 'VERIFIED') {
      return {
        label: 'VERIFIED',
        badgeClass: 'border-[#7CE0A3]/40 bg-[#143023] text-[#7CE0A3]',
        borderClass: 'border-[#7CE0A3]/35',
        icon: ShieldCheck,
      };
    }
    if (v.status === 'NEEDS_REVIEW') {
      return {
        label: v.humanReviewStatus === 'pending' ? 'NEEDS REVIEW · HUMAN REVIEW PENDING' : 'NEEDS REVIEW',
        badgeClass: 'border-[#D99B38]/40 bg-[#2E230F] text-[#FAD089]',
        borderClass: 'border-[#D99B38]/35',
        icon: AlertTriangle,
      };
    }
    return {
      label: 'HIGH RISK · PUBLISHING BLOCKED',
      badgeClass: 'border-[#E06C75]/45 bg-[#361619] text-[#FFB3B8]',
      borderClass: 'border-[#E06C75]/40',
      icon: ShieldAlert,
    };
  };

  return (
    <div className="mt-8 space-y-6">
      {/* Top Action Strip: New Verification vs My History */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#172620] text-[#93C9A3]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-[#F4F7F4]">
              AI-Powered Listing Verification
            </h2>
            <p className="text-xs text-[#C8D6CD]">
              Every new Marketplace, Food Rescue, and Cooking Oil listing is analyzed before publishing.
            </p>
          </div>
        </div>

        <div className="inline-flex rounded-xl border border-[#A9B78D]/20 bg-[#0D1612] p-1">
          <button
            type="button"
            onClick={() => setSubMode('form')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold cursor-pointer ${
              subMode === 'form' ? 'bg-[#2B7A58] text-white' : 'text-[#C8D6CD] hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Verify New Listing</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSubMode('history');
              void loadHistory();
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold cursor-pointer ${
              subMode === 'history' ? 'bg-[#2B7A58] text-white' : 'text-[#C8D6CD] hover:text-white'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>My Verifications ({history.length})</span>
          </button>
        </div>
      </div>

      {!user && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-[#93C9A3]/30 bg-[#14241D] p-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
              Sign in to verify and publish listings
            </h3>
            <p className="mt-1 text-xs text-[#D2DDD6]">
              Verdora binds every AI verification check to your authenticated account for safety and accountability.
            </p>
          </div>
          <button
            type="button"
            onClick={onRequireAuth}
            className="rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer whitespace-nowrap"
          >
            Sign In with Google
          </button>
        </div>
      )}

      {publishedSuccess && (
        <div className="rounded-2xl border border-[#7CE0A3]/35 bg-[#142B20] p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#7CE0A3]" />
            <div>
              <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                Listing Published Successfully!
              </h3>
              <p className="mt-0.5 text-xs text-[#D2DDD6]">
                "{publishedSuccess.item.title}" passed Verdora AI verification and is now visible to the community.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPublishedSuccess(null)}
            className="rounded-lg border border-[#93C9A3]/35 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer self-start"
          >
            Verify Another Listing
          </button>
        </div>
      )}

      {subMode === 'history' ? (
        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-xl font-semibold text-[#F4F7F4]">
                Your Verification History
              </h3>
              <p className="text-xs text-[#C8D6CD]">
                Track AI screening results, pending human reviews, and publish approved listings.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs text-[#FFB3B8]">
              {errorMsg}
            </div>
          )}

          {loadingHistory ? (
            <div className="py-10 text-center text-xs text-[#C8D6CD]">Loading verification records...</div>
          ) : history.length === 0 ? (
            <div className="rounded-xl border border-[#A9B78D]/15 bg-[#0D1612] p-10 text-center text-xs text-[#C8D6CD]">
              You have not submitted any listings for AI verification yet.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => {
                const meta = statusMeta(item);
                const Icon = meta.icon;
                const payloadTitle = String(item.payload.title || 'Untitled Listing');
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border ${meta.borderClass} bg-[#0D1612] p-4 space-y-2.5`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold ${meta.badgeClass}`}>
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                          </span>
                          <span className="uppercase text-[11px] font-semibold text-[#9BB0A3]">
                            {item.listingType}
                          </span>
                          <span className="text-[#9BB0A3]">{formatDateTime(item.createdAt)}</span>
                        </div>
                        <h4 className="mt-1.5 font-display text-lg font-semibold text-[#F4F7F4]">
                          {payloadTitle}
                        </h4>
                        <p className="mt-1 text-xs text-[#D2DDD6]">{item.summary}</p>
                        {item.humanReviewNotes && (
                          <p className="mt-1 text-xs text-[#93C9A3]">
                            Reviewer note: {item.humanReviewNotes}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {item.publishedListingId ? (
                          <span className="inline-flex items-center gap-1 rounded-lg border border-[#7CE0A3]/30 bg-[#143023] px-3 py-1.5 text-xs font-semibold text-[#7CE0A3]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Published
                          </span>
                        ) : item.canPublish ? (
                          <button
                            type="button"
                            disabled={publishingHistoryId === item.id}
                            onClick={() => void handlePublishFromHistory(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-50 cursor-pointer"
                          >
                            {publishingHistoryId === item.id ? 'Publishing...' : 'Publish Approved Listing'}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="text-xs text-[#9BB0A3]">
                            {item.humanReviewStatus === 'pending'
                              ? 'Awaiting Admin Review'
                              : item.status === 'HIGH_RISK'
                                ? 'Blocked'
                                : 'Not Published'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* LEFT: GUIDED SUBMISSION FORM */}
          <form onSubmit={handleVerifySubmit} className="lg:col-span-7 space-y-5">
            <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-5">
              {/* Listing Type Selector */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                  Step 1 · Choose Listing Category
                </label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 rounded-xl border border-[#A9B78D]/20 bg-[#0D1612] p-1">
                  <button
                    type="button"
                    onClick={() => handleSwitchType('material')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${
                      listingType === 'material' ? 'bg-[#2B7A58] text-white' : 'text-[#C8D6CD] hover:text-white'
                    }`}
                  >
                    <Package className="h-3.5 w-3.5" />
                    <span>Material Marketplace</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchType('food')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${
                      listingType === 'food' ? 'bg-[#2B7A58] text-white' : 'text-[#C8D6CD] hover:text-white'
                    }`}
                  >
                    <Utensils className="h-3.5 w-3.5" />
                    <span>Food Rescue</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchType('oil')}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${
                      listingType === 'oil' ? 'bg-[#2B7A58] text-white' : 'text-[#C8D6CD] hover:text-white'
                    }`}
                  >
                    <Droplets className="h-3.5 w-3.5" />
                    <span>Cooking Oil Lot</span>
                  </button>
                </div>
              </div>

              {/* Photo Upload + AI Draft Helper (for Material & Food) */}
              {listingType !== 'oil' && (
                <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-[#F4F7F4]">
                        Step 2 · Product / Item Photograph
                      </div>
                      <p className="text-[11px] text-[#9BB0A3]">
                        Upload a clear photo of the actual item (JPEG, PNG, WebP up to 5 MB). Verdora AI verifies visual consistency and checks for reused images.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={autoFilling}
                      onClick={() => void handleAutoFillFromPhoto()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#93C9A3]/35 bg-[#172620] px-3 py-1.5 text-[11px] font-semibold text-[#93C9A3] hover:bg-[#21362D] disabled:opacity-50 cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>{autoFilling ? 'Drafting...' : 'AI Auto-Fill from Photo'}</span>
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    {resolveImageSrc(imageUrl) ? (
                      <div className="relative h-24 w-36 shrink-0 overflow-hidden rounded-lg border border-[#A9B78D]/25">
                        <img
                          src={resolveImageSrc(imageUrl)!}
                          alt="Listing photo preview"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-24 w-36 shrink-0 items-center justify-center rounded-lg border border-dashed border-[#A9B78D]/30 bg-[#111C17] text-[11px] text-[#9BB0A3]">
                        No photo yet
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label className="inline-flex items-center gap-2 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3.5 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer self-start">
                        <Upload className="h-3.5 w-3.5 text-[#93C9A3]" />
                        <span>{imageUrl ? 'Replace Photo' : 'Upload Item Photo'}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = '';
                            handleImageFile(f, setImageUrl);
                          }}
                        />
                      </label>
                      {imageUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setImageUrl('');
                            markDirty();
                          }}
                          className="text-left text-xs text-[#FCA5A5] hover:underline cursor-pointer"
                        >
                          Remove photo
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Core Listing Details */}
              <div className="space-y-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                  Step {listingType === 'oil' ? '2' : '3'} · Listing Details
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Listing Title *</label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      markDirty();
                    }}
                    placeholder={
                      listingType === 'material'
                        ? 'e.g., Clean 6061 Aluminium Sheet Offcuts (2mm)'
                        : listingType === 'food'
                          ? 'e.g., Fresh Vegetable Pulao & Dal — 30 Sealed Portions'
                          : 'e.g., Filtered Commercial Kitchen Sunflower Oil — 2 Drums'
                    }
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                  />
                </div>

                {listingType === 'material' && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Category *</label>
                        <select
                          value={matCategory}
                          onChange={(e) => {
                            setMatCategory(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        >
                          {materialCategories.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Quantity *</label>
                        <input
                          type="number"
                          required
                          min={0.1}
                          step="any"
                          value={matQuantity}
                          onChange={(e) => {
                            setMatQuantity(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Unit *</label>
                        <input
                          type="text"
                          required
                          value={matUnit}
                          onChange={(e) => {
                            setMatUnit(e.target.value);
                            markDirty();
                          }}
                          placeholder="kg, pallets, sheets"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Condition *</label>
                        <select
                          value={matCondition}
                          onChange={(e) => {
                            setMatCondition(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">
                          Indicative Price (₹ INR)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={matPrice}
                          onChange={(e) => {
                            setMatPrice(e.target.value);
                            markDirty();
                          }}
                          placeholder="0 for free pickup"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] tabular-nums focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Available Until *</label>
                        <input
                          type="date"
                          required
                          value={matAvailableUntil}
                          onChange={(e) => {
                            setMatAvailableUntil(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">Description *</label>
                      <textarea
                        required
                        minLength={10}
                        rows={3}
                        value={description}
                        onChange={(e) => {
                          setDescription(e.target.value);
                          markDirty();
                        }}
                        placeholder="Describe dimensions, cleanliness, source batch, and storage condition..."
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Pickup Preferences</label>
                        <input
                          type="text"
                          value={matPickupPrefs}
                          onChange={(e) => {
                            setMatPickupPrefs(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">
                          Reuse Applications (Comma-separated)
                        </label>
                        <input
                          type="text"
                          value={matReuseText}
                          onChange={(e) => {
                            setMatReuseText(e.target.value);
                            markDirty();
                          }}
                          placeholder="Fabrication, frames, DIY"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                        />
                      </div>
                    </div>
                  </>
                )}

                {listingType === 'food' && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Food Category *</label>
                        <select
                          value={foodCategory}
                          onChange={(e) => {
                            setFoodCategory(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        >
                          {foodCategories.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Quantity *</label>
                        <div className="mt-1 flex gap-1">
                          <input
                            type="number"
                            required
                            min={0.1}
                            step="any"
                            value={foodQuantity}
                            onChange={(e) => {
                              setFoodQuantity(e.target.value);
                              markDirty();
                            }}
                            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-2.5 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                          />
                          <input
                            type="text"
                            required
                            value={foodUnit}
                            onChange={(e) => {
                              setFoodUnit(e.target.value);
                              markDirty();
                            }}
                            className="w-14 rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-2 py-2 text-sm text-[#F4F7F4] focus-ring"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Portions *</label>
                        <input
                          type="number"
                          required
                          min={1}
                          step={1}
                          value={foodPortions}
                          onChange={(e) => {
                            setFoodPortions(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">Description *</label>
                      <textarea
                        required
                        minLength={10}
                        rows={2}
                        value={description}
                        onChange={(e) => {
                          setDescription(e.target.value);
                          markDirty();
                        }}
                        placeholder="Describe dishes, freshness, preparation source, and serving suitability..."
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Prepared At</label>
                        <input
                          type="datetime-local"
                          value={foodPreparedAt}
                          onChange={(e) => {
                            setFoodPreparedAt(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Pickup Deadline *</label>
                        <input
                          type="datetime-local"
                          required
                          value={foodPickupDeadline}
                          onChange={(e) => {
                            setFoodPickupDeadline(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Storage Conditions *</label>
                        <input
                          type="text"
                          required
                          value={foodStorage}
                          onChange={(e) => {
                            setFoodStorage(e.target.value);
                            markDirty();
                          }}
                          placeholder="e.g., Kept hot in insulated vessels / 4°C chiller"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Packaging Info *</label>
                        <input
                          type="text"
                          required
                          value={foodPackaging}
                          onChange={(e) => {
                            setFoodPackaging(e.target.value);
                            markDirty();
                          }}
                          placeholder="e.g., Sealed food-grade trays"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Known Allergens *</label>
                        <input
                          type="text"
                          required
                          value={foodAllergens}
                          onChange={(e) => {
                            setFoodAllergens(e.target.value);
                            markDirty();
                          }}
                          placeholder="e.g., Dairy, Gluten, Nuts (or None known)"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Dietary Info</label>
                        <input
                          type="text"
                          value={foodDietary}
                          onChange={(e) => {
                            setFoodDietary(e.target.value);
                            markDirty();
                          }}
                          placeholder="Vegetarian, Vegan, Jain"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">Collection Instructions</label>
                      <input
                        type="text"
                        value={foodInstructions}
                        onChange={(e) => {
                          setFoodInstructions(e.target.value);
                          markDirty();
                        }}
                        placeholder="Kitchen gate, container return note..."
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>
                  </>
                )}

                {listingType === 'oil' && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Oil Type *</label>
                        <input
                          type="text"
                          required
                          value={oilType}
                          onChange={(e) => {
                            setOilType(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Volume (Liters) *</label>
                        <input
                          type="number"
                          required
                          min={1}
                          step="any"
                          value={oilVolume}
                          onChange={(e) => {
                            setOilVolume(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Quality Grade *</label>
                        <input
                          type="text"
                          required
                          value={oilGrade}
                          onChange={(e) => {
                            setOilGrade(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Container Type *</label>
                        <input
                          type="text"
                          required
                          value={oilContainer}
                          onChange={(e) => {
                            setOilContainer(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Filtration Status *</label>
                        <input
                          type="text"
                          required
                          value={oilFiltration}
                          onChange={(e) => {
                            setOilFiltration(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Pickup Window *</label>
                        <input
                          type="text"
                          required
                          value={oilPickupWindow}
                          onChange={(e) => {
                            setOilPickupWindow(e.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Location & Contact */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[#D2DDD6]">
                      City / Approximate Area *
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={location}
                      onChange={(e) => {
                        setLocation(e.target.value);
                        markDirty();
                      }}
                      placeholder="e.g., Bengaluru, Indiranagar"
                      className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#D2DDD6]">
                      WhatsApp Contact (Optional)
                    </label>
                    <input
                      type="tel"
                      value={whatsappNumber}
                      onChange={(e) => {
                        setWhatsappNumber(e.target.value);
                        markDirty();
                      }}
                      placeholder="+919876543210"
                      className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                    />
                  </div>
                </div>
              </div>

              {/* Seller / Source Information + Supporting Evidence */}
              <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#93C9A3]">
                    Seller / Source & Supporting Evidence
                  </span>
                  {user && (
                    <span className="text-[#C8D6CD]">
                      {user.name}
                      {user.organization ? ` · ${user.organization}` : ''} ({user.verificationStatus})
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">
                    Source Details / Supporting Evidence Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={evidenceNotes}
                    onChange={(e) => setEvidenceNotes(e.target.value)}
                    placeholder="e.g., Workshop invoice reference, kitchen batch log, FSSAI / GST reference, or warehouse origin..."
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#111C17] px-3 py-2 text-xs text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer">
                    <FileCheck2 className="h-3.5 w-3.5 text-[#93C9A3]" />
                    <span>{evidenceImageUrl ? 'Replace Evidence Photo' : 'Attach Supporting Proof (Optional)'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.currentTarget.value = '';
                        handleImageFile(f, setEvidenceImageUrl);
                      }}
                    />
                  </label>
                  {evidenceImageUrl && (
                    <span className="inline-flex items-center gap-2 text-xs text-[#93C9A3]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Evidence attached
                      <button
                        type="button"
                        onClick={() => setEvidenceImageUrl(null)}
                        className="text-[#FCA5A5] hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </div>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs text-[#FFB3B8]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={verifying}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-3 text-sm font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer focus-ring"
              >
                {verifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Analyzing Listing with Verdora AI...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>
                      {verification ? 'Re-run Verdora AI Verification' : 'Verify Listing with Verdora AI'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* RIGHT: VERIFICATION PROGRESS & RESULT PANEL */}
          <div className="lg:col-span-5 space-y-5">
            {verifying ? (
              <div className="rounded-2xl border border-[#93C9A3]/30 bg-[#111C17] p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-[#93C9A3]" />
                  <div>
                    <h3 className="font-display text-xl font-semibold text-[#F4F7F4]">
                      Verdora AI Verification in Progress
                    </h3>
                    <p className="text-xs text-[#C8D6CD]">
                      Screening details, duplicates, photos, and ₹ INR pricing...
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  {PROGRESS_STEPS.map((label, idx) => {
                    const done = idx < progressStep;
                    const active = idx === progressStep;
                    return (
                      <div
                        key={label}
                        className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
                          done
                            ? 'border-[#7CE0A3]/30 bg-[#142B20] text-[#7CE0A3]'
                            : active
                              ? 'border-[#93C9A3]/40 bg-[#172620] text-[#F4F7F4]'
                              : 'border-[#A9B78D]/12 bg-[#0D1612] text-[#9BB0A3]'
                        }`}
                      >
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                        ) : active ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#93C9A3]" />
                        ) : (
                          <Clock className="h-4 w-4 shrink-0" />
                        )}
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : !verification ? (
              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 sm:p-8 space-y-5">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#172620] text-[#93C9A3]">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-2xl font-semibold text-[#F4F7F4]">
                    How Verdora AI Verification Works
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#C8D6CD]">
                    Complete your listing on the left and click{' '}
                    <strong className="text-[#F4F7F4]">Verify Listing with Verdora AI</strong>.
                    You will receive one of three clear outcomes:
                  </p>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="rounded-xl border border-[#7CE0A3]/25 bg-[#14261E] p-3.5">
                    <div className="font-semibold text-[#7CE0A3]">VERIFIED</div>
                    <p className="mt-1 text-[#D2DDD6]">
                      No significant suspicious indicators found. You can publish immediately.
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#D99B38]/30 bg-[#261E10] p-3.5">
                    <div className="font-semibold text-[#FAD089]">NEEDS REVIEW</div>
                    <p className="mt-1 text-[#D2DDD6]">
                      Some information needs clarification or supporting proof. Add evidence to
                      re-verify or submit for human admin review.
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#E06C75]/35 bg-[#2E1417] p-3.5">
                    <div className="font-semibold text-[#FFB3B8]">HIGH RISK</div>
                    <p className="mt-1 text-[#D2DDD6]">
                      Significant suspicious or duplicate indicators detected. Publishing stays
                      blocked until the concerns are resolved.
                    </p>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-[#9BB0A3]">
                  Note: AI review helps screen common authenticity and duplicate risks, but never
                  guarantees that a listing is genuine.
                </p>
              </div>
            ) : (
              (() => {
                const meta = statusMeta(verification);
                const StatusIcon = meta.icon;
                return (
                  <div className={`rounded-2xl border ${meta.borderClass} bg-[#111C17] p-6 space-y-5`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#A9B78D]/15 pb-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${meta.badgeClass}`}>
                        <StatusIcon className="h-4 w-4" />
                        <span>{meta.label}</span>
                      </span>
                      <span className="text-[11px] text-[#9BB0A3]">
                        Checked {formatDateTime(verification.createdAt)}
                      </span>
                    </div>

                    {isDirtySinceVerify && (
                      <div className="rounded-xl border border-[#D99B38]/35 bg-[#2E230F] px-3.5 py-2.5 text-xs text-[#FAD089]">
                        You edited listing details after verification. Please click{' '}
                        <strong>Re-run Verdora AI Verification</strong> before publishing.
                      </div>
                    )}

                    <div>
                      <h3 className="font-display text-xl font-semibold text-[#F4F7F4]">
                        Verification Summary
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[#D2DDD6]">
                        {verification.summary}
                      </p>
                    </div>

                    {verification.reasons.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wider text-[#9BB0A3]">
                          Key Findings
                        </div>
                        <ul className="space-y-1.5 text-xs text-[#F4F7F4]">
                          {verification.reasons.map((reason) => (
                            <li key={reason} className="flex items-start gap-2">
                              {verification.status === 'HIGH_RISK' ? (
                                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FCA5A5]" />
                              ) : (
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FAD089]" />
                              )}
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {verification.duplicateMatches.length > 0 && (
                      <div className="rounded-xl border border-[#E06C75]/30 bg-[#2B1316] p-3.5 space-y-2">
                        <div className="text-xs font-semibold text-[#FFB3B8]">
                          Similar Active Listings Found
                        </div>
                        {verification.duplicateMatches.map((dup) => (
                          <div key={dup.id} className="text-xs text-[#F4F7F4]">
                            <strong>{dup.title}</strong> ({dup.location}) — {dup.reason} ({dup.similarityScore}% match)
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Detailed Check Breakdown */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-[#9BB0A3]">
                        Authenticity Checks
                      </div>
                      <div className="space-y-2">
                        {verification.checks.map((chk) => (
                          <div
                            key={`${chk.area}-${chk.label}`}
                            className="rounded-xl border border-[#A9B78D]/15 bg-[#0D1612] p-3 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[#F4F7F4]">{chk.label}</span>
                              <span
                                className={`font-semibold uppercase text-[10px] ${
                                  chk.status === 'pass'
                                    ? 'text-[#7CE0A3]'
                                    : chk.status === 'warning'
                                      ? 'text-[#FAD089]'
                                      : 'text-[#FCA5A5]'
                                }`}
                              >
                                {chk.status === 'pass'
                                  ? 'Clear'
                                  : chk.status === 'warning'
                                    ? 'Needs Attention'
                                    : 'Flagged'}
                              </span>
                            </div>
                            <p className="mt-1 text-[#C8D6CD]">{chk.explanation}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action Area Based on Status */}
                    {verification.status === 'VERIFIED' || verification.humanReviewStatus === 'approved' ? (
                      <div className="space-y-3 border-t border-[#A9B78D]/15 pt-4">
                        {listingType === 'material' && matPrice.trim() && (
                          <div className="text-xs text-[#9BB0A3]">
                            Listing indicative price:{' '}
                            <strong className="text-[#93C9A3]">
                              {Number(matPrice) === 0 ? 'Free Pickup' : formatINR(Number(matPrice))}
                            </strong>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={publishing || isDirtySinceVerify || !verification.canPublish}
                          onClick={() => void handlePublishCurrent()}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-3 text-sm font-semibold text-white hover:bg-[#348F68] disabled:opacity-50 cursor-pointer"
                        >
                          <span>{publishing ? 'Publishing Verified Listing...' : 'Publish Verified Listing'}</span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    ) : verification.status === 'NEEDS_REVIEW' ? (
                      <div className="space-y-3 border-t border-[#A9B78D]/15 pt-4">
                        <p className="text-xs text-[#FAD089]">
                          {verification.actionRequired}
                        </p>
                        {verification.humanReviewStatus === 'pending' ? (
                          <div className="rounded-xl border border-[#D99B38]/35 bg-[#2E230F] px-4 py-3 text-xs text-[#FAD089]">
                            Submitted for human administrator review. Once approved, you can publish it from{' '}
                            <strong>My Verifications</strong>.
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={requestingReview}
                            onClick={() => void handleRequestHumanReview()}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#D99B38]/45 bg-[#2E230F] px-4 py-2.5 text-xs font-semibold text-[#FAD089] hover:bg-[#3D2E14] disabled:opacity-50 cursor-pointer"
                          >
                            <Send className="h-3.5 w-3.5" />
                            <span>
                              {requestingReview
                                ? 'Submitting for Human Review...'
                                : 'Submit Supporting Evidence for Human Review'}
                            </span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2 border-t border-[#A9B78D]/15 pt-4">
                        <button
                          type="button"
                          disabled
                          className="w-full rounded-lg border border-[#E06C75]/35 bg-[#361619] px-4 py-2.5 text-xs font-semibold text-[#FFB3B8] opacity-80 cursor-not-allowed"
                        >
                          Publishing Blocked — Resolve Flagged Issues & Re-verify
                        </button>
                        <p className="text-[11px] text-[#C8D6CD]">
                          Update the highlighted fields on the left (e.g. remove duplicate posts, clarify description, or adjust unrealistic pricing) and run verification again.
                        </p>
                      </div>
                    )}

                    {/* Non-Guarantee Disclaimer */}
                    <div className="rounded-xl border border-[#A9B78D]/20 bg-[#0D1612] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#9BB0A3]">
                      <strong className="text-[#D2DDD6]">Verification Notice:</strong>{' '}
                      {verification.disclaimer}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
