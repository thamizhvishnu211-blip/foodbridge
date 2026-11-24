import {
  AlertTriangle,
  Clock,
  Flag,
  Plus,
  Search,
  ShieldCheck,
  Utensils,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { resolveImageSrc } from '../data/media';
import { auth } from '../firebase';
import { api } from '../services/api';
import {
  cancelFoodDonationInFirestore,
  createFoodRequestInFirestore,
  isOwnerOfResource,
} from '../services/firestoreSync';
import type { Category, FoodDonation, User } from '../types';
import { buildWhatsAppUrl, formatDateTime, isExpiredDate } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { FoodDonationFormModal, type FoodDraftPrefill } from './FoodDonationFormModal';
import { ReportModal } from './ReportModal';

export type { FoodDraftPrefill };

interface FoodRescueViewProps {
  user: User | null;
  categories: Category[];
  donations: FoodDonation[];
  selectedDonation: FoodDonation | null;
  draftPrefill?: FoodDraftPrefill | null;
  onClearDraftPrefill?: () => void;
  onSelectDonation: (d: FoodDonation | null) => void;
  onRefresh: () => Promise<void>;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export function FoodRescueView({
  user,
  categories,
  donations,
  selectedDonation,
  draftPrefill,
  onClearDraftPrefill,
  onSelectDonation,
  onRefresh,
  onRequireAuth,
  onToast,
}: FoodRescueViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [sortBy, setSortBy] = useState<'deadline' | 'portions-desc' | 'newest'>('deadline');

  const [showDonateModal, setShowDonateModal] = useState(Boolean(draftPrefill));
  const [editingDonation, setEditingDonation] = useState<FoodDonation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FoodDonation | null>(null);
  const [showSafetyGuide, setShowSafetyGuide] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'material' | 'food'; id: string; title: string } | null>(null);

  useEffect(() => {
    if (draftPrefill) {
      setEditingDonation(null);
      setShowDonateModal(true);
    }
  }, [draftPrefill]);

  // Recipient request state
  const [reqPortions, setReqPortions] = useState('10');
  const [preferredTime, setPreferredTime] = useState('Within 2 hours');
  const [reqNotes, setReqNotes] = useState('');
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);

  const foodCategories = useMemo(
    () => categories.filter((c) => c.type === 'food' && c.isActive),
    [categories]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const loc = locationFilter.trim().toLowerCase();
    const out = donations.filter((d) => {
      const expired = d.status === 'Expired' || isExpiredDate(d.pickupDeadline);
      if (onlyAvailable && (expired || ['Completed', 'Cancelled'].includes(d.status) || d.remainingPortions <= 0)) {
        return false;
      }
      if (categoryFilter !== 'All' && d.category !== categoryFilter) return false;
      if (loc && !d.location.toLowerCase().includes(loc)) return false;
      if (q) {
        const hay = `${d.title} ${d.description} ${d.category} ${d.dietaryInfo} ${d.location}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'portions-desc') {
      out.sort((a, b) => b.remainingPortions - a.remainingPortions);
    } else if (sortBy === 'newest') {
      out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      out.sort((a, b) => new Date(a.pickupDeadline).getTime() - new Date(b.pickupDeadline).getTime());
    }
    return out;
  }, [donations, searchQuery, categoryFilter, locationFilter, onlyAvailable, sortBy]);

  const openDonationForm = (editTarget?: FoodDonation) => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setEditingDonation(editTarget ?? null);
    setShowDonateModal(true);
  };

  const handleRequestFood = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!selectedDonation) return;
    if (isOwnerOfResource(user, selectedDonation.donorId, selectedDonation.donorUid)) {
      setReqError('You cannot request your own food donation.');
      return;
    }
    setReqError(null);
    setReqBusy(true);
    try {
      const payload = {
        donationId: selectedDonation.id,
        requestedPortions: Number(reqPortions),
        preferredTime,
        notes: reqNotes,
      };
      let apiId: string | null = null;
      try {
        const res = await api.createFoodRequest(payload);
        apiId = res.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      let fsId: string | null = null;
      if (selectedDonation.donorUid && auth.currentUser) {
        fsId = await createFoodRequestInFirestore(
          selectedDonation,
          user,
          {
            requestedPortions: payload.requestedPortions,
            preferredTime: payload.preferredTime,
            notes: payload.notes,
          },
          apiId || undefined
        );
      }
      if (!apiId && !fsId) {
        throw new Error('Unable to submit request. Please refresh and try again.');
      }
      setReqNotes('');
      onToast('Collection interest submitted. Donor will review and confirm via WhatsApp.');
      onSelectDonation(null);
      await onRefresh();
    } catch (err) {
      setReqError(err instanceof Error ? err.message : 'Unable to submit request.');
    } finally {
      setReqBusy(false);
    }
  };

  const hasMissingSafetyInfo = (d: FoodDonation) =>
    !d.preparedAt || !d.storageInfo.trim() || !d.allergens.trim();

  return (
    <div className="bg-[#0A110E] text-[#F4F7F4]">
      {/* Dark Botanical Food Rescue Hero Banner */}
      <section className="border-b border-[#A9B78D]/15 bg-[#0F1A15]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                VERDORA Food Rescue
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-[#F4F7F4] sm:text-4xl text-balance">
                Good Food Deserves Another Chance.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[#D2DDD6] sm:text-base">
                Connect surplus food with people and communities who can put it to good use.
                Disclose storage, packaging, allergens, and collection deadlines clearly.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => openDonationForm()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer focus-ring"
              >
                <Plus className="h-4 w-4" />
                <span>Donate Food</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSafetyGuide((p) => !p)}
                className="rounded-lg border border-[#A9B78D]/30 bg-[#172620] px-4 py-2.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
              >
                {showSafetyGuide ? 'Hide Handling Guide' : 'Learn How It Works'}
              </button>
            </div>
          </div>

          {showSafetyGuide && (
            <div className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-[#A9B78D]/20 bg-[#111C17] p-5 text-xs text-[#D2DDD6] md:grid-cols-3">
              <div>
                <h3 className="font-semibold text-[#93C9A3]">1. Honest Handling Disclosures</h3>
                <p className="mt-1 leading-relaxed">
                  Food Rescue is a coordination platform, not a food-safety certification system.
                  Donors should only offer food handled safely and state preparation time, storage,
                  and known allergens.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-[#93C9A3]">2. Protected Portion Locking</h3>
                <p className="mt-1 leading-relaxed">
                  When a donor accepts a request, remaining portions are atomically reserved so two
                  recipients cannot claim the same portions twice.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-[#93C9A3]">3. WhatsApp Handover</h3>
                <p className="mt-1 leading-relaxed">
                  Once accepted, donor and recipient confirm collection timing via WhatsApp and mark
                  the handover complete to update the impact ledger.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Filters */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 lg:grid-cols-12">
          <div className="relative lg:col-span-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search surplus food, dietary tags, area..."
              className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>
          <div className="lg:col-span-3">
            <select
              aria-label="Filter by food category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
            >
              <option value="All">All Food Categories</option>
              {foodCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-3">
            <input
              type="text"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              placeholder="Filter by neighborhood or city..."
              className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
            />
          </div>
          <div className="lg:col-span-2">
            <select
              aria-label="Sort food donations"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'deadline' | 'portions-desc' | 'newest')}
              className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
            >
              <option value="deadline">Soonest Deadline</option>
              <option value="portions-desc">Most Portions</option>
              <option value="newest">Recently Posted</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyAvailable((p) => !p)}
              className={`rounded-lg border px-3 py-1.5 font-medium cursor-pointer ${
                onlyAvailable
                  ? 'border-[#2B7A58] bg-[#2B7A58] text-white'
                  : 'border-[#A9B78D]/25 bg-[#111C17] text-[#D2DDD6] hover:bg-[#172620]'
              }`}
            >
              {onlyAvailable ? 'Available Only' : 'Showing All (incl. Expired/Completed)'}
            </button>
          </div>
          <div className="tabular-nums text-[#C8D6CD]">
            {filtered.length} {filtered.length === 1 ? 'donation' : 'donations'}
          </div>
        </div>

        {/* Donations Grid */}
        {filtered.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center">
            <h3 className="font-display text-xl font-semibold text-[#F4F7F4]">
              {donations.length === 0
                ? 'No food donations have been recorded yet.'
                : 'No active food donations match your filters'}
            </h3>
            <p className="mt-2 text-sm text-[#C8D6CD]">
              {donations.length === 0
                ? 'Registered restaurants and food donors can publish surplus food batches here.'
                : 'Adjust your search filters or check back as local kitchens post surplus items.'}
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {filtered.map((d) => {
              const expired = d.status === 'Expired' || isExpiredDate(d.pickupDeadline);
              const missingSafety = hasMissingSafetyInfo(d);
              return (
                <article
                  key={d.id}
                  className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[#A9B78D]/20 bg-[#111C17] sm:grid-cols-5"
                >
                  <div className="aspect-[4/3] sm:aspect-auto sm:col-span-2 bg-[#0D1612]">
                    <img
                      src={resolveImageSrc(d.imageUrl, 'bakery')}
                      alt={d.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col justify-between p-5 sm:col-span-3">
                    <div>
                      <div className="text-xs text-[#9BB0A3]">
                        {d.category} ·{' '}
                        <span className="tabular-nums font-medium text-[#93C9A3]">
                          {d.remainingPortions} / {d.portions} portions
                        </span>{' '}
                        · {expired ? 'Expired' : d.status}
                      </div>
                      <h3 className="mt-1 font-display text-xl font-semibold text-[#F4F7F4]">
                        {d.title}
                      </h3>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#D2DDD6]">
                        {d.description}
                      </p>

                      <div className="mt-3 space-y-1 text-xs text-[#C8D6CD]">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[#93C9A3]" />
                          <span>Collect by {formatDateTime(d.pickupDeadline)}</span>
                        </div>
                        <div>Location: {d.location}</div>
                        <div>
                          Allergens: {d.allergens || 'Not disclosed'} · Storage:{' '}
                          {d.storageInfo || 'Not specified'}
                        </div>
                      </div>

                      {missingSafety && (
                        <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-[#D99B38]/35 bg-[#2E230F] px-2.5 py-1.5 text-[11px] font-medium text-[#FAD089]">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            Some handling details (prep time, storage, or allergens) are missing. Confirm with donor before claiming.
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#A9B78D]/15 pt-3">
                      <span className="inline-flex items-center gap-1 text-xs text-[#C8D6CD]">
                        {d.donorName}
                        {d.donorVerified && <ShieldCheck className="h-3.5 w-3.5 text-[#93C9A3]" />}
                      </span>
                      <button
                        type="button"
                        disabled={expired || ['Completed', 'Cancelled'].includes(d.status) || d.remainingPortions <= 0}
                        onClick={() => {
                          setReqPortions(String(Math.min(10, d.remainingPortions)));
                          onSelectDonation(d);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-50 cursor-pointer"
                      >
                        <Utensils className="h-3.5 w-3.5" />
                        <span>{expired ? 'Expired' : 'View & Request'}</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* DONATION DETAIL MODAL */}
      {selectedDonation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="food-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
        >
          <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl sm:p-8">
            <button
              type="button"
              aria-label="Close donation details"
              onClick={() => onSelectDonation(null)}
              className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-[#F4F7F4] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
              <div className="md:col-span-5 space-y-4">
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-[#0D1612]">
                  <img
                    src={resolveImageSrc(selectedDonation.imageUrl, 'bakery')}
                    alt={selectedDonation.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="rounded-xl border border-[#A9B78D]/20 bg-[#172620] p-4 text-xs text-[#D2DDD6] space-y-2">
                  <div className="font-semibold text-[#93C9A3]">Handling & Safety Disclosures</div>
                  <div>
                    <span className="text-[#9BB0A3]">Prepared:</span>{' '}
                    {selectedDonation.preparedAt ? formatDateTime(selectedDonation.preparedAt) : 'Not disclosed'}
                  </div>
                  <div>
                    <span className="text-[#9BB0A3]">Storage:</span>{' '}
                    {selectedDonation.storageInfo || 'Not disclosed'}
                  </div>
                  <div>
                    <span className="text-[#9BB0A3]">Packaging:</span>{' '}
                    {selectedDonation.packagingInfo || 'Not disclosed'}
                  </div>
                  <div>
                    <span className="text-[#9BB0A3]">Allergens:</span>{' '}
                    <span className="font-medium text-[#F4F7F4]">
                      {selectedDonation.allergens || 'Not disclosed — verify directly'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#9BB0A3]">Dietary:</span>{' '}
                    {selectedDonation.dietaryInfo || 'General'}
                  </div>
                </div>
              </div>

              <div className="md:col-span-7">
                <div className="text-xs text-[#9BB0A3]">
                  {selectedDonation.category} ·{' '}
                  <span className="tabular-nums text-[#93C9A3]">
                    {selectedDonation.remainingPortions} of {selectedDonation.portions} portions left
                  </span>{' '}
                  ({selectedDonation.quantity} {selectedDonation.unit})
                </div>
                <h2 id="food-detail-title" className="mt-1 font-display text-2xl font-semibold text-[#F4F7F4]">
                  {selectedDonation.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#D2DDD6]">
                  {selectedDonation.description}
                </p>

                <div className="mt-4 space-y-1 text-xs text-[#C8D6CD]">
                  <div>
                    <strong className="text-[#F4F7F4]">Pickup Deadline:</strong> {formatDateTime(selectedDonation.pickupDeadline)}
                  </div>
                  <div>
                    <strong className="text-[#F4F7F4]">Location:</strong> {selectedDonation.location}
                  </div>
                  {selectedDonation.collectionInstructions && (
                    <div>
                      <strong className="text-[#F4F7F4]">Collection Instructions:</strong> {selectedDonation.collectionInstructions}
                    </div>
                  )}
                  <div>
                    <strong className="text-[#F4F7F4]">Donor:</strong> {selectedDonation.donorName}
                    {selectedDonation.donorOrganization ? ` (${selectedDonation.donorOrganization})` : ''}
                  </div>
                </div>

                {hasMissingSafetyInfo(selectedDonation) && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#D99B38]/35 bg-[#2E230F] p-3 text-xs text-[#FAD089]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Important food handling information is incomplete. Please verify freshness,
                      allergens, and storage directly with the donor before distributing.
                    </span>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {buildWhatsAppUrl(selectedDonation.whatsappNumber, 'food', selectedDonation.title) && (
                    <a
                      href={
                        buildWhatsAppUrl(
                          selectedDonation.whatsappNumber,
                          'food',
                          selectedDonation.title
                        )!
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-[#A9B78D]/30 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                    >
                      Contact Donor on WhatsApp
                    </a>
                  )}
                  {user &&
                    (isOwnerOfResource(user, selectedDonation.donorId, selectedDonation.donorUid) ||
                      user.role === 'admin') &&
                    (!['Completed', 'Cancelled', 'Expired'].includes(selectedDonation.status) ||
                      user.role === 'admin') && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = selectedDonation;
                          onSelectDonation(null);
                          openDonationForm(target);
                        }}
                        className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                      >
                        Edit Donation
                      </button>
                    )}
                  {user &&
                    (isOwnerOfResource(user, selectedDonation.donorId, selectedDonation.donorUid) ||
                      user.role === 'admin') &&
                    !['Completed', 'Cancelled', 'Expired'].includes(selectedDonation.status) && (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(selectedDonation)}
                        className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                      >
                        Cancel Donation
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
                        type: 'food',
                        id: selectedDonation.id,
                        title: selectedDonation.title,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs text-[#C8D6CD] hover:text-[#FCA5A5] cursor-pointer"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span>Report</span>
                  </button>
                </div>

                <form
                  onSubmit={handleRequestFood}
                  className="mt-5 rounded-xl border border-[#A9B78D]/20 bg-[#172620] p-4 space-y-3"
                >
                  <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                    Request Collection
                  </h3>
                  {reqError && (
                    <div className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2 text-xs text-[#FFB3B8]">
                      {reqError}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Portions Needed
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={selectedDonation.remainingPortions}
                        value={reqPortions}
                        onChange={(e) => setReqPortions(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] tabular-nums focus-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#D2DDD6]">
                        Arrival Window
                      </label>
                      <input
                        type="text"
                        required
                        value={preferredTime}
                        onChange={(e) => setPreferredTime(e.target.value)}
                        placeholder="e.g., 17:30 today"
                        className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#D2DDD6]">
                      Collection Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={reqNotes}
                      onChange={(e) => setReqNotes(e.target.value)}
                      placeholder="Community kitchen, shelter, or transport details"
                      className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={reqBusy || selectedDonation.remainingPortions <= 0}
                    className="w-full rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-50 cursor-pointer"
                  >
                    {reqBusy ? 'Submitting...' : 'Submit Food Rescue Request'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DONATE / EDIT FOOD MODAL */}
      <FoodDonationFormModal
        isOpen={showDonateModal}
        user={user}
        categories={categories}
        editingDonation={editingDonation}
        draftPrefill={draftPrefill}
        onClose={() => {
          setShowDonateModal(false);
          setEditingDonation(null);
          onClearDraftPrefill?.();
        }}
        onSaved={async (_donation, isEdit) => {
          onToast(
            isEdit
              ? 'Food donation updated.'
              : 'Food donation published to VERDORA Food Rescue.'
          );
          onClearDraftPrefill?.();
          await onRefresh();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        title="Cancel Food Donation"
        description={
          cancelTarget
            ? `Cancel "${cancelTarget.title}"? It will be hidden from active Food Rescue discovery while keeping your donation history.`
            : ''
        }
        confirmLabel="Cancel Donation"
        cancelLabel="Keep Donation"
        tone="danger"
        onClose={() => setCancelTarget(null)}
        onConfirm={async () => {
          if (!cancelTarget) return;
          let cancelledLocally = false;
          try {
            await api.cancelFoodDonation(cancelTarget.id);
            cancelledLocally = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message.toLowerCase() : '';
            if (!msg.includes('404') && !msg.includes('not found')) {
              throw err;
            }
          }
          const fsCancelled = await cancelFoodDonationInFirestore(cancelTarget.id).catch((err) => {
            if (!cancelledLocally) throw err;
            return null;
          });
          if (!cancelledLocally && !fsCancelled) {
            throw new Error('Could not cancel food donation.');
          }
          onSelectDonation(null);
          await onRefresh();
          onToast('Food donation cancelled.');
        }}
      />

      <ReportModal
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => onToast('Report submitted for moderation review.')}
      />
    </div>
  );
}
