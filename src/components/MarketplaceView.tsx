import {
  Bookmark,
  Check,
  Flag,
  GitCompare,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveImageSrc } from '../data/media';
import { auth } from '../firebase';
import { api } from '../services/api';
import {
  cancelMaterialInFirestore,
  createMaterialRequestInFirestore,
  isOwnerOfResource,
  toggleSavedInFirestore,
} from '../services/firestoreSync';
import type { Category, MaterialListing, User } from '../types';
import { buildWhatsAppUrl, formatINR, formatShortDate } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { MaterialFormModal, type MaterialDraftPrefill } from './MaterialFormModal';
import { ReportModal } from './ReportModal';

export type { MaterialDraftPrefill };

interface MarketplaceViewProps {
  user: User | null;
  categories: Category[];
  listings: MaterialListing[];
  savedIds: Set<string>;
  selectedListing: MaterialListing | null;
  draftPrefill: MaterialDraftPrefill | null;
  onClearDraftPrefill: () => void;
  onSelectListing: (listing: MaterialListing | null) => void;
  onRefresh: () => Promise<void>;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
  onOpenOilRecovery?: () => void;
}

const CONDITIONS = ['Unused Surplus', 'Like New', 'Good', 'Fair / Needs Cleaning'];
const IMAGE_PRESETS = [
  { label: 'Aluminium / Metal', value: 'media:aluminium' },
  { label: 'Timber / Pallets', value: 'media:wood' },
  { label: 'Textiles / Linen', value: 'media:textile' },
];

export function MarketplaceView({
  user,
  categories,
  listings,
  savedIds,
  selectedListing,
  draftPrefill,
  onClearDraftPrefill,
  onSelectListing,
  onRefresh,
  onRequireAuth,
  onToast,
  onOpenOilRecovery,
}: MarketplaceViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [conditionFilter, setConditionFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('');
  const [onlySaved, setOnlySaved] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'quantity-desc' | 'price-asc'>('newest');

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(Boolean(draftPrefill));
  const [editingListing, setEditingListing] = useState<MaterialListing | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MaterialListing | null>(null);
  const [reportTarget, setReportTarget] = useState<{ type: 'material' | 'food'; id: string; title: string } | null>(null);

  useEffect(() => {
    if (draftPrefill) {
      setEditingListing(null);
      setShowCreateModal(true);
    }
  }, [draftPrefill]);

  // Request form state inside Detail modal
  const [reqQty, setReqQty] = useState('10');
  const [intendedUse, setIntendedUse] = useState('');
  const [preferredDate, setPreferredDate] = useState(
    new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)
  );
  const [preferredTime, setPreferredTime] = useState('11:00');
  const [arrangement, setArrangement] = useState<'Pickup' | 'Delivery Coordination'>('Pickup');
  const [reqNotes, setReqNotes] = useState('');
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);

  const materialCategories = useMemo(
    () => categories.filter((c) => c.type === 'material' && c.isActive),
    [categories]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const loc = locationFilter.trim().toLowerCase();
    const out = listings.filter((item) => {
      if (item.status !== 'Active') return false;
      if (onlySaved && !savedIds.has(item.id)) return false;
      if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;
      if (conditionFilter !== 'All' && item.condition !== conditionFilter) return false;
      if (loc && !item.location.toLowerCase().includes(loc)) return false;
      if (q) {
        const hay = `${item.title} ${item.category} ${item.description} ${item.location} ${item.reuseApplications.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'quantity-desc') {
      out.sort((a, b) => b.quantity - a.quantity);
    } else if (sortBy === 'price-asc') {
      out.sort((a, b) => (a.indicativePrice ?? 999999) - (b.indicativePrice ?? 999999));
    } else {
      out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return out;
  }, [listings, searchQuery, categoryFilter, conditionFilter, locationFilter, onlySaved, savedIds, sortBy]);

  const compareItems = useMemo(
    () => listings.filter((l) => compareIds.includes(l.id)),
    [listings, compareIds]
  );

  const similarMaterials = useMemo(() => {
    if (!selectedListing) return [];
    return listings
      .filter(
        (l) =>
          l.id !== selectedListing.id &&
          l.status === 'Active' &&
          (l.category === selectedListing.category || l.location.split(',')[0] === selectedListing.location.split(',')[0])
      )
      .slice(0, 3);
  }, [listings, selectedListing]);

  const openCreateForm = (editTarget?: MaterialListing) => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setEditingListing(editTarget ?? null);
    setShowCreateModal(true);
  };

  const handleToggleSave = async (id: string) => {
    if (!user) {
      onRequireAuth();
      return;
    }
    try {
      let saved: boolean | null = null;
      try {
        const res = await api.toggleSaved('material', id);
        saved = res.saved;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      const fsSaved = await toggleSavedInFirestore('material', id);
      if (saved === null && fsSaved !== null) {
        saved = fsSaved;
      }
      if (saved === null) {
        throw new Error('Could not update saved state.');
      }
      await onRefresh();
      onToast(saved ? 'Saved to bookmarks.' : 'Removed from bookmarks.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update saved state.');
    }
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        onToast('You can compare up to 3 material listings at once.');
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleSubmitRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!selectedListing) return;
    if (isOwnerOfResource(user, selectedListing.sellerId, selectedListing.sellerUid)) {
      setReqError('You cannot request your own material listing.');
      return;
    }
    setReqError(null);
    setReqBusy(true);
    try {
      const payload = {
        listingId: selectedListing.id,
        requestedQuantity: Number(reqQty),
        intendedUse,
        preferredDate,
        preferredTime,
        arrangement,
        notes: reqNotes,
      };
      let apiId: string | null = null;
      try {
        const res = await api.createMaterialRequest(payload);
        apiId = res.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      let fsId: string | null = null;
      if (selectedListing.sellerUid && auth.currentUser) {
        fsId = await createMaterialRequestInFirestore(
          selectedListing,
          user,
          {
            requestedQuantity: payload.requestedQuantity,
            intendedUse: payload.intendedUse,
            preferredDate: payload.preferredDate,
            preferredTime: payload.preferredTime,
            arrangement: payload.arrangement,
            notes: payload.notes,
          },
          apiId || undefined
        );
      }
      if (!apiId && !fsId) {
        throw new Error('Could not submit request. Please refresh and try again.');
      }
      setIntendedUse('');
      setReqNotes('');
      onToast('Pickup request submitted. Track progress in Workspace.');
      onSelectListing(null);
      await onRefresh();
    } catch (err) {
      setReqError(err instanceof Error ? err.message : 'Could not submit request.');
    } finally {
      setReqBusy(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('All');
    setConditionFilter('All');
    setLocationFilter('');
    setOnlySaved(false);
    setSortBy('newest');
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#A9B78D]/15 pb-8 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
            VERDORA Market
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-[#F4F7F4] sm:text-4xl">
            Circular Materials Marketplace
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[#C8D6CD]">
            Discover reusable metals, timber, textiles, and packaging. No online payments—coordinate
            handover details directly via WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {onOpenOilRecovery && (
            <button
              type="button"
              onClick={onOpenOilRecovery}
              className="whitespace-nowrap rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
            >
              Used Cooking Oil Recovery
            </button>
          )}
          {compareIds.length >= 2 && (
            <button
              type="button"
              onClick={() => setShowCompareModal(true)}
              className="inline-flex whitespace-nowrap items-center gap-2 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
            >
              <GitCompare className="h-4 w-4 text-[#93C9A3]" />
              <span>Compare ({compareIds.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => openCreateForm()}
            className="inline-flex whitespace-nowrap items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer focus-ring"
          >
            <Plus className="h-4 w-4" />
            <span>List Material</span>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="mt-6 grid grid-cols-1 gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 lg:grid-cols-12">
        <div className="relative lg:col-span-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search materials, reuse applications, specs..."
            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
          />
        </div>
        <div className="lg:col-span-2">
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
          >
            <option value="All">All Categories</option>
            {materialCategories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-2">
          <select
            aria-label="Filter by condition"
            value={conditionFilter}
            onChange={(e) => setConditionFilter(e.target.value)}
            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
          >
            <option value="All">Any Condition</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-2">
          <input
            type="text"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            placeholder="City or area..."
            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
          />
        </div>
        <div className="flex items-center gap-2 lg:col-span-2">
          <select
            aria-label="Sort listings"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'quantity-desc' | 'price-asc')}
            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
          >
            <option value="newest">Newest First</option>
            <option value="quantity-desc">Largest Quantity</option>
            <option value="price-asc">Lowest Indicative Price</option>
          </select>
        </div>
      </div>

      {/* Secondary Filter Strip */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlySaved((p) => !p)}
            className={`inline-flex whitespace-nowrap items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition-colors cursor-pointer ${
              onlySaved
                ? 'border-[#2B7A58] bg-[#2B7A58] text-white'
                : 'border-[#A9B78D]/20 bg-[#172620] text-[#D2DDD6] hover:text-white'
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>Saved Only</span>
          </button>
          {(searchQuery || categoryFilter !== 'All' || conditionFilter !== 'All' || locationFilter || onlySaved) && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex whitespace-nowrap items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium text-[#93C9A3] hover:bg-[#172620] cursor-pointer"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Reset filters</span>
            </button>
          )}
        </div>
        <div className="text-[#9BB0A3] tabular-nums">
          Showing {filtered.length} active {filtered.length === 1 ? 'listing' : 'listings'}
        </div>
      </div>

      {/* Results Grid */}
      {filtered.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center">
          <h3 className="font-display text-xl font-semibold text-[#F4F7F4]">
            {listings.length === 0
              ? 'No material listings have been published yet.'
              : 'No matching material listings found'}
          </h3>
          <p className="mt-2 text-sm text-[#C8D6CD]">
            {listings.length === 0
              ? 'Verified suppliers and workshops can publish surplus materials here.'
              : 'Try clearing your filters or publish a new surplus material batch.'}
          </p>
          {(searchQuery || categoryFilter !== 'All' || conditionFilter !== 'All' || locationFilter || onlySaved) && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-5 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
            >
              Clear All Filters
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const isSaved = savedIds.has(item.id);
            const isCompared = compareIds.includes(item.id);
            const waUrl = buildWhatsAppUrl(item.whatsappNumber, 'material', item.title);
            return (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#172620]">
                  <img
                    src={resolveImageSrc(item.imageUrl, 'aluminium')}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute right-3 top-3 flex gap-1.5">
                    <button
                      type="button"
                      aria-label={isCompared ? 'Remove from comparison' : 'Add to comparison'}
                      onClick={() => toggleCompare(item.id)}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur-sm cursor-pointer ${
                        isCompared
                          ? 'bg-[#2B7A58] text-white'
                          : 'border border-white/20 bg-[#0A110E]/85 text-[#F4F7F4] hover:bg-[#172620]'
                      }`}
                    >
                      {isCompared ? 'Comparing' : 'Compare'}
                    </button>
                    <button
                      type="button"
                      aria-label={isSaved ? 'Remove bookmark' : 'Save listing'}
                      onClick={() => handleToggleSave(item.id)}
                      className={`rounded-lg p-1.5 backdrop-blur-sm cursor-pointer ${
                        isSaved
                          ? 'bg-[#2B7A58] text-white'
                          : 'border border-white/20 bg-[#0A110E]/85 text-[#F4F7F4] hover:bg-[#172620]'
                      }`}
                    >
                      <Bookmark className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 flex-col justify-between p-5">
                  <div>
                    {/* Zero-pill quiet metadata */}
                    <div className="text-xs text-[#9BB0A3]">
                      {item.category} · <span className="tabular-nums text-[#D2DDD6]">{item.quantity} {item.unit}</span> · {item.condition}
                    </div>
                    <h3 className="mt-1.5 font-display text-lg font-semibold text-[#F4F7F4]">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#C8D6CD]">
                      {item.description}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-xs text-[#C8D6CD]">
                      <span>{item.location}</span>
                      <span className="font-mono-tabular font-semibold text-[#93C9A3]">
                        {item.indicativePrice === null
                          ? 'Price on inquiry'
                          : item.indicativePrice === 0
                            ? 'Free Pickup'
                            : `${formatINR(item.indicativePrice)} est.`}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-[#9BB0A3]">
                      <span>{item.sellerName}</span>
                      {item.sellerVerified && (
                        <span className="inline-flex items-center gap-0.5 text-[#93C9A3] font-medium">
                          · <ShieldCheck className="h-3.5 w-3.5" /> Verified
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center gap-2 border-t border-[#A9B78D]/15 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setReqQty(String(Math.min(item.quantity, 25)));
                        onSelectListing(item);
                      }}
                      className="flex-1 whitespace-nowrap rounded-lg bg-[#2B7A58] px-3 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                    >
                      View Details
                    </button>
                    {waUrl ? (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                      >
                        Contact Seller
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectListing(item)}
                        className="whitespace-nowrap rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                      >
                        Request
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* DETAIL MODAL */}
      {selectedListing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
        >
          <div className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl sm:p-8">
            <button
              type="button"
              aria-label="Close material details"
              onClick={() => onSelectListing(null)}
              className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              <div className="lg:col-span-6 space-y-5">
                <div className="aspect-[4/3] overflow-hidden rounded-xl border border-[#A9B78D]/20 bg-[#172620]">
                  <img
                    src={resolveImageSrc(selectedListing.imageUrl, 'aluminium')}
                    alt={selectedListing.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                    Suggested Reuse Applications (Advisory)
                  </h4>
                  <ul className="mt-2 space-y-1.5 text-sm text-[#D2DDD6]">
                    {(selectedListing.reuseApplications.length > 0
                      ? selectedListing.reuseApplications
                      : ['Workshop fabrication', 'Community DIY reuse', 'Secondary prototyping']
                    ).map((idea) => (
                      <li key={idea} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
                        <span>{idea}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {similarMaterials.length > 0 && (
                  <div className="border-t border-[#A9B78D]/15 pt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                      Similar Materials
                    </h4>
                    <div className="mt-2 space-y-2">
                      {similarMaterials.map((sim) => (
                        <button
                          key={sim.id}
                          type="button"
                          onClick={() => onSelectListing(sim)}
                          className="flex w-full items-center justify-between rounded-lg border border-[#A9B78D]/18 bg-[#172620] px-3 py-2 text-left text-xs hover:border-[#93C9A3]/40 cursor-pointer"
                        >
                          <span className="font-semibold text-[#F4F7F4]">{sim.title}</span>
                          <span className="tabular-nums text-[#C8D6CD]">
                            {sim.quantity} {sim.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-6">
                <div className="text-xs text-[#9BB0A3]">
                  {selectedListing.category} · {selectedListing.condition} · Available until{' '}
                  {formatShortDate(selectedListing.availableUntil)}
                </div>
                <h2
                  id="material-detail-title"
                  className="mt-1.5 font-display text-2xl font-semibold text-[#F4F7F4]"
                >
                  {selectedListing.title}
                </h2>

                <div className="mt-3 grid grid-cols-2 gap-3 border-y border-[#A9B78D]/15 py-3 text-xs">
                  <div>
                    <span className="text-[#9BB0A3]">Available Quantity</span>
                    <div className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#F4F7F4]">
                      {selectedListing.quantity} {selectedListing.unit}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#9BB0A3]">Indicative Price</span>
                    <div className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#93C9A3]">
                      {selectedListing.indicativePrice === null
                        ? 'Negotiable / On Inquiry'
                        : selectedListing.indicativePrice === 0
                          ? 'Free Pickup'
                          : `${formatINR(selectedListing.indicativePrice)} (No online checkout)`}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#9BB0A3]">Location</span>
                    <div className="mt-0.5 font-medium text-[#F4F7F4]">{selectedListing.location}</div>
                  </div>
                  <div>
                    <span className="text-[#9BB0A3]">Seller</span>
                    <div className="mt-0.5 font-medium text-[#F4F7F4]">
                      {selectedListing.sellerName}
                      {selectedListing.sellerVerified ? ' (Verified)' : ''}
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-[#D2DDD6]">
                  {selectedListing.description}
                </p>

                {selectedListing.pickupPreferences && (
                  <p className="mt-2 text-xs text-[#9BB0A3]">
                    Pickup notes: {selectedListing.pickupPreferences}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {buildWhatsAppUrl(selectedListing.whatsappNumber, 'material', selectedListing.title) ? (
                    <a
                      href={
                        buildWhatsAppUrl(
                          selectedListing.whatsappNumber,
                          'material',
                          selectedListing.title
                        )!
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                    >
                      Coordinate on WhatsApp
                    </a>
                  ) : (
                    <span className="text-xs text-[#9BB0A3]">
                      No WhatsApp number shared—submit an in-app pickup request below.
                    </span>
                  )}

                  {user &&
                    (isOwnerOfResource(user, selectedListing.sellerId, selectedListing.sellerUid) ||
                      user.role === 'admin') &&
                    (!['Completed', 'Cancelled'].includes(selectedListing.status) ||
                      user.role === 'admin') && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = selectedListing;
                          onSelectListing(null);
                          openCreateForm(target);
                        }}
                        className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                      >
                        Edit Listing
                      </button>
                    )}

                  {user &&
                    (isOwnerOfResource(user, selectedListing.sellerId, selectedListing.sellerUid) ||
                      user.role === 'admin') &&
                    !['Completed', 'Cancelled'].includes(selectedListing.status) && (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(selectedListing)}
                        className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                      >
                        Cancel Listing
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => {
                      if (!user) {
                        onRequireAuth();
                        return;
                      }
                      setReportTarget({
                        type: 'material',
                        id: selectedListing.id,
                        title: selectedListing.title,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs text-[#C8D6CD] hover:text-[#FCA5A5] cursor-pointer"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span>Report</span>
                  </button>
                </div>

                {/* Request Pickup Form */}
                <form
                  onSubmit={handleSubmitRequest}
                  className="mt-6 rounded-xl border border-[#A9B78D]/18 bg-[#172620] p-4 space-y-3"
                >
                  <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                    Request Material & Schedule Pickup
                  </h3>
                  {reqError && (
                    <div className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2 text-xs text-[#FFB3B8]">
                      {reqError}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Quantity ({selectedListing.unit})
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={selectedListing.quantity}
                        required
                        value={reqQty}
                        onChange={(e) => setReqQty(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Arrangement
                      </label>
                      <select
                        value={arrangement}
                        onChange={(e) =>
                          setArrangement(e.target.value as 'Pickup' | 'Delivery Coordination')
                        }
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] focus-ring"
                      >
                        <option value="Pickup">Self Pickup</option>
                        <option value="Delivery Coordination">Delivery Coordination</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Preferred Date
                      </label>
                      <input
                        type="date"
                        required
                        value={preferredDate}
                        onChange={(e) => setPreferredDate(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] focus-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Preferred Time
                      </label>
                      <input
                        type="time"
                        required
                        value={preferredTime}
                        onChange={(e) => setPreferredTime(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] focus-ring"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#D2DDD6]">
                      Intended Reuse Application
                    </label>
                    <input
                      type="text"
                      required
                      minLength={4}
                      value={intendedUse}
                      onChange={(e) => setIntendedUse(e.target.value)}
                      placeholder="e.g., CNC mounting brackets for workshop project"
                      className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#D2DDD6]">
                      Pickup Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={reqNotes}
                      onChange={(e) => setReqNotes(e.target.value)}
                      placeholder="Vehicle type or loading questions"
                      className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={reqBusy}
                    className="w-full rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
                  >
                    {reqBusy ? 'Submitting...' : 'Submit Material Request'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      <MaterialFormModal
        isOpen={showCreateModal}
        user={user}
        categories={categories}
        editingListing={editingListing}
        draftPrefill={draftPrefill}
        onClose={() => {
          setShowCreateModal(false);
          setEditingListing(null);
          onClearDraftPrefill();
        }}
        onSaved={async (_listing, isEdit) => {
          onClearDraftPrefill();
          onToast(
            isEdit
              ? 'Material listing updated.'
              : 'Material listing published to VERDORA Market.'
          );
          await onRefresh();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        title="Cancel Material Listing"
        description={
          cancelTarget
            ? `Cancel "${cancelTarget.title}"? It will be removed from public marketplace discovery while keeping your listing history.`
            : ''
        }
        confirmLabel="Cancel Listing"
        cancelLabel="Keep Listing"
        tone="danger"
        onClose={() => setCancelTarget(null)}
        onConfirm={async () => {
          if (!cancelTarget) return;
          let cancelledLocally = false;
          try {
            await api.cancelMaterial(cancelTarget.id);
            cancelledLocally = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message.toLowerCase() : '';
            if (!msg.includes('404') && !msg.includes('not found')) {
              throw err;
            }
          }
          const fsCancelled = await cancelMaterialInFirestore(cancelTarget.id).catch((err) => {
            if (!cancelledLocally) throw err;
            return null;
          });
          if (!cancelledLocally && !fsCancelled) {
            throw new Error('Could not cancel material listing.');
          }
          onSelectListing(null);
          await onRefresh();
          onToast('Material listing cancelled.');
        }}
      />

      {/* COMPARE MODAL */}
      {showCompareModal && compareItems.length >= 2 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="compare-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
        >
          <div className="relative max-h-[90vh] w-full max-w-4xl overflow-x-auto rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl">
            <button
              type="button"
              aria-label="Close comparison"
              onClick={() => setShowCompareModal(false)}
              className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 id="compare-modal-title" className="font-display text-2xl font-semibold text-[#F4F7F4]">
              Material Listing Comparison
            </h2>
            <table className="mt-5 w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#A9B78D]/20">
                  <th className="py-2 pr-4 font-semibold text-[#9BB0A3]">Attribute</th>
                  {compareItems.map((item) => (
                    <th key={item.id} className="py-2 px-3 font-semibold text-[#93C9A3]">
                      {item.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                <tr>
                  <td className="py-2.5 pr-4 text-[#9BB0A3]">Category</td>
                  {compareItems.map((i) => (
                    <td key={i.id} className="py-2.5 px-3">{i.category}</td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-[#9BB0A3]">Quantity</td>
                  {compareItems.map((i) => (
                    <td key={i.id} className="py-2.5 px-3 tabular-nums font-medium text-[#F4F7F4]">{i.quantity} {i.unit}</td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-[#9BB0A3]">Condition</td>
                  {compareItems.map((i) => (
                    <td key={i.id} className="py-2.5 px-3">{i.condition}</td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-[#9BB0A3]">Location</td>
                  {compareItems.map((i) => (
                    <td key={i.id} className="py-2.5 px-3">{i.location}</td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-[#9BB0A3]">Indicative Price</td>
                  {compareItems.map((i) => (
                    <td key={i.id} className="py-2.5 px-3 tabular-nums text-[#93C9A3]">
                      {i.indicativePrice === null ? 'On Inquiry' : i.indicativePrice === 0 ? 'Free' : formatINR(i.indicativePrice)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ReportModal
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => onToast('Report submitted for moderation review.')}
      />
    </div>
  );
}
