import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Compass,
  MessageCircle,
  Package,
  RotateCcw,
  Scan,
  Send,
  Sparkles,
  Upload,
  Utensils,
} from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { MEDIA_ASSETS, resolveImageSrc } from '../data/media';
import { api } from '../services/api';
import type {
  Category,
  FoodDonation,
  FoodScanResult,
  MaterialListing,
  MaterialScanResult,
  MatchResult,
  ResourceGuideResult,
} from '../types';
import { buildWhatsAppUrl, formatDateTime, formatINR, isExpiredDate } from '../utils/format';
import type { FoodDraftPrefill } from './FoodRescueView';
import type { MaterialDraftPrefill } from './MarketplaceView';

interface AILabViewProps {
  initialSection?: string;
  categories: Category[];
  listings: MaterialListing[];
  donations: FoodDonation[];
  onCreateListingFromScan: (draft: MaterialDraftPrefill) => void;
  onCreateFoodDonationFromAI: (draft: FoodDraftPrefill) => void;
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
  'I need surplus food for a community kitchen — guide me',
  'I want reusable wood pallets or metal objects — guide me',
  'How do I donate surplus food responsibly?',
  'What can I do with leftover wooden pallets?',
  'How can I list surplus aluminium in ₹ INR clearly?',
];

export function AILabView({
  initialSection = 'scanner',
  categories,
  listings,
  donations,
  onCreateListingFromScan,
  onCreateFoodDonationFromAI,
  onInspectListing,
  onInspectDonation,
}: AILabViewProps) {
  const [section, setSection] = useState<'scanner' | 'matcher' | 'assistant'>(
    initialSection === 'matcher' || initialSection === 'assistant' ? initialSection : 'scanner'
  );

  // --- SCANNER STATE (MATERIAL OR FOOD) ---
  const [scannerKind, setScannerKind] = useState<'material' | 'food'>('material');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [scanContext, setScanContext] = useState('');
  const [scanResult, setScanResult] = useState<MaterialScanResult | null>(null);
  const [foodScanResult, setFoodScanResult] = useState<FoodScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Editable material draft fields
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriceInr, setEditPriceInr] = useState('');

  // Editable food donation draft fields
  const [editFoodTitle, setEditFoodTitle] = useState('');
  const [editFoodCategory, setEditFoodCategory] = useState('');
  const [editFoodPortions, setEditFoodPortions] = useState('25');
  const [editFoodStorage, setEditFoodStorage] = useState('');
  const [editFoodAllergens, setEditFoodAllergens] = useState('');
  const [editFoodDescription, setEditFoodDescription] = useState('');

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
        'Welcome to the VERDORA Eco AI Assistant (India · ₹ INR). Tell me if you want to create a Material or Food Donation listing, or tell me what food or reusable object you are looking for and I will guide you to live options.',
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

  const handleSwitchScannerKind = (nextKind: 'material' | 'food') => {
    setScannerKind(nextKind);
    setScanError(null);
    setScanResult(null);
    setFoodScanResult(null);
    setImageDataUrl(null);
    setScanContext('');
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

  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    setScanError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setScanError('Unsupported image format. Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setScanError('Image exceeds the 5 MB upload limit.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageDataUrl(reader.result);
        setScanResult(null);
        setFoodScanResult(null);
      }
    };
    reader.onerror = () => {
      setScanError('Could not read the selected image file.');
    };
    reader.readAsDataURL(file);
  };

  const loadSamplePhoto = async (assetUrl: string, contextHint: string) => {
    setScanError(null);
    try {
      const resp = await fetch(assetUrl);
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImageDataUrl(reader.result);
          setScanContext(contextHint);
          setScanResult(null);
          setFoodScanResult(null);
        }
      };
      reader.readAsDataURL(blob);
    } catch {
      setScanError('Unable to load sample studio image.');
    }
  };

  const handleRunScan = async () => {
    if (!imageDataUrl && scanContext.trim().length < 5) {
      setScanError(
        scannerKind === 'food'
          ? 'Please upload a food photo or write a brief description (at least 5 characters) of the surplus food.'
          : 'Please upload an object/material photo or write a brief description (at least 5 characters).'
      );
      return;
    }
    setScanError(null);
    setScanning(true);
    try {
      if (scannerKind === 'food') {
        const res = await api.scanFood(imageDataUrl, scanContext.trim());
        setFoodScanResult(res);
        setEditFoodTitle(res.suggestedTitle);
        setEditFoodCategory(res.suggestedCategory);
        setEditFoodPortions(String(res.estimatedPortions));
        setEditFoodStorage(res.storageAdvice);
        setEditFoodAllergens(res.potentialAllergens);
        setEditFoodDescription(res.suggestedDescription);
      } else {
        const res = await api.scanMaterial(imageDataUrl, scanContext.trim());
        setScanResult(res);
        setEditTitle(res.suggestedTitle);
        setEditCategory(res.suggestedCategory);
        setEditDescription(res.suggestedDescription);
        setEditPriceInr('');
      }
    } catch (err) {
      setScanError(
        err instanceof Error
          ? err.message
          : scannerKind === 'food'
            ? 'Surplus food analysis failed.'
            : 'Material scan failed.'
      );
    } finally {
      setScanning(false);
    }
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
            VERDORA Intelligence · India (₹ INR)
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[#F4F7F4] sm:text-4xl">
            AI Listing Creator, Smart Matching & Guide
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[#C8D6CD]">
            Create both Reusable Material listings and Food Rescue donations with AI, or get guided
            step-by-step to live surplus food or reusable objects available near you.
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-[#A9B78D]/18 bg-[#172620] p-1 self-start">
          <button
            type="button"
            onClick={() => setSection('scanner')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              section === 'scanner' ? 'bg-[#2B7A58] text-white shadow-xs' : 'text-[#C8D6CD] hover:text-white'
            }`}
          >
            <Scan className="h-3.5 w-3.5" />
            <span>AI Scanner & Creator</span>
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

      {/* SECTION 1: AI RESOURCE & FOOD SCANNER / LISTING CREATOR */}
      {section === 'scanner' && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5 space-y-5">
            <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#A9B78D]/20 bg-[#0D1612] p-1 mb-5">
                <button
                  type="button"
                  onClick={() => handleSwitchScannerKind('material')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${
                    scannerKind === 'material'
                      ? 'bg-[#2B7A58] text-white'
                      : 'text-[#C8D6CD] hover:text-white'
                  }`}
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>Object / Material</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchScannerKind('food')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer ${
                    scannerKind === 'food'
                      ? 'bg-[#2B7A58] text-white'
                      : 'text-[#C8D6CD] hover:text-white'
                  }`}
                >
                  <Utensils className="h-3.5 w-3.5" />
                  <span>Donate Surplus Food</span>
                </button>
              </div>

              <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                {scannerKind === 'food'
                  ? '1. Upload Food Photo or Describe Batch'
                  : '1. Upload Object Photo or Describe Material'}
              </h2>
              <p className="mt-1 text-xs text-[#C8D6CD]">
                {scannerKind === 'food'
                  ? 'Upload a photo (JPEG, PNG, WebP up to 5 MB), test a sample food batch, or describe surplus food below to auto-draft a Food Rescue donation.'
                  : 'Upload a photo (JPEG, PNG, WebP up to 5 MB), test a sample studio photo, or describe an object/material below to auto-draft a ₹ INR listing.'}
              </p>

              <div className="mt-4">
                <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#A9B78D]/35 bg-[#0D1612] p-6 text-center hover:bg-[#172620] cursor-pointer">
                  <Upload className="h-6 w-6 text-[#93C9A3]" />
                  <span className="mt-2 text-xs font-semibold text-[#F4F7F4]">
                    Choose photo from device (Optional)
                  </span>
                  <span className="mt-1 text-[11px] text-[#9BB0A3]">
                    Analyzed securely via server-side Gemini endpoint
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = '';
                      handleFileSelect(file);
                    }}
                  />
                </label>
              </div>

              <div className="mt-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9BB0A3]">
                  Quick Sample Photos
                </div>
                {scannerKind === 'material' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        loadSamplePhoto(MEDIA_ASSETS.aluminium, '2mm brushed aluminium offcuts from CNC cutting')
                      }
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-medium text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                    >
                      Aluminium Offcuts
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        loadSamplePhoto(MEDIA_ASSETS.wood, 'Heat-treated timber shipping pallets stored indoors')
                      }
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-medium text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                    >
                      Timber Pallets
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        loadSamplePhoto(MEDIA_ASSETS.textile, 'Unbleached linen and cotton fabric rolls')
                      }
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-medium text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                    >
                      Textile Bolts
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        loadSamplePhoto(
                          MEDIA_ASSETS.bakery,
                          'Freshly baked sourdough loaves, multigrain bread & buns from afternoon bakery batch (~30 portions)'
                        )
                      }
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-medium text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                    >
                      Bakery Surplus
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        loadSamplePhoto(
                          MEDIA_ASSETS.produce,
                          'Surplus fresh farm vegetables and seasonal fruit crates ready for community kitchens (~40 portions)'
                        )
                      }
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-medium text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                    >
                      Fresh Produce
                    </button>
                  </div>
                )}
              </div>

              {imageDataUrl && (
                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#D2DDD6]">
                    <span>Preview</span>
                    <button
                      type="button"
                      onClick={() => {
                        setImageDataUrl(null);
                        setScanResult(null);
                        setFoodScanResult(null);
                      }}
                      className="text-[#FCA5A5] hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                  <img
                    src={imageDataUrl}
                    alt={scannerKind === 'food' ? 'Food donation preview' : 'Material upload preview'}
                    className="mt-2 aspect-[4/3] w-full rounded-xl object-cover border border-[#A9B78D]/20"
                  />
                </div>
              )}

              <div className="mt-4">
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  {scannerKind === 'food'
                    ? 'Food Details (Dish/items, portions, veg/non-veg, storage)'
                    : 'Object / Material Details (Dimensions, count, condition)'}
                </label>
                <textarea
                  rows={3}
                  value={scanContext}
                  onChange={(e) => setScanContext(e.target.value)}
                  placeholder={
                    scannerKind === 'food'
                      ? 'e.g., 35 portions cooked veg pulao and dal prepared at 1 PM, kept hot in sealed steel vessels'
                      : 'e.g., 4 sturdy wooden office tables or 2mm aluminium sheets stored dry in Indiranagar'
                  }
                  className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                />
              </div>

              {scanError && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2.5 text-xs text-[#FFB3B8]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{scanError}</span>
                </div>
              )}

              <button
                type="button"
                disabled={scanning || (!imageDataUrl && scanContext.trim().length < 5)}
                onClick={handleRunScan}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2B7A58] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#348F68] disabled:opacity-50 cursor-pointer"
              >
                <Scan className="h-4 w-4" />
                <span>
                  {scanning
                    ? scannerKind === 'food'
                      ? 'Generating Food Donation Draft...'
                      : 'Analyzing Material / Object...'
                    : scannerKind === 'food'
                      ? 'Generate Food Donation Draft'
                      : 'Analyze Object / Material'}
                </span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-7">
            {scannerKind === 'material' ? (
              !scanResult ? (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center">
                  <Package className="h-8 w-8 text-[#93C9A3]" />
                  <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
                    Ready to Draft a Reusable Object or Material Listing
                  </h3>
                  <p className="mt-2 max-w-md text-sm text-[#C8D6CD]">
                    Upload a photo or describe any reusable object or material to inspect condition,
                    reuse applications, a quality checklist, and pre-fill your ₹ INR listing.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#A9B78D]/15 pb-4">
                    <div>
                      <div className="text-xs text-[#9BB0A3]">
                        {scanResult.isDemoFallback
                          ? 'Offline Draft Mode (No live API key configured)'
                          : 'Gemini Vision Assessment'}{' '}
                        · {scanResult.confidenceLabel}
                      </div>
                      <h2 className="mt-1 font-display text-2xl font-semibold text-[#F4F7F4]">
                        {scanResult.predictedMaterial}
                      </h2>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-[#9BB0A3]">Suggested Category</div>
                      <div className="font-semibold text-[#93C9A3]">{scanResult.suggestedCategory}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
                    <div className="rounded-xl border border-[#A9B78D]/15 bg-[#172620] p-4">
                      <div className="font-semibold text-[#93C9A3]">Visible Condition</div>
                      <p className="mt-1 text-[#D2DDD6]">{scanResult.visibleCondition}</p>
                      <div className="mt-3 font-semibold text-[#93C9A3]">Observations</div>
                      <ul className="mt-1 space-y-1 text-[#D2DDD6] list-disc pl-4">
                        {scanResult.observations.map((obs) => (
                          <li key={obs}>{obs}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-[#A9B78D]/15 bg-[#172620] p-4">
                      <div className="font-semibold text-[#93C9A3]">Possible Reuse Applications</div>
                      <ul className="mt-1 space-y-1 text-[#D2DDD6] list-disc pl-4">
                        {scanResult.reuseApplications.map((app) => (
                          <li key={app}>{app}</li>
                        ))}
                      </ul>
                      <div className="mt-3 font-semibold text-[#93C9A3]">Quality Verification Checklist</div>
                      <ul className="mt-1 space-y-1 text-[#D2DDD6]">
                        {scanResult.qualityChecklist.map((chk) => (
                          <li key={chk} className="flex items-start gap-1.5">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#93C9A3]" />
                            <span>{chk}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Editable Suggested Material Draft */}
                  <div className="border-t border-[#A9B78D]/15 pt-5 space-y-3">
                    <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                      Review & Edit Material / Object Listing Draft
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#D2DDD6]">Category</label>
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
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
                        <label className="block text-xs font-semibold text-[#D2DDD6]">
                          Indicative Price (₹ INR)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editPriceInr}
                          onChange={(e) => setEditPriceInr(e.target.value)}
                          placeholder="0 = Free"
                          className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] tabular-nums focus-ring"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">Description</label>
                      <textarea
                        rows={2}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#D99B38]/35 bg-[#2E230F] px-3.5 py-2.5 text-xs text-[#FAD089]">
                    {scanResult.disclaimer}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        onCreateListingFromScan({
                          title: editTitle,
                          category: editCategory,
                          description: editDescription,
                          condition: 'Good',
                          indicativePrice: editPriceInr.trim() ? Number(editPriceInr) : null,
                          reuseApplications: scanResult.reuseApplications,
                          imageUrl: imageDataUrl ?? undefined,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                    >
                      <span>Create Marketplace Listing</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            ) : !foodScanResult ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center">
                <Utensils className="h-8 w-8 text-[#93C9A3]" />
                <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
                  Ready to Create a Food Rescue Donation Listing
                </h3>
                <p className="mt-2 max-w-md text-sm text-[#C8D6CD]">
                  Upload a food photo or describe your surplus meal batch, bakery goods, or produce.
                  AI will structure portions, storage instructions, allergens, and pre-fill your Food
                  Rescue form.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] p-6 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#A9B78D]/15 pb-4">
                  <div>
                    <div className="text-xs text-[#9BB0A3]">
                      {foodScanResult.isDemoFallback
                        ? 'Offline Draft Mode (No live API key configured)'
                        : 'Gemini Food Rescue Assessment'}{' '}
                      · {foodScanResult.confidenceLabel}
                    </div>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-[#F4F7F4]">
                      {foodScanResult.predictedFood}
                    </h2>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-[#9BB0A3]">Suggested Food Category</div>
                    <div className="font-semibold text-[#93C9A3]">{foodScanResult.suggestedCategory}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
                  <div className="rounded-xl border border-[#A9B78D]/15 bg-[#172620] p-4 space-y-2">
                    <div className="font-semibold text-[#93C9A3]">Estimated Batch & Dietary</div>
                    <p className="text-[#D2DDD6]">
                      Approx. <strong className="text-white">{foodScanResult.estimatedPortions} portions</strong> (
                      {foodScanResult.estimatedQuantity} {foodScanResult.estimatedUnit}) ·{' '}
                      {foodScanResult.dietaryTags}
                    </p>
                    <div className="font-semibold text-[#93C9A3] pt-1">Observations</div>
                    <ul className="space-y-1 text-[#D2DDD6] list-disc pl-4">
                      {foodScanResult.observations.map((obs) => (
                        <li key={obs}>{obs}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-[#A9B78D]/15 bg-[#172620] p-4">
                    <div className="font-semibold text-[#93C9A3]">Handling & Disclosure Checklist</div>
                    <ul className="mt-1.5 space-y-1.5 text-[#D2DDD6]">
                      {foodScanResult.handlingChecklist.map((chk) => (
                        <li key={chk} className="flex items-start gap-1.5">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#93C9A3]" />
                          <span>{chk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Editable Food Donation Draft */}
                <div className="border-t border-[#A9B78D]/15 pt-5 space-y-3">
                  <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                    Review & Edit Food Donation Draft
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#D2DDD6]">Food Title</label>
                      <input
                        type="text"
                        value={editFoodTitle}
                        onChange={(e) => setEditFoodTitle(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">Category</label>
                      <select
                        value={editFoodCategory}
                        onChange={(e) => setEditFoodCategory(e.target.value)}
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
                      <label className="block text-xs font-semibold text-[#D2DDD6]">Portions</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={editFoodPortions}
                        onChange={(e) => setEditFoodPortions(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Storage Conditions
                      </label>
                      <input
                        type="text"
                        value={editFoodStorage}
                        onChange={(e) => setEditFoodStorage(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Known Allergens
                      </label>
                      <input
                        type="text"
                        value={editFoodAllergens}
                        onChange={(e) => setEditFoodAllergens(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#D2DDD6]">Description</label>
                    <textarea
                      rows={2}
                      value={editFoodDescription}
                      onChange={(e) => setEditFoodDescription(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#D99B38]/35 bg-[#2E230F] px-3.5 py-2.5 text-xs text-[#FAD089]">
                  {foodScanResult.disclaimer}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      onCreateFoodDonationFromAI({
                        title: editFoodTitle,
                        category: editFoodCategory,
                        description: editFoodDescription,
                        quantity: foodScanResult.estimatedQuantity,
                        unit: foodScanResult.estimatedUnit,
                        portions: Math.max(1, Math.round(Number(editFoodPortions) || foodScanResult.estimatedPortions)),
                        storageInfo: editFoodStorage,
                        packagingInfo: foodScanResult.packagingAdvice,
                        allergens: editFoodAllergens,
                        dietaryInfo: foodScanResult.dietaryTags,
                        imageUrl: imageDataUrl ?? 'media:bakery',
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                  >
                    <span>Create Food Donation Listing</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
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
                  return (
                    <article
                      key={listing.id}
                      className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] sm:grid-cols-4"
                    >
                      <div className="aspect-[4/3] sm:aspect-auto bg-[#0D1612]">
                        <img
                          src={resolveImageSrc(listing.imageUrl, 'aluminium')}
                          alt={listing.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="flex flex-col justify-between p-5 sm:col-span-3">
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
                return (
                  <article
                    key={donation.id}
                    className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] sm:grid-cols-4"
                  >
                    <div className="aspect-[4/3] sm:aspect-auto bg-[#0D1612]">
                      <img
                        src={resolveImageSrc(donation.imageUrl, 'bakery')}
                        alt={donation.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex flex-col justify-between p-5 sm:col-span-3">
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
