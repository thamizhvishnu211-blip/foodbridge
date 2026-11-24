import {
  Bell,
  CheckCircle2,
  Droplets,
  LogOut,
  Shield,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { signOutFirebase } from '../firebase';
import { api } from '../services/api';
import {
  cancelFoodDonationInFirestore,
  cancelMaterialInFirestore,
  fetchWorkspaceRequestsFromFirestore,
  isOwnerOfResource,
  mergeCatalogItems,
  syncMaterialToFirestore,
  syncOilListingToFirestore,
  updateFoodRequestStatusInFirestore,
  updateMaterialRequestStatusInFirestore,
  updateOilEnquiryStatusInFirestore,
} from '../services/firestoreSync';
import type {
  AccountType,
  Category,
  FoodDonation,
  FoodRequest,
  MaterialListing,
  MaterialRequest,
  NotificationItem,
  OilBuyerEnquiry,
  OilRecoveryListing,
  User,
} from '../types';
import { buildWhatsAppUrl, formatAccountType, formatDateTime } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { FoodDonationFormModal } from './FoodDonationFormModal';
import { MaterialFormModal } from './MaterialFormModal';

interface WorkspaceViewProps {
  user: User | null;
  categories: Category[];
  materials: MaterialListing[];
  donations: FoodDonation[];
  oilListings: OilRecoveryListing[];
  onRefreshAll: () => Promise<void>;
  onUserUpdated: (user: User | null) => void;
  onRequireAuth: () => void;
  onToast: (msg: string) => void;
  onOpenAdmin: () => void;
}

const MATERIAL_TIMELINE = [
  'Request Created',
  'Accepted',
  'Coordination In Progress',
  'Pickup Scheduled',
  'Collected',
  'Completed',
];

const FOOD_TIMELINE = [
  'Request Received',
  'Accepted',
  'Coordination In Progress',
  'Pickup Scheduled',
  'Completed',
];

const OIL_TIMELINE = ['Pending', 'Accepted', 'Scheduled', 'Collected', 'Completed'];

export function WorkspaceView({
  user,
  categories,
  materials,
  donations,
  oilListings,
  onRefreshAll,
  onUserUpdated,
  onRequireAuth,
  onToast,
  onOpenAdmin,
}: WorkspaceViewProps) {
  const [subTab, setSubTab] = useState<'coordination' | 'listings' | 'trust'>('coordination');
  const [matRequests, setMatRequests] = useState<MaterialRequest[]>([]);
  const [foodRequests, setFoodRequests] = useState<FoodRequest[]>([]);
  const [oilEnquiries, setOilEnquiries] = useState<OilBuyerEnquiry[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Profile form
  const [accountTypeInput, setAccountTypeInput] = useState<Exclude<AccountType, 'admin'>>(
    user?.accountType && user.accountType !== 'admin' ? user.accountType : 'general_user'
  );
  const [orgInput, setOrgInput] = useState(user?.organization ?? '');
  const [locInput, setLocInput] = useState(user?.location ?? '');
  const [waInput, setWaInput] = useState(user?.whatsappNumber ?? '');
  const [publicBoard, setPublicBoard] = useState(user?.publicLeaderboard ?? true);

  // Verification form
  const [verOrg, setVerOrg] = useState(user?.organization ?? '');
  const [verMaterials, setVerMaterials] = useState('');
  const [verSummary, setVerSummary] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<MaterialListing | null>(null);
  const [editingDonation, setEditingDonation] = useState<FoodDonation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    type: 'material' | 'food';
    id: string;
    title: string;
  } | null>(null);

  const loadWorkspaceData = async () => {
    if (!user) return;
    try {
      const [mr, fr, oe, ntf, fsReqs] = await Promise.all([
        api.getMaterialRequests(),
        api.getFoodRequests(),
        api.getOilEnquiries(),
        api.getNotifications(),
        fetchWorkspaceRequestsFromFirestore().catch(() => ({
          materialRequests: [] as MaterialRequest[],
          foodRequests: [] as FoodRequest[],
          oilEnquiries: [] as OilBuyerEnquiry[],
        })),
      ]);
      setMatRequests(mergeCatalogItems(mr.requests, fsReqs.materialRequests));
      setFoodRequests(mergeCatalogItems(fr.requests, fsReqs.foodRequests));
      setOilEnquiries(mergeCatalogItems(oe.enquiries, fsReqs.oilEnquiries));
      setNotifications(ntf.notifications);
    } catch {
      // ignore transient auth transition errors
    }
  };

  useEffect(() => {
    if (user) {
      setAccountTypeInput(user.accountType !== 'admin' ? user.accountType : 'general_user');
      setOrgInput(user.organization);
      setLocInput(user.location);
      setWaInput(user.whatsappNumber ?? '');
      setPublicBoard(user.publicLeaderboard);
      setVerOrg(user.organization);
      void loadWorkspaceData();
    }
  }, [user?.id, user?.role, user?.accountType]);

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10">
          <h1 className="font-display text-3xl font-semibold text-[#F4F7F4]">
            Sign in to access your VERDORA Workspace
          </h1>
          <p className="mt-2 text-sm text-[#C8D6CD]">
            Manage your material listings, food donations, oil recovery enquiries, pickup schedules,
            verification requests, and notifications.
          </p>
          <button
            type="button"
            onClick={onRequireAuth}
            className="mt-6 rounded-lg bg-[#2B7A58] px-6 py-3 text-sm font-semibold text-white hover:bg-[#348F68] cursor-pointer"
          >
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  const myListings = materials.filter((m) => isOwnerOfResource(user, m.sellerId, m.sellerUid));
  const myDonations = donations.filter((d) => isOwnerOfResource(user, d.donorId, d.donorUid));
  const myOilListings = oilListings.filter((o) =>
    isOwnerOfResource(user, o.supplierId, o.supplierUid)
  );

  const handleMaterialReqAction = async (id: string, status: string) => {
    setBusyId(id);
    try {
      let updatedApi = false;
      try {
        await api.updateMaterialRequestStatus(id, { status });
        updatedApi = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      const target = matRequests.find((r) => r.id === id);
      let updatedFs = false;
      if (target) {
        updatedFs = await updateMaterialRequestStatusInFirestore(target, status, user);
      }
      if (!updatedApi && !updatedFs) {
        throw new Error('Could not update material request.');
      }
      onToast(`Material request updated to ${status}.`);
      await Promise.all([loadWorkspaceData(), onRefreshAll()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleFoodReqAction = async (id: string, status: string) => {
    setBusyId(id);
    try {
      let updatedApi = false;
      try {
        await api.updateFoodRequestStatus(id, { status });
        updatedApi = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      const target = foodRequests.find((r) => r.id === id);
      let updatedFs = false;
      if (target) {
        updatedFs = await updateFoodRequestStatusInFirestore(target, status, user);
      }
      if (!updatedApi && !updatedFs) {
        throw new Error('Could not update food request.');
      }
      onToast(`Food request updated to ${status}.`);
      await Promise.all([loadWorkspaceData(), onRefreshAll()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleOilEnquiryAction = async (id: string, status: string) => {
    setBusyId(id);
    try {
      let updatedApi = false;
      try {
        await api.updateOilEnquiryStatus(id, { status });
        updatedApi = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      const target = oilEnquiries.find((r) => r.id === id);
      let updatedFs = false;
      if (target) {
        updatedFs = await updateOilEnquiryStatusInFirestore(target, status, user);
      }
      if (!updatedApi && !updatedFs) {
        throw new Error('Could not update oil enquiry.');
      }
      onToast(`Oil recovery enquiry updated to ${status}.`);
      await Promise.all([loadWorkspaceData(), onRefreshAll()]);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleListingStatusChange = async (id: string, status: string) => {
    setBusyId(id);
    try {
      let updatedListing: MaterialListing | null = null;
      try {
        const res = await api.updateMaterial(id, { status });
        updatedListing = res.listing;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      const fallback = materials.find((m) => m.id === id);
      const merged = updatedListing || (fallback ? { ...fallback, status: status as MaterialListing['status'] } : null);
      if (merged) {
        await syncMaterialToFirestore(merged);
      }
      onToast(`Listing marked ${status}.`);
      await onRefreshAll();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update listing.');
    } finally {
      setBusyId(null);
    }
  };

  const handleOilStatusChange = async (id: string, collectionStatus: string) => {
    setBusyId(id);
    try {
      let updatedLot: OilRecoveryListing | null = null;
      try {
        const res = await api.updateOilListing(id, { collectionStatus });
        updatedLot = res.listing;
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (!msg.includes('404') && !msg.includes('not found')) {
          throw err;
        }
      }
      const fallback = oilListings.find((o) => o.id === id);
      const merged =
        updatedLot ||
        (fallback ? { ...fallback, collectionStatus: collectionStatus as OilRecoveryListing['collectionStatus'] } : null);
      if (merged) {
        await syncOilListingToFirestore(merged);
      }
      onToast(`Oil lot marked ${collectionStatus}.`);
      await onRefreshAll();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update oil lot.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.updateProfile({
        ...(user.role !== 'admin' ? { accountType: accountTypeInput } : {}),
        organization: orgInput,
        location: locInput,
        whatsappNumber: waInput || null,
        publicLeaderboard: publicBoard,
      });
      onUserUpdated(res.user);
      onToast('Profile settings saved.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not update profile.');
    }
  };

  const handleVerificationSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.submitVerification({
        organization: verOrg,
        materialsHandled: verMaterials,
        businessSummary: verSummary,
      });
      setVerMaterials('');
      setVerSummary('');
      onToast('Verification request submitted for administrator review.');
      const me = await api.getMe();
      onUserUpdated(me.user);
      await loadWorkspaceData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Submission failed.');
    }
  };

  const handleLogout = async () => {
    await signOutFirebase();
    await api.logout();
    onUserUpdated(null);
    onToast('Signed out.');
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#A9B78D]/15 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
              className="h-12 w-12 shrink-0 rounded-full border border-[#A9B78D]/25 object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#2B7A58] font-display text-lg font-semibold text-white">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-xs text-[#9BB0A3]">
              {formatAccountType(user.accountType)} · {user.organization || 'Individual Account'} ·{' '}
              <span className="text-[#D2DDD6]">{user.accountStatus}</span> ·{' '}
              <span className="font-mono-tabular font-semibold text-[#93C9A3]">{user.points} pts</span>
            </div>
            <h1 className="mt-1 font-display text-3xl font-semibold text-[#F4F7F4]">{user.name}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start">
          {user.role === 'admin' && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="inline-flex whitespace-nowrap items-center gap-2 rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
            >
              <Shield className="h-3.5 w-3.5" />
              <span>Open Admin Dashboard</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex whitespace-nowrap items-center gap-2 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSubTab('coordination')}
          className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer ${
            subTab === 'coordination'
              ? 'bg-[#2B7A58] text-white'
              : 'border border-[#A9B78D]/20 bg-[#111C17] text-[#C8D6CD] hover:text-white'
          }`}
        >
          Pickup & Handovers ({matRequests.length + foodRequests.length + oilEnquiries.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('listings')}
          className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer ${
            subTab === 'listings'
              ? 'bg-[#2B7A58] text-white'
              : 'border border-[#A9B78D]/20 bg-[#111C17] text-[#C8D6CD] hover:text-white'
          }`}
        >
          My Listings, Donations & Oil Lots ({myListings.length + myDonations.length + myOilListings.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('trust')}
          className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer ${
            subTab === 'trust'
              ? 'bg-[#2B7A58] text-white'
              : 'border border-[#A9B78D]/20 bg-[#111C17] text-[#C8D6CD] hover:text-white'
          }`}
        >
          Profile, Verification & Notifications
        </button>
      </div>

      {/* TAB 1: PICKUP & HANDOVER COORDINATION */}
      {subTab === 'coordination' && (
        <div className="space-y-8">
          {/* Material Requests */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-[#93C9A3]" />
              <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
                Material Pickup & Delivery Coordination
              </h2>
            </div>

            {matRequests.length === 0 ? (
              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-8 text-sm text-[#C8D6CD]">
                No active material requests yet. Browse the Marketplace to request a reusable batch.
              </div>
            ) : (
              <div className="space-y-4">
                {matRequests.map((req) => {
                  const isSeller = isOwnerOfResource(user, req.sellerId, req.sellerUid);
                  const isBuyer = isOwnerOfResource(user, req.buyerId, req.buyerUid);
                  const terminal = ['Completed', 'Declined', 'Cancelled'].includes(req.status);
                  const stepIdx = MATERIAL_TIMELINE.indexOf(req.status);
                  const counterpartyPhone = isSeller ? req.buyerWhatsapp : req.sellerWhatsapp;
                  const waUrl = buildWhatsAppUrl(counterpartyPhone, 'material', req.listingTitle);

                  return (
                    <div
                      key={req.id}
                      className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5 space-y-4"
                    >
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                        <div>
                          <div className="text-xs text-[#9BB0A3]">
                            {isSeller ? `Incoming from ${req.buyerName}` : `Requested from ${req.sellerName}`} ·{' '}
                            {req.arrangement} · {req.preferredDate} at {req.preferredTime}
                          </div>
                          <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F7F4]">
                            {req.listingTitle} —{' '}
                            <span className="font-mono-tabular text-[#93C9A3]">
                              {req.requestedQuantity} {req.listingUnit}
                            </span>
                          </h3>
                          <p className="mt-1 text-xs text-[#C8D6CD]">
                            Intended use: {req.intendedUse}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-[#93C9A3]">{req.status}</span>
                      </div>

                      {!['Declined', 'Cancelled'].includes(req.status) && (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                          {MATERIAL_TIMELINE.map((step, i) => {
                            const reached = stepIdx >= i;
                            return (
                              <div
                                key={step}
                                className={`border-t-2 pt-1.5 text-[11px] ${
                                  reached
                                    ? 'border-[#76B88D] font-semibold text-[#93C9A3]'
                                    : 'border-[#A9B78D]/20 text-[#9BB0A3]'
                                }`}
                              >
                                {step}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t border-[#A9B78D]/15 pt-3">
                        {!terminal && isSeller && req.status === 'Request Created' && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => void handleMaterialReqAction(req.id, 'Accepted')}
                              className="rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                            >
                              Accept Request
                            </button>
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => void handleMaterialReqAction(req.id, 'Declined')}
                              className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-1.5 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                            >
                              Decline
                            </button>
                          </>
                        )}
                        {!terminal && (isSeller || isBuyer) && req.status === 'Accepted' && (
                          <button
                            type="button"
                            disabled={busyId === req.id}
                            onClick={() => void handleMaterialReqAction(req.id, 'Pickup Scheduled')}
                            className="rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                          >
                            Confirm Pickup Schedule
                          </button>
                        )}
                        {!terminal &&
                          ['Accepted', 'Coordination In Progress', 'Pickup Scheduled', 'Collected'].includes(
                            req.status
                          ) && (
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => void handleMaterialReqAction(req.id, 'Completed')}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Confirm Completed Handover</span>
                            </button>
                          )}
                        {!terminal && isBuyer && (
                          <button
                            type="button"
                            disabled={busyId === req.id}
                            onClick={() => void handleMaterialReqAction(req.id, 'Cancelled')}
                            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-medium text-[#D2DDD6] hover:bg-[#21362D] cursor-pointer"
                          >
                            Cancel Request
                          </button>
                        )}
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                          >
                            WhatsApp Counterparty
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Food Rescue Requests */}
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
              Food Rescue Collection Coordination
            </h2>
            {foodRequests.length === 0 ? (
              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-8 text-sm text-[#C8D6CD]">
                No food rescue requests yet.
              </div>
            ) : (
              <div className="space-y-4">
                {foodRequests.map((req) => {
                  const isDonor = isOwnerOfResource(user, req.donorId, req.donorUid);
                  const terminal = ['Completed', 'Declined', 'Cancelled'].includes(req.status);
                  const stepIdx = FOOD_TIMELINE.indexOf(req.status);
                  const waUrl = buildWhatsAppUrl(
                    isDonor ? req.recipientWhatsapp : req.donorWhatsapp,
                    'food',
                    req.donationTitle
                  );

                  return (
                    <div
                      key={req.id}
                      className="rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] p-5 space-y-4"
                    >
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                        <div>
                          <div className="text-xs text-[#9BB0A3]">
                            {isDonor
                              ? `Recipient: ${req.recipientName}`
                              : `Donor: ${req.donorName}`}{' '}
                            · Arrival: {req.preferredTime} · Deadline: {formatDateTime(req.pickupDeadline)}
                          </div>
                          <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F7F4]">
                            {req.donationTitle} —{' '}
                            <span className="font-mono-tabular text-[#93C9A3]">{req.requestedPortions} portions</span>
                          </h3>
                        </div>
                        <span className="text-xs font-semibold text-[#93C9A3]">{req.status}</span>
                      </div>

                      {!['Declined', 'Cancelled'].includes(req.status) && (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {FOOD_TIMELINE.map((step, i) => (
                            <div
                              key={step}
                              className={`border-t-2 pt-1.5 text-[11px] ${
                                stepIdx >= i
                                  ? 'border-[#76B88D] font-semibold text-[#93C9A3]'
                                  : 'border-[#A9B78D]/20 text-[#9BB0A3]'
                              }`}
                            >
                              {step}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t border-[#A9B78D]/15 pt-3">
                        {!terminal && isDonor && req.status === 'Request Received' && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => void handleFoodReqAction(req.id, 'Accepted')}
                              className="rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                            >
                              Accept & Reserve Portions
                            </button>
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => void handleFoodReqAction(req.id, 'Declined')}
                              className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-1.5 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                            >
                              Decline
                            </button>
                          </>
                        )}
                        {!terminal &&
                          ['Accepted', 'Coordination In Progress', 'Pickup Scheduled'].includes(req.status) && (
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => void handleFoodReqAction(req.id, 'Completed')}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Confirm Handover</span>
                            </button>
                          )}
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                          >
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Used Cooking Oil Enquiries */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-[#D9BA7E]" />
              <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
                Used Cooking Oil Collection Coordination
              </h2>
            </div>
            {oilEnquiries.length === 0 ? (
              <div className="rounded-2xl border border-[#D9BA7E]/25 bg-[#111C17] p-8 text-sm text-[#C8D6CD]">
                No used cooking oil enquiries recorded yet.
              </div>
            ) : (
              <div className="space-y-4">
                {oilEnquiries.map((oe) => {
                  const isSupplier = isOwnerOfResource(user, oe.supplierId, oe.supplierUid);
                  const terminal = ['Completed', 'Declined', 'Cancelled'].includes(oe.status);
                  const stepIdx = OIL_TIMELINE.indexOf(oe.status);
                  const waUrl = buildWhatsAppUrl(
                    isSupplier ? oe.buyerWhatsapp : oe.supplierWhatsapp,
                    'oil',
                    oe.listingTitle
                  );

                  return (
                    <div
                      key={oe.id}
                      className="rounded-2xl border border-[#D9BA7E]/25 bg-[#111C17] p-5 space-y-4"
                    >
                      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                        <div>
                          <div className="text-xs text-[#9BB0A3]">
                            {isSupplier
                              ? `Industrial Buyer: ${oe.buyerName}${oe.buyerOrganization ? ` (${oe.buyerOrganization})` : ''}`
                              : `Supplier: ${oe.supplierName}`}{' '}
                            · Collection: {oe.preferredCollectionDate} · {oe.intendedProcessing}
                          </div>
                          <h3 className="mt-1 font-display text-lg font-semibold text-[#F4F7F4]">
                            {oe.listingTitle} —{' '}
                            <span className="font-mono-tabular text-[#D9BA7E]">{oe.requestedLiters} L</span>
                          </h3>
                        </div>
                        <span className="text-xs font-semibold text-[#D9BA7E]">{oe.status}</span>
                      </div>

                      {!['Declined', 'Cancelled'].includes(oe.status) && (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {OIL_TIMELINE.map((step, i) => (
                            <div
                              key={step}
                              className={`border-t-2 pt-1.5 text-[11px] ${
                                stepIdx >= i
                                  ? 'border-[#D9BA7E] font-semibold text-[#D9BA7E]'
                                  : 'border-[#A9B78D]/20 text-[#9BB0A3]'
                              }`}
                            >
                              {step}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t border-[#A9B78D]/15 pt-3">
                        {!terminal && isSupplier && oe.status === 'Pending' && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === oe.id}
                              onClick={() => void handleOilEnquiryAction(oe.id, 'Accepted')}
                              className="rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                            >
                              Accept Enquiry
                            </button>
                            <button
                              type="button"
                              disabled={busyId === oe.id}
                              onClick={() => void handleOilEnquiryAction(oe.id, 'Declined')}
                              className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3.5 py-1.5 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                            >
                              Decline
                            </button>
                          </>
                        )}
                        {!terminal && oe.status === 'Accepted' && (
                          <button
                            type="button"
                            disabled={busyId === oe.id}
                            onClick={() => void handleOilEnquiryAction(oe.id, 'Scheduled')}
                            className="rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                          >
                            Confirm Collection Schedule
                          </button>
                        )}
                        {!terminal && ['Accepted', 'Scheduled', 'Collected'].includes(oe.status) && (
                          <button
                            type="button"
                            disabled={busyId === oe.id}
                            onClick={() => void handleOilEnquiryAction(oe.id, 'Completed')}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#2B7A58] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Confirm Oil Recovery Complete</span>
                          </button>
                        )}
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                          >
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: MY LISTINGS, DONATIONS & OIL LOTS */}
      {subTab === 'listings' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
              My Material Listings ({myListings.length})
            </h2>
            {myListings.length === 0 ? (
              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 text-sm text-[#C8D6CD]">
                You have not published any material listings yet.
              </div>
            ) : (
              myListings.map((m) => {
                const isTerminal = m.status === 'Completed' || m.status === 'Cancelled';
                return (
                  <div
                    key={m.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5"
                  >
                    <div>
                      <div className="text-xs text-[#9BB0A3]">
                        {m.category} · {m.quantity} {m.unit} · Status:{' '}
                        <strong className="text-[#93C9A3]">{m.status}</strong>
                      </div>
                      <div className="mt-1 font-display text-lg font-semibold text-[#F4F7F4]">
                        {m.title}
                      </div>
                      {m.isHidden && (
                        <div className="mt-1 text-xs text-[#FFB3B8]">
                          Hidden from public discovery: {m.hiddenReason || 'Pending administrator review'}
                        </div>
                      )}
                    </div>
                    {isTerminal ? (
                      <div className="text-xs text-[#9BB0A3]">
                        Listing {m.status.toLowerCase()} — preserved in history.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === m.id}
                          onClick={() => setEditingMaterial(m)}
                          className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                        >
                          Edit
                        </button>
                        {m.status === 'Active' ? (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => void handleListingStatusChange(m.id, 'Paused')}
                            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                          >
                            Pause
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => void handleListingStatusChange(m.id, 'Active')}
                            className="rounded-lg bg-[#2B7A58] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                          >
                            Reactivate
                          </button>
                        )}
                        {m.status !== 'Unavailable' && (
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => void handleListingStatusChange(m.id, 'Unavailable')}
                            className="rounded-lg border border-[#A9B78D]/20 bg-[#0D1612] px-3 py-1.5 text-xs text-[#C8D6CD] hover:text-white cursor-pointer"
                          >
                            Mark Unavailable
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === m.id}
                          onClick={() =>
                            setCancelTarget({ type: 'material', id: m.id, title: m.title })
                          }
                          className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-1.5 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                        >
                          Cancel Listing
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
              My Food Donations ({myDonations.length})
            </h2>
            {myDonations.length === 0 ? (
              <div className="rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] p-6 text-sm text-[#C8D6CD]">
                You have not posted any food donations yet.
              </div>
            ) : (
              myDonations.map((d) => {
                const isTerminal = ['Completed', 'Cancelled', 'Expired'].includes(d.status);
                return (
                  <div
                    key={d.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] p-5"
                  >
                    <div>
                      <div className="text-xs text-[#9BB0A3]">
                        {d.category} · {d.remainingPortions} / {d.portions} portions remaining ·{' '}
                        <strong className="text-[#93C9A3]">{d.status}</strong>
                      </div>
                      <div className="mt-1 font-display text-lg font-semibold text-[#F4F7F4]">
                        {d.title}
                      </div>
                      <div className="mt-1 text-xs text-[#C8D6CD]">
                        Deadline: {formatDateTime(d.pickupDeadline)}
                      </div>
                      {d.isHidden && (
                        <div className="mt-1 text-xs text-[#FFB3B8]">
                          Hidden from public discovery: {d.hiddenReason || 'Pending administrator review'}
                        </div>
                      )}
                    </div>
                    {isTerminal ? (
                      <div className="text-xs text-[#9BB0A3]">
                        Donation {d.status.toLowerCase()} — preserved in history.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === d.id}
                          onClick={() => setEditingDonation(d)}
                          className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyId === d.id}
                          onClick={() =>
                            setCancelTarget({ type: 'food', id: d.id, title: d.title })
                          }
                          className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-1.5 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                        >
                          Cancel Donation
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
              My Oil Recovery Lots ({myOilListings.length})
            </h2>
            {myOilListings.length === 0 ? (
              <div className="rounded-2xl border border-[#D9BA7E]/25 bg-[#111C17] p-6 text-sm text-[#C8D6CD]">
                You have not published any used cooking oil recovery lots yet.
              </div>
            ) : (
              myOilListings.map((ol) => (
                <div
                  key={ol.id}
                  className="flex flex-col justify-between gap-3 rounded-2xl border border-[#D9BA7E]/25 bg-[#111C17] p-5"
                >
                  <div>
                    <div className="text-xs text-[#9BB0A3]">
                      {ol.oilType} · {ol.volumeLiters} L · <strong className="text-[#D9BA7E]">{ol.collectionStatus}</strong>
                    </div>
                    <div className="mt-1 font-display text-lg font-semibold text-[#F4F7F4]">
                      {ol.title}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {ol.collectionStatus === 'Available' ? (
                      <button
                        type="button"
                        onClick={() => void handleOilStatusChange(ol.id, 'Paused')}
                        className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleOilStatusChange(ol.id, 'Available')}
                        className="rounded-lg bg-[#2B7A58] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PROFILE, VERIFICATION & NOTIFICATIONS */}
      {subTab === 'trust' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <form
            onSubmit={handleSaveProfile}
            className="lg:col-span-4 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">Profile & Privacy</h2>
            {user.role !== 'admin' && (
              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  Account Focus (Optional)
                </label>
                <select
                  value={accountTypeInput}
                  onChange={(e) => setAccountTypeInput(e.target.value as Exclude<AccountType, 'admin'>)}
                  className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                >
                  <option value="general_user">General Member</option>
                  <option value="material_supplier">Material Supplier</option>
                  <option value="material_buyer">Material Buyer</option>
                  <option value="buyer">Material Buyer (Legacy)</option>
                  <option value="restaurant_donor">Restaurant / Food Donor</option>
                  <option value="food_recipient">Food Recipient / Community Kitchen</option>
                  <option value="oil_collection_partner">Used Oil Collection Partner</option>
                  <option value="recycling_processor">Recycling Processor / Industrial Buyer</option>
                  <option value="industrial_buyer">Industrial Buyer (Legacy)</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Organization</label>
              <input
                type="text"
                value={orgInput}
                onChange={(e) => setOrgInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">Location</label>
              <input
                type="text"
                value={locInput}
                onChange={(e) => setLocInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">WhatsApp Number</label>
              <input
                type="tel"
                value={waInput}
                onChange={(e) => setWaInput(e.target.value)}
                placeholder="+919876543210"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[#D2DDD6]">
              <input
                type="checkbox"
                checked={publicBoard}
                onChange={(e) => setPublicBoard(e.target.checked)}
                className="accent-[#2B7A58]"
              />
              <span>Show my name on the public Green Rewards leaderboard</span>
            </label>
            <button
              type="submit"
              className="w-full rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
            >
              Save Profile
            </button>
          </form>

          <form
            onSubmit={handleVerificationSubmit}
            className="lg:col-span-4 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                Trust Verification
              </h2>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#93C9A3]">
                <ShieldCheck className="h-4 w-4" />
                {user.verificationStatus}
              </span>
            </div>
            <p className="text-xs text-[#C8D6CD]">
              Verification badges require human administrator approval. Submitting does not
              automatically grant verified status.
            </p>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Organization / Studio Name
              </label>
              <input
                type="text"
                required
                value={verOrg}
                onChange={(e) => setVerOrg(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Materials / Food / Oil Handled
              </label>
              <input
                type="text"
                required
                value={verMaterials}
                onChange={(e) => setVerMaterials(e.target.value)}
                placeholder="e.g., Aluminium offcuts, reclaimed oak, used frying oil"
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#D2DDD6]">
                Operations Summary
              </label>
              <textarea
                rows={3}
                required
                minLength={15}
                value={verSummary}
                onChange={(e) => setVerSummary(e.target.value)}
                placeholder="Describe your workshop, business, or community kitchen..."
                className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
            >
              Submit for Review
            </button>
          </form>

          <div className="lg:col-span-4 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#93C9A3]" />
                <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">Notifications</h2>
              </div>
              {notifications.some((n) => !n.isRead) && (
                <button
                  type="button"
                  onClick={async () => {
                    await api.markNotificationsRead();
                    await loadWorkspaceData();
                    await onRefreshAll();
                  }}
                  className="text-xs font-semibold text-[#93C9A3] hover:underline cursor-pointer"
                >
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-[#9BB0A3]">No notifications yet.</p>
            ) : (
              <div className="space-y-2.5 max-h-80 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`rounded-xl border p-3 text-xs ${
                      n.isRead
                        ? 'border-[#A9B78D]/15 bg-[#0D1612]'
                        : 'border-[#93C9A3]/35 bg-[#172620]'
                    }`}
                  >
                    <div className="font-semibold text-[#F4F7F4]">{n.title}</div>
                    <div className="mt-0.5 text-[#C8D6CD]">{n.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <MaterialFormModal
        isOpen={Boolean(editingMaterial)}
        user={user}
        categories={categories}
        editingListing={editingMaterial}
        onClose={() => setEditingMaterial(null)}
        onSaved={async () => {
          onToast('Material listing updated.');
          await onRefreshAll();
        }}
      />

      <FoodDonationFormModal
        isOpen={Boolean(editingDonation)}
        user={user}
        categories={categories}
        editingDonation={editingDonation}
        onClose={() => setEditingDonation(null)}
        onSaved={async () => {
          onToast('Food donation updated.');
          await onRefreshAll();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        title={
          cancelTarget?.type === 'material' ? 'Cancel Material Listing?' : 'Cancel Food Donation?'
        }
        description={
          cancelTarget
            ? `Are you sure you want to cancel "${cancelTarget.title}"? It will be removed from public discovery immediately while remaining preserved in your history.`
            : ''
        }
        confirmLabel={
          cancelTarget?.type === 'material' ? 'Confirm Cancel Listing' : 'Confirm Cancel Donation'
        }
        cancelLabel={cancelTarget?.type === 'material' ? 'Keep Listing' : 'Keep Donation'}
        onClose={() => setCancelTarget(null)}
        onConfirm={async () => {
          if (!cancelTarget) return;
          let cancelledLocally = false;
          if (cancelTarget.type === 'material') {
            try {
              await api.cancelMaterial(cancelTarget.id);
              cancelledLocally = true;
            } catch (err) {
              const msg = err instanceof Error ? err.message.toLowerCase() : '';
              if (!msg.includes('404') && !msg.includes('not found')) throw err;
            }
            const fsCancelled = await cancelMaterialInFirestore(cancelTarget.id).catch((err) => {
              if (!cancelledLocally) throw err;
              return null;
            });
            if (!cancelledLocally && !fsCancelled) {
              throw new Error('Could not cancel material listing.');
            }
            onToast('Material listing cancelled and removed from marketplace discovery.');
          } else {
            try {
              await api.cancelFoodDonation(cancelTarget.id);
              cancelledLocally = true;
            } catch (err) {
              const msg = err instanceof Error ? err.message.toLowerCase() : '';
              if (!msg.includes('404') && !msg.includes('not found')) throw err;
            }
            const fsCancelled = await cancelFoodDonationInFirestore(cancelTarget.id).catch((err) => {
              if (!cancelledLocally) throw err;
              return null;
            });
            if (!cancelledLocally && !fsCancelled) {
              throw new Error('Could not cancel food donation.');
            }
            onToast('Food donation cancelled and removed from Food Rescue discovery.');
          }
          await Promise.all([loadWorkspaceData(), onRefreshAll()]);
        }}
      />
    </div>
  );
}
