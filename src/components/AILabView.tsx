import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Compass,
  Loader2,
  MessageCircle,
  Package,
  RotateCcw,
  Scan,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Utensils,
  X,
} from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { resolveImageSrc } from '../data/media';
import { api } from '../services/api';
import type {
  Category,
  FoodDonation,
  FoodScanResult,
  ListingKind,
  MaterialListing,
  MaterialScanResult,
  MatchResult,
  OilRecoveryListing,
  ResourceGuideResult,
  User,
} from '../types';
import { buildWhatsAppUrl, formatDateTime, formatINR, isExpiredDate } from '../utils/format';
import { AIListingVerifier, type AIScannerPrefillDraft } from './AIListingVerifier';

interface AILabViewProps {
  initialSection?: string;
  initialVerifyType?: ListingKind;
  user: User | null;
  categories: Category[];
  listings: MaterialListing[];
  donations: FoodDonation[];
  onRequireAuth: () => void;
  onPublished: (
    kind: ListingKind,
    item: MaterialListing | FoodDonation | OilRecoveryListing
  ) => Promise<void>;
  onToast: (msg: string) => void;
  onInspectListing: (listing: MaterialListing) => void;
  onInspectDonation: (donation: FoodDonation) => void;
}

interface FoodMatchResult {
  donation: FoodDonation;
  relevanceScore: number;
  reasons: string[];
  portionCompatibility: 'Exact / Sufficient' | 'Partial Batch' | 'Check Portions';
}

const STARTER_PROMPTS = [
  'How do I scan and list surplus aluminium or wood pallets?',
  'I need surplus food for a community kitchen — guide me',
  'I want reusable wood pallets or metal objects — guide me',
  'How do I donate surplus food responsibly?',
  'How does Verdora AI verify my listing before publishing?',
];

export function AILabView({
  initialSection = 'scanner',
  initialVerifyType = 'material',
  user,
  categories,
  listings,
  donations,
  onRequireAuth,
  onPublished,
  onToast,
  onInspectListing,
  onInspectDonation,
}: AILabViewProps) {
  const [section, setSection] = useState<'scanner' | 'verify' | 'matcher' | 'assistant'>(
    initialSection === 'verify' || initialSection === 'matcher' || initialSection === 'assistant'
      ? initialSection
      : 'scanner'
  );
  const [verifierPrefill, setVerifierPrefill] = useState<AIScannerPrefillDraft | null>(null);

  // --- OLD AI FEATURE RESTORED: AI MATERIAL & FOOD SCANNER STATE ---
  const [scanKind, setScanKind] = useState<'material' | 'food'>('material');
  const [scanImage, setScanImage] = useState<string | null>(null);
  const [scanNotes, setScanNotes] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [materialScanResult, setMaterialScanResult] = useState<MaterialScanResult | null>(null);
  const [foodScanResult, setFoodScanResult] = useState<FoodScanResult | null>(null);

  // --- MATCHMAKER & AI GUIDE STATE ---
  const [matcherKind, setMatcherKind] = useState<'material' | 'food'>('material');
  const [needText, setNeedText] = useState(
    'I need 100 kg of reusable aluminium or steel sheets for workshop fabrication.'
  );
  const [needCategory, setNeedCategory] = useState('All');
  const [needQty, setNeedQty] = useState('100');
  const [needLocation, setNeedLocation] = useState('');
  const [needCondition, setNeedCondition] = useState('Any');
  const [hasSearchedMatch, setHasSearchedMatch] = useState(true);

  const [guideResult, setGuideResult] = useState<ResourceGuideResult | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);

  // --- ASSISTANT STATE ---
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: 'user' | 'assistant'; content: string; mode?: string }>
  >([
    {
      role: 'assistant',
      content:
        'Welcome to the VERDORA AI Assistant (India · ₹ INR). Scan photos of reusable materials or surplus food in the AI Scanner, verify & publish listings in the AI Listing Verifier, or ask me to help find live surplus resources near you.',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const materialCategories = useMemo(
    () => categories.filter((c) => c.type === 'material' && c.isActive),
    [categories]
  );

  const foodCategories = useMemo(
    () => categories.filter((c) => c.type === 'food' && c.isActive),
    [categories]
  );

  const handleSwitchScanKind = (nextKind: 'material' | 'food') => {
    setScanKind(nextKind);
    setScanError(null);
  };

  const handleScanImageUpload = (file: File | undefined) => {
    if (!file) return;
    setScanError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setScanError('Please upload a JPEG, PNG, or WebP photo.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setScanError('Photo exceeds the 5 MB upload limit.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setScanImage(reader.result);
      }
    };
    reader.onerror = () => setScanError('Could not read the selected photo.');
    reader.readAsDataURL(file);
  };

  const handleRunScan = async () => {
    if (!scanImage && scanNotes.trim().length < 3) {
      setScanError(
        scanKind === 'material'
          ? 'Upload a photo of the material/object or write a brief description to scan.'
          : 'Upload a photo of the surplus food or write a brief description to scan.'
      );
      return;
    }
    setScanError(null);
    setScanning(true);
    try {
      if (scanKind === 'material') {
        const result = await api.scanMaterial(scanImage, scanNotes.trim());
        setMaterialScanResult(result);
        setFoodScanResult(null);
      } else {
        const result = await api.scanFood(scanImage, scanNotes.trim());
        setFoodScanResult(result);
        setMaterialScanResult(null);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'AI scan failed. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  const handleCreateMaterialFromScan = () => {
    if (!materialScanResult) return;
    setVerifierPrefill({
      nonce: Date.now(),
      kind: 'material',
      title: materialScanResult.suggestedTitle,
      category: materialScanResult.suggestedCategory,
      description: materialScanResult.suggestedDescription,
      condition: materialScanResult.visibleCondition,
      reuseApplications: materialScanResult.reuseApplications,
      imageUrl: scanImage || undefined,
    });
    setSection('verify');
    onToast('Scan draft loaded into AI Listing Verifier. Review details and publish!');
  };

  const handleCreateFoodFromScan = () => {
    if (!foodScanResult) return;
    setVerifierPrefill({
      nonce: Date.now(),
      kind: 'food',
      title: foodScanResult.suggestedTitle,
      category: foodScanResult.suggestedCategory,
      description: foodScanResult.suggestedDescription,
      quantity: foodScanResult.estimatedQuantity,
      unit: foodScanResult.estimatedUnit,
      portions: foodScanResult.estimatedPortions,
      storageInfo: foodScanResult.storageAdvice,
      packagingInfo: foodScanResult.packagingAdvice,
      allergens: foodScanResult.potentialAllergens,
      dietaryInfo: foodScanResult.dietaryTags,
      imageUrl: scanImage || undefined,
    });
    setSection('verify');
    onToast('Food scan draft loaded into AI Listing Verifier. Confirm safety details and publish!');
  };

  const handleSwitchMatcherKind = (nextKind: 'material' | 'food') => {
    setMatcherKind(nextKind);
    setNeedCategory('All');
    setGuideResult(null);
    setGuideError(null);
    if (nextKind === 'food') {
      setNeedText('Looking for 25 portions of fresh vegetarian food or bakery surplus for community distribution.');
      setNeedQty('25');
    } else {
      setNeedText('I need 100 kg of reusable aluminium or wood pallets for workshop fabrication.');
      setNeedQty('100');
    }
    setHasSearchedMatch(true);
  };

  // Rule-based explainable relevance scoring for Material Objects
  const matchResults = useMemo<MatchResult[]>(() => {
    if (!hasSearchedMatch || matcherKind !== 'material') return [];
    const tokens = needText
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !['need', 'for', 'the', 'and', 'with', 'small', 'project', 'want', 'looking'].includes(t));
    const targetQty = Number(needQty) || 0;
    const locQuery = needLocation.trim().toLowerCase();

    const scored: MatchResult[] = [];

    for (const item of listings) {
      if (item.status !== 'Active') continue;
      let score = 0;
      const reasons: string[] = [];

      const hay = `${item.title} ${item.category} ${item.description} ${item.reuseApplications.join(' ')}`.toLowerCase();

      if (needCategory !== 'All' && item.category === needCategory) {
        score += 35;
        reasons.push(`Matches requested category (${item.category})`);
      }

      const keywordHits = tokens.filter((t) => hay.includes(t));
      if (keywordHits.length > 0) {
        score += Math.min(35, keywordHits.length * 12);
        reasons.push(`Keyword alignment: ${keywordHits.slice(0, 3).join(', ')}`);
      }

      let quantityCompatibility: MatchResult['quantityCompatibility'] = 'Check Quantity';
      if (targetQty > 0) {
        if (item.quantity >= targetQty) {
          score += 18;
          quantityCompatibility = 'Exact / Sufficient';
          reasons.push(`Available quantity (${item.quantity} ${item.unit}) meets requested ${targetQty}`);
        } else if (item.quantity >= targetQty * 0.4) {
          score += 9;
          quantityCompatibility = 'Partial Supply';
          reasons.push(`Provides partial batch (${item.quantity} ${item.unit})`);
        }
      }

      if (locQuery && item.location.toLowerCase().includes(locQuery)) {
        score += 12;
        reasons.push(`Located in ${item.location}`);
      }

      if (needCondition !== 'Any' && item.condition === needCondition) {
        score += 10;
        reasons.push(`Condition matches (${item.condition})`);
      }

      if (score >= 15) {
        scored.push({
          listing: item,
          relevanceScore: Math.min(99, score),
          reasons,
          quantityCompatibility,
        });
      }
    }

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored;
  }, [hasSearchedMatch, matcherKind, needText, needCategory, needQty, needLocation, needCondition, listings]);

  // Rule-based explainable relevance scoring for Food Rescue Donations
  const foodMatchResults = useMemo<FoodMatchResult[]>(() => {
    if (!hasSearchedMatch || matcherKind !== 'food') return [];
    const tokens = needText
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !['need', 'for', 'the', 'and', 'with', 'want', 'looking', 'food', 'portions'].includes(t));
    const targetPortions = Number(needQty) || 0;
    const locQuery = needLocation.trim().toLowerCase();

    const scored: FoodMatchResult[] = [];

    for (const d of donations) {
      if (['Completed', 'Cancelled', 'Expired'].includes(d.status)) continue;
      if (d.remainingPortions <= 0 || isExpiredDate(d.pickupDeadline)) continue;

      let score = 0;
      const reasons: string[] = [];
      const hay = `${d.title} ${d.category} ${d.description} ${d.dietaryInfo} ${d.storageInfo}`.toLowerCase();

      if (needCategory !== 'All' && d.category === needCategory) {
        score += 35;
        reasons.push(`Matches food category (${d.category})`);
      }

      const keywordHits = tokens.filter((t) => hay.includes(t));
      if (keywordHits.length > 0) {
        score += Math.min(35, keywordHits.length * 12);
        reasons.push(`Keyword match: ${keywordHits.slice(0, 3).join(', ')}`);
      }

      let portionCompatibility: FoodMatchResult['portionCompatibility'] = 'Check Portions';
      if (targetPortions > 0) {
        if (d.remainingPortions >= targetPortions) {
          score += 18;
          portionCompatibility = 'Exact / Sufficient';
          reasons.push(`${d.remainingPortions} portions available meets requested ${targetPortions}`);
        } else if (d.remainingPortions >= targetPortions * 0.4) {
          score += 9;
          portionCompatibility = 'Partial Batch';
          reasons.push(`Provides partial batch (${d.remainingPortions} portions)`);
        }
      }

      if (locQuery && d.location.toLowerCase().includes(locQuery)) {
        score += 15;
        reasons.push(`Pickup area matches ${d.location}`);
      }

      if (score === 0 && !locQuery && needCategory === 'All') {
        score = 20;
        reasons.push(`Active Food Rescue batch (${d.remainingPortions} portions left)`);
      }

      if (score >= 15) {
        scored.push({
          donation: d,
          relevanceScore: Math.min(99, score),
          reasons,
          portionCompatibility,
        });
      }
    }

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored;
  }, [hasSearchedMatch, matcherKind, needText, needCategory, needQty, needLocation, donations]);

  const handleRunGuide = async () => {
    setHasSearchedMatch(true);
    setGuideError(null);
    if (needText.trim().length < 2) {
      setGuideError('Please enter what food or object you are looking for.');
      return;
    }
    setGuideLoading(true);
    try {
      const res = await api.guideResource({
        kind: matcherKind,
        query: needText.trim(),
        location: needLocation.trim() || undefined,
        quantityOrPortions: Number(needQty) || undefined,
      });
      setGuideResult(res);
    } catch (err) {
      setGuideError(err instanceof Error ? err.message : 'Unable to generate AI step-by-step guide.');
    } finally {
      setGuideLoading(false);
    }
  };

  const sendAssistantMessage = async (msgText: string) => {
    const trimmed = msgText.trim();
    if (!trimmed || chatBusy) return;
    setChatError(null);
    const nextHistory = [...chatHistory, { role: 'user' as const, content: trimmed }];
    setChatHistory(nextHistory);
    setChatInput('');
    setChatBusy(true);
    try {
      const res = await api.askAssistant(
        trimmed,
        nextHistory.map(({ role, content }) => ({ role, content }))
      );
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.reply,
          mode: res.isDemoFallback ? 'Offline Guidance Mode' : 'Gemini',
        },
      ]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Assistant request failed.');
    } finally {
      setChatBusy(false);
    }
  };

  const handleChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendAssistantMessage(chatInput);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 text-[#F4F7F4]">
      {/* Header + Segmented Navigation */}
      <div className="flex flex-col justify-between gap-6 border-b border-[#A9B78D]/15 pb-8 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
            VERDORA AI Lab · India (₹ INR)
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[#F4F7F4] sm:text-4xl">
            AI Scanner, Listing Verification & Smart Matching
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[#C8D6CD]">
            Scan reusable materials or surplus food with AI vision, verify listings before
            publishing, match live resources, or ask the VERDORA Eco Assistant.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl border border-[#A9B78D]/18 bg-[#172620] p-1 self-start">
          <button
            type="button"
            onClick={() => setSection('scanner')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'scanner' ? 'bg-[#2B7A58] text-white shadow-xs' : 'text-[#C8D6CD] hover:text-white'
            }`}
          >
            <Scan className="h-3.5 w-3.5" />
            <span>AI Scanner</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('verify')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'verify' ? 'bg-[#2B7A58] text-white shadow-xs' : 'text-[#C8D6CD] hover:text-white'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>AI Listing Verifier</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('matcher')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'matcher' ? 'bg-[#2B7A58] text-white shadow-xs' : 'text-[#C8D6CD] hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Smart Match & Guide</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('assistant')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'assistant' ? 'bg-[#2B7A58] text-white shadow-xs' : 'text-[#C8D6CD] hover:text-white'
            }`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span>Eco Assistant</span>
          </button>
        </div>
      </div>

      {/* SECTION 0: RESTORED AI MATERIAL & FOOD SCANNER */}
      {section === 'scanner' && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left: Upload & Scan Form */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-5">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#A9B78D]/20 bg-[#0D1612] p-1">
                <button
                  type="button"
                  onClick={() => handleSwitchScanKind('material')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${
                    scanKind === 'material'
                      ? 'bg-[#2B7A58] text-white'
                      : 'text-[#C8D6CD] hover:text-white'
                  }`}
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>Scan Material</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchScanKind('food')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${
                    scanKind === 'food'
                      ? 'bg-[#2B7A58] text-white'
                      : 'text-[#C8D6CD] hover:text-white'
                  }`}
                >
                  <Utensils className="h-3.5 w-3.5" />
                  <span>Scan Surplus Food</span>
                </button>
              </div>

              <div>
                <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                  {scanKind === 'material'
                    ? 'AI Material & Object Scanner'
                    : 'AI Surplus Food Scanner'}
                </h2>
                <p className="mt-1 text-xs text-[#C8D6CD]">
                  {scanKind === 'material'
                    ? 'Upload a photo of your surplus material or describe it below. AI identifies the category, visible condition, reuse ideas, and drafts your listing.'
                    : 'Upload a photo of your surplus food batch or describe it below. AI estimates portions, suggests storage & packaging guidance, flags potential allergens, and drafts your donation.'}
                </p>
              </div>

              {/* Photo Upload Zone — Only user-uploaded photos */}
              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  Upload Photo (Optional if description is provided)
                </label>
                {scanImage ? (
                  <div className="mt-2 relative overflow-hidden rounded-xl border border-[#A9B78D]/25 bg-[#0D1612]">
                    <img
                      src={scanImage}
                      alt="Uploaded item to scan"
                      className="h-52 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setScanImage(null)}
                      className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-lg bg-[#0A110E]/85 px-2.5 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#361619] hover:text-[#FFB3B8] cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                ) : (
                  <label className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#A9B78D]/35 bg-[#0D1612] px-4 py-8 text-center transition-colors hover:border-[#93C9A3]/60 hover:bg-[#14231C]">
                    <Upload className="h-6 w-6 text-[#93C9A3]" />
                    <div className="text-xs font-semibold text-[#F4F7F4]">
                      Click to upload JPEG, PNG, or WebP photo
                    </div>
                    <div className="text-[11px] text-[#9BB0A3]">Up to 5 MB · Real photo only</div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handleScanImageUpload(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  {scanKind === 'material'
                    ? 'Material / Object Notes (Optional with photo)'
                    : 'Food Batch Description (Optional with photo)'}
                </label>
                <textarea
                  rows={3}
                  value={scanNotes}
                  onChange={(e) => setScanNotes(e.target.value)}
                  placeholder={
                    scanKind === 'material'
                      ? 'e.g., 120 kg clean 6061 aluminium sheet offcuts, 2mm thickness, stored dry indoors...'
                      : 'e.g., 40 fresh vegetable pulao boxes and whole-wheat rolls prepared at 1 PM today, vegetarian...'
                  }
                  className="mt-1.5 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                />
              </div>

              {scanError && (
                <div className="flex items-start gap-2 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs text-[#FFB3B8]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{scanError}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => void handleRunScan()}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Analyzing with Verdora AI...</span>
                    </>
                  ) : (
                    <>
                      <Scan className="h-4 w-4" />
                      <span>
                        {scanKind === 'material'
                          ? 'Scan Material with AI'
                          : 'Scan Surplus Food with AI'}
                      </span>
                    </>
                  )}
                </button>
                {(scanImage || scanNotes || materialScanResult || foodScanResult) && (
                  <button
                    type="button"
                    onClick={() => {
                      setScanImage(null);
                      setScanNotes('');
                      setScanError(null);
                      setMaterialScanResult(null);
                      setFoodScanResult(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2.5 text-xs font-semibold text-[#C8D6CD] hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right: Structured AI Scan Results */}
          <div className="lg:col-span-7 space-y-5">
            {!materialScanResult && !foodScanResult ? (
              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-8 flex flex-col justify-center min-h-[380px]">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#93C9A3]/30 bg-[#172620] text-[#93C9A3]">
                  <Scan className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-2xl font-semibold text-[#F4F7F4]">
                  Ready to Analyze Your {scanKind === 'material' ? 'Material Batch' : 'Surplus Food'}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#C8D6CD]">
                  {scanKind === 'material'
                    ? 'Upload a photo or enter details on the left to classify reusable materials, surface condition notes, discover secondary reuse applications, and prefill a verified Marketplace listing.'
                    : 'Upload a photo or describe your surplus food on the left to estimate portions, review storage and packaging advice, highlight potential allergens, and prefill a verified Food Rescue donation.'}
                </p>
                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-[#D2DDD6]">
                  <div className="rounded-xl border border-[#A9B78D]/15 bg-[#0D1612] p-3.5">
                    <div className="font-semibold text-[#93C9A3]">1. Instant AI Classification</div>
                    <p className="mt-1 text-[#C8D6CD]">
                      Identifies category, condition or portion estimate, and clean listing copy.
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#A9B78D]/15 bg-[#0D1612] p-3.5">
                    <div className="font-semibold text-[#93C9A3]">2. One-Click Draft to Verifier</div>
                    <p className="mt-1 text-[#C8D6CD]">
                      Transfers your scanned fields & photo directly into Verdora AI Verification.
                    </p>
                  </div>
                </div>
              </div>
            ) : materialScanResult ? (
              <div className="rounded-2xl border border-[#93C9A3]/30 bg-[#111C17] p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#A9B78D]/15 pb-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Material AI Scan Complete</span>
                    </div>
                    <h3 className="mt-1.5 font-display text-2xl font-semibold text-[#F4F7F4]">
                      {materialScanResult.predictedMaterial}
                    </h3>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded-lg border border-[#93C9A3]/30 bg-[#172620] px-2.5 py-1 text-xs font-semibold text-[#93C9A3]">
                      {materialScanResult.confidenceLabel}
                      {materialScanResult.confidenceScore !== null
                        ? ` · ${Math.round(materialScanResult.confidenceScore)}%`
                        : ''}
                    </span>
                    <div className="mt-1 text-[11px] text-[#9BB0A3]">
                      {materialScanResult.isDemoFallback ? 'Offline Analysis Mode' : 'Gemini Vision'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3.5">
                    <div className="text-[11px] uppercase tracking-wider text-[#9BB0A3]">
                      Suggested Category
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[#F4F7F4]">
                      {materialScanResult.suggestedCategory}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3.5">
                    <div className="text-[11px] uppercase tracking-wider text-[#9BB0A3]">
                      Visible Condition
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[#F4F7F4]">
                      {materialScanResult.visibleCondition}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-4 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                    Suggested Listing Draft
                  </div>
                  <div className="text-sm font-semibold text-[#F4F7F4]">
                    {materialScanResult.suggestedTitle}
                  </div>
                  <p className="text-xs leading-relaxed text-[#D2DDD6]">
                    {materialScanResult.suggestedDescription}
                  </p>
                </div>

                {materialScanResult.observations.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      Observations
                    </h4>
                    <ul className="mt-2 space-y-1.5 text-xs text-[#D2DDD6] list-disc pl-5">
                      {materialScanResult.observations.map((obs) => (
                        <li key={obs}>{obs}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {materialScanResult.reuseApplications.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      Recommended Reuse Applications
                    </h4>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {materialScanResult.reuseApplications.map((app) => (
                        <span
                          key={app}
                          className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-2.5 py-1 text-xs text-[#F4F7F4]"
                        >
                          {app}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {materialScanResult.qualityChecklist.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      Quality & Handover Checklist
                    </h4>
                    <ul className="mt-2 space-y-1.5 text-xs text-[#D2DDD6] list-disc pl-5">
                      {materialScanResult.qualityChecklist.map((chk) => (
                        <li key={chk}>{chk}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-lg border border-[#D99B38]/35 bg-[#2E230F] px-3.5 py-2.5 text-xs text-[#FAD089]">
                  {materialScanResult.disclaimer}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleCreateMaterialFromScan}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                  >
                    <span>Create Material Listing from Scan</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : foodScanResult ? (
              <div className="rounded-2xl border border-[#93C9A3]/30 bg-[#111C17] p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#A9B78D]/15 pb-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Surplus Food AI Scan Complete</span>
                    </div>
                    <h3 className="mt-1.5 font-display text-2xl font-semibold text-[#F4F7F4]">
                      {foodScanResult.predictedFood}
                    </h3>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded-lg border border-[#93C9A3]/30 bg-[#172620] px-2.5 py-1 text-xs font-semibold text-[#93C9A3]">
                      {foodScanResult.confidenceLabel}
                      {foodScanResult.confidenceScore !== null
                        ? ` · ${Math.round(foodScanResult.confidenceScore)}%`
                        : ''}
                    </span>
                    <div className="mt-1 text-[11px] text-[#9BB0A3]">
                      {foodScanResult.isDemoFallback ? 'Offline Analysis Mode' : 'Gemini Vision'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3">
                    <div className="text-[11px] text-[#9BB0A3]">Category</div>
                    <div className="mt-1 text-xs font-semibold text-[#F4F7F4]">
                      {foodScanResult.suggestedCategory}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3">
                    <div className="text-[11px] text-[#9BB0A3]">Est. Quantity</div>
                    <div className="mt-1 text-xs font-semibold tabular-nums text-[#F4F7F4]">
                      {foodScanResult.estimatedQuantity} {foodScanResult.estimatedUnit}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3">
                    <div className="text-[11px] text-[#9BB0A3]">Est. Portions</div>
                    <div className="mt-1 text-xs font-semibold tabular-nums text-[#93C9A3]">
                      ~{foodScanResult.estimatedPortions} portions
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3">
                    <div className="text-[11px] text-[#9BB0A3]">Dietary</div>
                    <div className="mt-1 text-xs font-semibold text-[#F4F7F4]">
                      {foodScanResult.dietaryTags}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-4 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                    Suggested Food Donation Draft
                  </div>
                  <div className="text-sm font-semibold text-[#F4F7F4]">
                    {foodScanResult.suggestedTitle}
                  </div>
                  <p className="text-xs leading-relaxed text-[#D2DDD6]">
                    {foodScanResult.suggestedDescription}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3.5">
                    <div className="font-semibold text-[#93C9A3]">Storage Advice</div>
                    <p className="mt-1 text-[#D2DDD6]">{foodScanResult.storageAdvice}</p>
                  </div>
                  <div className="rounded-xl border border-[#A9B78D]/18 bg-[#0D1612] p-3.5">
                    <div className="font-semibold text-[#93C9A3]">Packaging Advice</div>
                    <p className="mt-1 text-[#D2DDD6]">{foodScanResult.packagingAdvice}</p>
                  </div>
                  <div className="rounded-xl border border-[#D99B38]/30 bg-[#2E230F]/70 p-3.5">
                    <div className="font-semibold text-[#FAD089]">Potential Allergens</div>
                    <p className="mt-1 text-[#FAD089]">{foodScanResult.potentialAllergens}</p>
                  </div>
                </div>

                {foodScanResult.observations.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      Observations
                    </h4>
                    <ul className="mt-2 space-y-1.5 text-xs text-[#D2DDD6] list-disc pl-5">
                      {foodScanResult.observations.map((obs) => (
                        <li key={obs}>{obs}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {foodScanResult.handlingChecklist.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      Safe Handling Checklist
                    </h4>
                    <ul className="mt-2 space-y-1.5 text-xs text-[#D2DDD6] list-disc pl-5">
                      {foodScanResult.handlingChecklist.map((chk) => (
                        <li key={chk}>{chk}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-lg border border-[#D99B38]/35 bg-[#2E230F] px-3.5 py-2.5 text-xs text-[#FAD089]">
                  {foodScanResult.disclaimer}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleCreateFoodFromScan}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                  >
                    <span>Create Food Donation from Scan</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* SECTION 1: AI LISTING VERIFICATION & PUBLISHING */}
      {section === 'verify' && (
        <AIListingVerifier
          initialType={initialVerifyType}
          prefillDraft={verifierPrefill}
          user={user}
          categories={categories}
          onRequireAuth={onRequireAuth}
          onPublished={onPublished}
          onToast={onToast}
        />
      )}

      {/* SECTION 2: SMART MATCHMAKING & AI GUIDE (FOOD OR REUSABLE OBJECT) */}
      {section === 'matcher' && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#A9B78D]/20 bg-[#0D1612] p-1">
                <button
                  type="button"
                  onClick={() => handleSwitchMatcherKind('material')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold cursor-pointer ${
                    matcherKind === 'material'
                      ? 'bg-[#2B7A58] text-white'
                      : 'text-[#C8D6CD] hover:text-white'
                  }`}
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>Want Object</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMatcherKind('food')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold cursor-pointer ${
                    matcherKind === 'food'
                      ? 'bg-[#2B7A58] text-white'
                      : 'text-[#C8D6CD] hover:text-white'
                  }`}
                >
                  <Utensils className="h-3.5 w-3.5" />
                  <span>Want Food</span>
                </button>
              </div>

              <div>
                <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                  {matcherKind === 'food'
                    ? 'What Surplus Food Are You Looking For?'
                    : 'What Object or Material Do You Need?'}
                </h2>
                <p className="mt-1 text-xs text-[#C8D6CD]">
                  Matches real active database records and generates an AI step-by-step pickup guide.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  Requirement Summary
                </label>
                <textarea
                  rows={3}
                  value={needText}
                  onChange={(e) => setNeedText(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Category</label>
                  <select
                    value={needCategory}
                    onChange={(e) => setNeedCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  >
                    <option value="All">Any Category</option>
                    {(matcherKind === 'food' ? foodCategories : materialCategories).map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">
                    {matcherKind === 'food' ? 'Target Portions' : 'Target Quantity'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={needQty}
                    onChange={(e) => setNeedQty(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className={matcherKind === 'food' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">City / Area (India)</label>
                  <input
                    type="text"
                    value={needLocation}
                    onChange={(e) => setNeedLocation(e.target.value)}
                    placeholder="e.g., Bengaluru, Chennai, Mumbai"
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                  />
                </div>
                {matcherKind === 'material' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#D2DDD6]">Condition</label>
                    <select
                      value={needCondition}
                      onChange={(e) => setNeedCondition(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                    >
                      <option value="Any">Any Condition</option>
                      <option value="Unused Surplus">Unused Surplus</option>
                      <option value="Like New">Like New</option>
                      <option value="Good">Good</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setHasSearchedMatch(true)}
                  className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                >
                  Find Relevant Matches
                </button>
                <button
                  type="button"
                  disabled={guideLoading}
                  onClick={() => void handleRunGuide()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
                >
                  <Compass className="h-4 w-4" />
                  <span>
                    {guideLoading
                      ? 'Building AI Step-by-Step Guide...'
                      : matcherKind === 'food'
                        ? 'Get AI Food Rescue Guide'
                        : 'Get AI Object & Material Guide'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-5">
            {guideError && (
              <div className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-4 py-3 text-xs text-[#FFB3B8]">
                {guideError}
              </div>
            )}

            {guideResult && (
              <div className="rounded-2xl border border-[#93C9A3]/30 bg-[#172620] p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                    <Compass className="h-4 w-4" />
                    <span>
                      {matcherKind === 'food' ? 'AI Food Rescue Guide' : 'AI Object & Material Guide'}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#9BB0A3]">
                    {guideResult.isDemoFallback ? 'Offline Guidance Mode' : 'Gemini Live Guidance'}
                  </span>
                </div>

                <p className="text-sm leading-relaxed text-[#F4F7F4]">{guideResult.summary}</p>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                    Step-by-Step Action Plan
                  </h4>
                  <ol className="mt-2 space-y-1.5 text-xs text-[#D2DDD6] list-decimal pl-5">
                    {guideResult.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>

                <div className="rounded-lg border border-[#D99B38]/35 bg-[#2E230F] px-3.5 py-2.5 text-xs text-[#FAD089]">
                  {guideResult.safetyOrQualityNote}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold text-[#F4F7F4]">
                {matcherKind === 'food'
                  ? `Ranked Food Donations (${foodMatchResults.length})`
                  : `Ranked Object & Material Matches (${matchResults.length})`}
              </h3>
              <span className="text-xs text-[#9BB0A3]">Live database records only</span>
            </div>

            {matcherKind === 'material' ? (
              matchResults.length === 0 ? (
                <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
                  No active object or material listings matched those criteria yet. Broaden the
                  category or location, or click "Get AI Object & Material Guide" for next steps.
                </div>
              ) : (
                matchResults.map(({ listing, relevanceScore, reasons, quantityCompatibility }) => {
                  const waUrl = buildWhatsAppUrl(listing.whatsappNumber, 'material', listing.title);
                  const imgSrc = resolveImageSrc(listing.imageUrl);
                  return (
                    <article
                      key={listing.id}
                      className={`grid grid-cols-1 overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] ${
                        imgSrc ? 'sm:grid-cols-4' : ''
                      }`}
                    >
                      {imgSrc && (
                        <div className="aspect-[4/3] sm:aspect-auto bg-[#0D1612]">
                          <img
                            src={imgSrc}
                            alt={listing.title}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                      <div className={`flex flex-col justify-between p-5 ${imgSrc ? 'sm:col-span-3' : ''}`}>
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="text-[#9BB0A3]">
                              {listing.category} · {listing.quantity} {listing.unit} · {listing.location} ·{' '}
                              <strong className="text-[#93C9A3]">
                                {listing.indicativePrice === null
                                  ? 'On inquiry'
                                  : listing.indicativePrice === 0
                                    ? 'Free Pickup'
                                    : formatINR(listing.indicativePrice)}
                              </strong>
                            </span>
                            <span className="font-mono-tabular font-semibold text-[#93C9A3]">
                              {relevanceScore}% Relevance · {quantityCompatibility}
                            </span>
                          </div>
                          <h4 className="mt-1.5 font-display text-lg font-semibold text-[#F4F7F4]">
                            {listing.title}
                          </h4>
                          <p className="mt-2 text-xs text-[#D2DDD6]">
                            <strong className="text-[#F4F7F4]">Why it matches:</strong> {reasons.join('; ')}.
                          </p>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2 border-t border-[#A9B78D]/15 pt-3">
                          <button
                            type="button"
                            onClick={() => onInspectListing(listing)}
                            className="rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                          >
                            Open Listing & Request
                          </button>
                          {waUrl && (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                            >
                              Contact via WhatsApp
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })
              )
            ) : foodMatchResults.length === 0 ? (
              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
                No active surplus food donations match those criteria right now. Clear the area
                filter, check Food Rescue, or click "Get AI Food Rescue Guide" above.
              </div>
            ) : (
              foodMatchResults.map(({ donation, relevanceScore, reasons, portionCompatibility }) => {
                const waUrl = buildWhatsAppUrl(donation.whatsappNumber, 'food', donation.title);
                const imgSrc = resolveImageSrc(donation.imageUrl);
                return (
                  <article
                    key={donation.id}
                    className={`grid grid-cols-1 overflow-hidden rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] ${
                      imgSrc ? 'sm:grid-cols-4' : ''
                    }`}
                  >
                    {imgSrc && (
                      <div className="aspect-[4/3] sm:aspect-auto bg-[#0D1612]">
                        <img
                          src={imgSrc}
                          alt={donation.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <div className={`flex flex-col justify-between p-5 ${imgSrc ? 'sm:col-span-3' : ''}`}>
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-[#9BB0A3]">
                            {donation.category} · {donation.remainingPortions} portions left · {donation.location}
                          </span>
                          <span className="font-mono-tabular font-semibold text-[#93C9A3]">
                            {relevanceScore}% Match · {portionCompatibility}
                          </span>
                        </div>
                        <h4 className="mt-1.5 font-display text-lg font-semibold text-[#F4F7F4]">
                          {donation.title}
                        </h4>
                        <p className="mt-1 text-xs text-[#C8D6CD]">
                          Deadline: {formatDateTime(donation.pickupDeadline)} · Storage: {donation.storageInfo || 'Check listing'} · Allergens: {donation.allergens || 'Check with donor'}
                        </p>
                        <p className="mt-2 text-xs text-[#D2DDD6]">
                          <strong className="text-[#F4F7F4]">Why it matches:</strong> {reasons.join('; ')}.
                        </p>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#A9B78D]/15 pt-3">
                        <button
                          type="button"
                          onClick={() => onInspectDonation(donation)}
                          className="rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                        >
                          Inspect Food & Request
                        </button>
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                          >
                            WhatsApp Donor
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: ECO AI ASSISTANT */}
      {section === 'assistant' && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6">
              <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                Suggested Prompts
              </h2>
              <p className="mt-1 text-xs text-[#C8D6CD]">
                Ask for live food donations, reusable objects, listing advice, or Food Rescue workflows.
              </p>
              <div className="mt-4 space-y-2">
                {STARTER_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={chatBusy}
                    onClick={() => void sendAssistantMessage(q)}
                    className="w-full rounded-lg border border-[#A9B78D]/20 bg-[#172620] px-3 py-2 text-left text-xs font-medium text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="flex h-[540px] flex-col rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]">
              <div className="flex items-center justify-between border-b border-[#A9B78D]/15 px-5 py-3.5">
                <div className="text-sm font-semibold text-[#F4F7F4]">VERDORA Eco AI Assistant</div>
                <button
                  type="button"
                  onClick={() =>
                    setChatHistory([
                      {
                        role: 'assistant',
                        content:
                          'Conversation cleared. Tell me if you want to offer or find surplus food or a reusable object today!',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-[#C8D6CD] hover:bg-[#172620] hover:text-white cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Clear</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {chatHistory.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-[#2B7A58] text-white'
                          : 'bg-[#172620] text-[#F4F7F4] border border-[#A9B78D]/20'
                      }`}
                    >
                      {msg.content}
                    </div>
                    {msg.mode && (
                      <span className="mt-1 text-[11px] text-[#9BB0A3]">{msg.mode}</span>
                    )}
                  </div>
                ))}
                {chatBusy && (
                  <div className="text-xs text-[#9BB0A3]">Thinking...</div>
                )}
              </div>

              {chatError && (
                <div className="mx-5 mb-2 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2 text-xs text-[#FFB3B8]">
                  {chatError}
                </div>
              )}

              <form
                onSubmit={handleChatSubmit}
                className="flex items-center gap-2 border-t border-[#A9B78D]/15 p-4"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask where to get surplus food, find a reusable object, or list in ₹ INR..."
                  className="flex-1 rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3.5 py-2.5 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                />
                <button
                  type="submit"
                  disabled={chatBusy || !chatInput.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-50 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
