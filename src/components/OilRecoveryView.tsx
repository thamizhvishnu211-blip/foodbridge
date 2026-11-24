import { Droplets, Flag, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { api } from '../services/api';
import {
  createOilEnquiryInFirestore,
  isOwnerOfResource,
  syncOilListingToFirestore,
} from '../services/firestoreSync';
import type { OilRecoveryListing, User } from '../types';
import { buildWhatsAppUrl, formatShortDate } from '../utils/format';
import { ReportModal } from './ReportModal';

interface OilRecoveryViewProps {
  user: User | null;
  listings: OilRecoveryListing[];
  onRefresh: () => Promise<void>;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
}

export function OilRecoveryView({
  user,
  listings,
  onRefresh,
  onRequireAuth,
  onToast,
}: OilRecoveryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [locationFilter, setLocationFilter] = useState('');

  const [selectedLot, setSelectedLot] = useState<OilRecoveryListing | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'oil'; id: string; title: string } | null>(null);

  // Create form
  const [title, setTitle] = useState('');
  const [oilType, setOilType] = useState('Used Cooking Oil (Sunflower / Vegetable)');
  const [volumeLiters, setVolumeLiters] = useState('120');
  const [qualityGrade, setQualityGrade] = useState('Filtered Commercial Grade');
  const [containerType, setContainerType] = useState('Sealed HDPE 200L Drum');
  const [filtrationStatus, setFiltrationStatus] = useState('Settled & Mesh-Filtered');
  const [pickupWindow, setPickupWindow] = useState('Weekdays 08:00–16:00 (Rear service dock)');
  const [location, setLocation] = useState(user?.location || '');
  const [whatsappNumber, setWhatsappNumber] = useState(user?.whatsappNumber ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Enquiry form
  const [reqLiters, setReqLiters] = useState('100');
  const [intendedProcessing, setIntendedProcessing] = useState('Biodiesel feedstock refining');
  const [preferredDate, setPreferredDate] = useState(
    new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)
  );
  const [enqNotes, setEnqNotes] = useState('');
  const [enqError, setEnqError] = useState<string | null>(null);
  const [enqBusy, setEnqBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const loc = locationFilter.trim().toLowerCase();
    return listings.filter((item) => {
      if (statusFilter !== 'All' && item.collectionStatus !== statusFilter) return false;
      if (loc && !item.location.toLowerCase().includes(loc)) return false;
      if (q) {
        const hay = `${item.title} ${item.oilType} ${item.supplierOrganization} ${item.location}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [listings, searchQuery, statusFilter, locationFilter]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await api.createOilListing({
        title,
        oilType,
        volumeLiters: Number(volumeLiters),
        qualityGrade,
        containerType,
        filtrationStatus,
        pickupWindow,
        location,
        whatsappNumber: whatsappNumber || null,
      });
      await syncOilListingToFirestore({
        ...res.listing,
        supplierUid: res.listing.supplierUid || auth.currentUser?.uid || user.firebaseUid || undefined,
      }).catch(() => {});
      setTitle('');
      setShowCreateModal(false);
      onToast('Used cooking oil lot published.');
      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to publish oil lot.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitEnquiry = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedLot) return;
    if (!user) {
      onRequireAuth();
      return;
    }
    if (isOwnerOfResource(user, selectedLot.supplierId, selectedLot.supplierUid)) {
      setEnqError('You cannot submit an enquiry on your own oil recovery lot.');
      return;
    }
    setEnqError(null);
    setEnqBusy(true);
    try {
      const payload = {
        listingId: selectedLot.id,
        requestedLiters: Number(reqLiters),
        intendedProcessing,
        preferredCollectionDate: preferredDate,
        notes: enqNotes,
      };
      let apiId: string | null = null;
      try {
        const res = await api.createOilEnquiry(payload);
        apiId = res.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      let fsId: string | null = null;
      if (selectedLot.supplierUid && auth.currentUser) {
        fsId = await createOilEnquiryInFirestore(
          selectedLot,
          user,
          {
            requestedLiters: payload.requestedLiters,
            intendedProcessing: payload.intendedProcessing,
            preferredCollectionDate: payload.preferredCollectionDate,
            notes: payload.notes,
          },
          apiId || undefined
        );
      }
      if (!apiId && !fsId) {
        throw new Error('Could not submit enquiry. Please refresh and try again.');
      }
      setSelectedLot(null);
      setEnqNotes('');
      onToast('Industrial buyer enquiry submitted. Track collection in Workspace.');
      await onRefresh();
    } catch (err) {
      setEnqError(err instanceof Error ? err.message : 'Could not submit enquiry.');
    } finally {
      setEnqBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-8 text-[#F4F7F4]">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#A9B78D]/15 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#D9BA7E]">
            VERDORA Circular Feedstock
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-[#F4F7F4] sm:text-4xl">
            Used Cooking Oil Recovery
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[#C8D6CD]">
            Connect restaurants and commercial kitchens with registered industrial buyers and
            biodiesel or oleochemical recyclers. Zero online payment fees.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!user) {
              onRequireAuth();
              return;
            }
            setShowCreateModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] self-start cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>List Used Cooking Oil Lot</span>
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search oil type, kitchen, or lot..."
            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
        >
          <option value="All">All Collection Statuses</option>
          <option value="Available">Available</option>
          <option value="Enquiry Pending">Enquiry Pending</option>
          <option value="Scheduled">Scheduled</option>
          <option value="Collected">Collected</option>
          <option value="Processed">Processed</option>
        </select>
        <input
          type="text"
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          placeholder="Filter by city or district"
          className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
        />
      </div>

      {/* Grid / Empty State */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center">
          <Droplets className="mx-auto h-8 w-8 text-[#D9BA7E]" />
          <h2 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
            No used cooking oil lots recorded yet.
          </h2>
          <p className="mt-1 text-xs text-[#C8D6CD]">
            Registered restaurants and food suppliers can publish used cooking oil collection lots
            for industrial buyers and recyclers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((lot) => {
            const waUrl = buildWhatsAppUrl(lot.whatsappNumber, 'oil', lot.title);
            return (
              <article
                key={lot.id}
                className="flex flex-col justify-between rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6"
              >
                <div>
                  <div className="text-xs text-[#9BB0A3]">
                    {lot.oilType} · <span className="font-mono-tabular font-semibold text-[#D9BA7E]">{lot.volumeLiters} L</span> · {lot.collectionStatus}
                  </div>
                  <h3 className="mt-1.5 font-display text-xl font-semibold text-[#F4F7F4]">
                    {lot.title}
                  </h3>
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-[#D2DDD6]">
                    <span>{lot.supplierOrganization || lot.supplierName}</span>
                    {lot.supplierVerified && <ShieldCheck className="h-3.5 w-3.5 text-[#93C9A3]" />}
                  </div>
                  <dl className="mt-4 space-y-1.5 border-t border-[#A9B78D]/15 pt-3 text-xs text-[#9BB0A3]">
                    <div className="flex justify-between gap-2">
                      <dt>Quality / Filtration</dt>
                      <dd className="text-right font-medium text-[#F4F7F4]">
                        {lot.qualityGrade} · {lot.filtrationStatus}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Container</dt>
                      <dd className="text-right text-[#D2DDD6]">{lot.containerType}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Location</dt>
                      <dd className="text-right text-[#D2DDD6]">{lot.location}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Pickup Window</dt>
                      <dd className="text-right text-[#D2DDD6]">{lot.pickupWindow}</dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-5 flex items-center gap-2 border-t border-[#A9B78D]/15 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLot(lot);
                      setReqLiters(String(lot.volumeLiters));
                      setEnqError(null);
                    }}
                    className="flex-1 rounded-lg bg-[#2B7A58] px-3 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                  >
                    Submit Buyer Enquiry
                  </button>
                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Detail & Enquiry Modal */}
      {selectedLot && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
        >
          <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl sm:p-7">
            <button
              type="button"
              aria-label="Close oil lot dialog"
              onClick={() => setSelectedLot(null)}
              className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-[#F4F7F4] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="text-xs text-[#9BB0A3]">
              {selectedLot.oilType} · {selectedLot.collectionStatus} · Listed {formatShortDate(selectedLot.createdAt)}
            </div>
            <h2 className="mt-1 font-display text-2xl font-semibold text-[#F4F7F4]">
              {selectedLot.title}
            </h2>
            <p className="mt-1 text-xs text-[#C8D6CD]">
              Supplier: {selectedLot.supplierOrganization || selectedLot.supplierName} · {selectedLot.location}
            </p>

            <div className="mt-4 rounded-xl border border-[#A9B78D]/20 bg-[#172620] p-4 text-xs text-[#D2DDD6] space-y-1.5">
              <div><strong className="text-[#F4F7F4]">Volume:</strong> <span className="font-mono-tabular text-[#D9BA7E]">{selectedLot.volumeLiters} L</span></div>
              <div><strong className="text-[#F4F7F4]">Quality Grade:</strong> {selectedLot.qualityGrade}</div>
              <div><strong className="text-[#F4F7F4]">Filtration:</strong> {selectedLot.filtrationStatus}</div>
              <div><strong className="text-[#F4F7F4]">Storage Container:</strong> {selectedLot.containerType}</div>
              <div><strong className="text-[#F4F7F4]">Pickup Window:</strong> {selectedLot.pickupWindow}</div>
            </div>

            {enqError && (
              <div className="mt-4 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs text-[#FFB3B8]">
                {enqError}
              </div>
            )}

            <form onSubmit={handleSubmitEnquiry} className="mt-5 space-y-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">
                    Requested Volume (Liters)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={selectedLot.volumeLiters}
                    required
                    value={reqLiters}
                    onChange={(e) => setReqLiters(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">
                    Preferred Collection Date
                  </label>
                  <input
                    type="date"
                    required
                    value={preferredDate}
                    onChange={(e) => setPreferredDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  Intended Processing Application
                </label>
                <input
                  type="text"
                  required
                  value={intendedProcessing}
                  onChange={(e) => setIntendedProcessing(e.target.value)}
                  placeholder="e.g., Biodiesel transesterification, industrial soapstock"
                  className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  Collection & Tanker Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={enqNotes}
                  onChange={(e) => setEnqNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!user) {
                      onRequireAuth();
                      return;
                    }
                    setReportTarget({ type: 'oil', id: selectedLot.id, title: selectedLot.title });
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-[#C8D6CD] hover:text-[#FCA5A5] cursor-pointer"
                >
                  <Flag className="h-3.5 w-3.5" />
                  <span>Report Listing</span>
                </button>
                <button
                  type="submit"
                  disabled={enqBusy}
                  className="rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
                >
                  {enqBusy ? 'Submitting...' : 'Submit Collection Enquiry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Oil Lot Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
        >
          <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl sm:p-7">
            <button
              type="button"
              aria-label="Close publish oil lot modal"
              onClick={() => setShowCreateModal(false)}
              className="absolute right-4 top-4 rounded-lg p-2 text-[#C8D6CD] hover:bg-[#172620] hover:text-[#F4F7F4] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
              Publish Used Cooking Oil Lot
            </h2>
            <p className="mt-1 text-xs text-[#C8D6CD]">
              List kitchen oil volume, filtration state, and container details for verified buyers.
            </p>

            {formError && (
              <div className="mt-4 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-2.5 text-xs text-[#FFB3B8]">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreate} className="mt-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">Lot Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Filtered Kitchen Fryer Oil — 2 Drums"
                  className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Oil Type</label>
                  <input
                    type="text"
                    required
                    value={oilType}
                    onChange={(e) => setOilType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Volume (Liters)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={volumeLiters}
                    onChange={(e) => setVolumeLiters(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Quality Grade</label>
                  <input
                    type="text"
                    required
                    value={qualityGrade}
                    onChange={(e) => setQualityGrade(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Container Type</label>
                  <input
                    type="text"
                    required
                    value={containerType}
                    onChange={(e) => setContainerType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Filtration Status</label>
                  <input
                    type="text"
                    required
                    value={filtrationStatus}
                    onChange={(e) => setFiltrationStatus(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">City / Location</label>
                  <input
                    type="text"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City & neighborhood"
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">Pickup Window</label>
                  <input
                    type="text"
                    required
                    value={pickupWindow}
                    onChange={(e) => setPickupWindow(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#D2DDD6]">WhatsApp Contact</label>
                  <input
                    type="tel"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="+919876543210"
                    className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[#2B7A58] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
              >
                {submitting ? 'Publishing...' : 'Publish Oil Recovery Lot'}
              </button>
            </form>
          </div>
        </div>
      )}

      {reportTarget && (
        <ReportModal
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            setReportTarget(null);
            onToast('Report submitted for administrator review.');
          }}
        />
      )}
    </div>
  );
}
