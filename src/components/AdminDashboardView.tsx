import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Droplets,
  Eye,
  EyeOff,
  FileText,
  Filter,
  LayoutDashboard,
  Menu,
  Package,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Truck,
  UserCheck,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type {
  AccountStatus,
  AdminCustomerDetail,
  AdminCustomerSummary,
  AdminOverview,
  AuditLogEntry,
  Category,
  FoodDonation,
  ImpactSummary,
  ListingVerificationRecord,
  MaterialListing,
  OilRecoveryListing,
  ReportRecord,
  User,
  VerificationSubmission,
} from '../types';
import { formatAccountType, formatDateTime, formatShortDate } from '../utils/format';

export type AdminSection =
  | 'overview'
  | 'customers'
  | 'suppliers'
  | 'buyers'
  | 'listings'
  | 'orders'
  | 'food-rescue'
  | 'oil-recovery'
  | 'ai-verifications'
  | 'verifications'
  | 'reports-impact'
  | 'audit-logs'
  | 'settings';

interface AdminDashboardViewProps {
  user: User | null;
  categories: Category[];
  impact: ImpactSummary | null;
  onRefreshAll: () => Promise<void>;
  onToast: (msg: string) => void;
  onBackToWorkspace: () => void;
}

interface PendingConfirmAction {
  title: string;
  description: string;
  confirmLabel: string;
  requireReason: boolean;
  tone: 'danger' | 'primary';
  onConfirm: (reason: string) => Promise<void>;
}

const SIDEBAR_ITEMS: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'suppliers', label: 'Suppliers', icon: Truck },
  { id: 'buyers', label: 'Buyers', icon: ShoppingBag },
  { id: 'listings', label: 'Marketplace Listings', icon: Package },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'food-rescue', label: 'Food Rescue', icon: Utensils },
  { id: 'oil-recovery', label: 'Oil Recovery', icon: Droplets },
  { id: 'ai-verifications', label: 'AI Listing Reviews', icon: ShieldCheck },
  { id: 'verifications', label: 'Business Verification', icon: UserCheck },
  { id: 'reports-impact', label: 'Reports & Impact', icon: BarChart3 },
  { id: 'audit-logs', label: 'Admin Audit Logs', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function StatusText({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const color =
    lower === 'active' || lower === 'approved' || lower === 'completed' || lower === 'available' || lower === 'resolved' || lower === 'success'
      ? 'text-[#7CE0A3]'
      : lower === 'suspended' || lower === 'rejected' || lower === 'cancelled' || lower === 'declined' || lower === 'deactivated' || lower === 'expired'
        ? 'text-[#FCA5A5]'
        : 'text-[#FAD089]';
  return <span className={`font-semibold ${color}`}>{status}</span>;
}

export function AdminDashboardView({
  user,
  categories,
  impact,
  onRefreshAll,
  onToast,
  onBackToWorkspace,
}: AdminDashboardViewProps) {
  const [section, setSection] = useState<AdminSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Overview state
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Customers state
  const [custQ, setCustQ] = useState('');
  const [custFilter, setCustFilter] = useState('all');
  const [custSort, setCustSort] = useState('newest');
  const [custPage, setCustPage] = useState(1);
  const [customers, setCustomers] = useState<AdminCustomerSummary[]>([]);
  const [custTotal, setCustTotal] = useState(0);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<AdminCustomerDetail | null>(null);
  const [loadingCustomerDetail, setLoadingCustomerDetail] = useState(false);
  const [newAdminNote, setNewAdminNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Listings state
  const [listQ, setListQ] = useState('');
  const [listStatus, setListStatus] = useState('All');
  const [listPage, setListPage] = useState(1);
  const [adminListings, setAdminListings] = useState<MaterialListing[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [loadingListings, setLoadingListings] = useState(false);

  // Orders state
  const [ordQ, setOrdQ] = useState('');
  const [ordStatus, setOrdStatus] = useState('All');
  const [ordPage, setOrdPage] = useState(1);
  const [adminOrders, setAdminOrders] = useState<Awaited<ReturnType<typeof api.adminGetOrders>>['orders']>([]);
  const [ordTotal, setOrdTotal] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Food Rescue state
  const [foodQ, setFoodQ] = useState('');
  const [foodStatus, setFoodStatus] = useState('All');
  const [foodDonations, setFoodDonations] = useState<FoodDonation[]>([]);
  const [foodRequests, setFoodRequests] = useState<Awaited<ReturnType<typeof api.adminGetFoodRescue>>['requests']>([]);
  const [loadingFood, setLoadingFood] = useState(false);

  // Oil Recovery state
  const [oilQ, setOilQ] = useState('');
  const [oilStatus, setOilStatus] = useState('All');
  const [oilListings, setOilListings] = useState<OilRecoveryListing[]>([]);
  const [oilEnquiries, setOilEnquiries] = useState<Awaited<ReturnType<typeof api.adminGetOilRecovery>>['enquiries']>([]);
  const [loadingOil, setLoadingOil] = useState(false);

  // Verifications, AI Listing Reviews, Reports, Audit Logs, Settings
  const [verifications, setVerifications] = useState<VerificationSubmission[]>([]);
  const [aiVerifications, setAiVerifications] = useState<ListingVerificationRecord[]>([]);
  const [aiVerStatusFilter, setAiVerStatusFilter] = useState('All');
  const [aiVerReviewFilter, setAiVerReviewFilter] = useState('All');
  const [aiVerQ, setAiVerQ] = useState('');
  const [loadingAiVer, setLoadingAiVer] = useState(false);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditQ, setAuditQ] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Settings category state
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'material' | 'food'>('material');
  const [newCatDesc, setNewCatDesc] = useState('');

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<PendingConfirmAction | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setErrorBanner(null);
    try {
      const data = await api.adminGetOverview();
      setOverview(data);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load admin overview.');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadCustomers = useCallback(
    async (overrideFilter?: string) => {
      setLoadingCustomers(true);
      setErrorBanner(null);
      try {
        const activeFilter = overrideFilter ?? custFilter;
        const res = await api.adminGetCustomers({
          q: custQ,
          filter: activeFilter,
          sort: custSort,
          page: custPage,
          pageSize: 15,
        });
        setCustomers(res.customers);
        setCustTotal(res.total);
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Unable to load customer directory.');
      } finally {
        setLoadingCustomers(false);
      }
    },
    [custQ, custFilter, custSort, custPage]
  );

  const loadListings = useCallback(async () => {
    setLoadingListings(true);
    try {
      const res = await api.adminGetListings({ q: listQ, status: listStatus, page: listPage, pageSize: 15 });
      setAdminListings(res.listings);
      setListTotal(res.total);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load listings.');
    } finally {
      setLoadingListings(false);
    }
  }, [listQ, listStatus, listPage]);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const res = await api.adminGetOrders({ q: ordQ, status: ordStatus, page: ordPage, pageSize: 15 });
      setAdminOrders(res.orders);
      setOrdTotal(res.total);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load orders.');
    } finally {
      setLoadingOrders(false);
    }
  }, [ordQ, ordStatus, ordPage]);

  const loadFoodRescue = useCallback(async () => {
    setLoadingFood(true);
    try {
      const res = await api.adminGetFoodRescue({ q: foodQ, status: foodStatus });
      setFoodDonations(res.donations);
      setFoodRequests(res.requests);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load food rescue records.');
    } finally {
      setLoadingFood(false);
    }
  }, [foodQ, foodStatus]);

  const loadOilRecovery = useCallback(async () => {
    setLoadingOil(true);
    try {
      const res = await api.adminGetOilRecovery({ q: oilQ, status: oilStatus });
      setOilListings(res.listings);
      setOilEnquiries(res.enquiries);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load oil recovery records.');
    } finally {
      setLoadingOil(false);
    }
  }, [oilQ, oilStatus]);

  const loadVerificationsAndReports = useCallback(async () => {
    try {
      const [verRes, repRes] = await Promise.all([api.getVerifications(), api.getReports()]);
      setVerifications(verRes.verifications);
      setReports(repRes.reports);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load moderation queues.');
    }
  }, []);

  const loadAiVerifications = useCallback(async () => {
    setLoadingAiVer(true);
    try {
      const res = await api.adminGetAiVerifications({
        status: aiVerStatusFilter,
        review: aiVerReviewFilter,
        q: aiVerQ,
      });
      setAiVerifications(res.verifications);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load AI listing verifications.');
    } finally {
      setLoadingAiVer(false);
    }
  }, [aiVerStatusFilter, aiVerReviewFilter, aiVerQ]);

  const loadAuditLogs = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await api.getAuditLogs({ q: auditQ, page: auditPage, pageSize: 25 });
      setAuditLogs(res.logs);
      setAuditTotal(res.total ?? res.logs.length);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to load audit logs.');
    } finally {
      setLoadingAudit(false);
    }
  }, [auditQ, auditPage]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    if (section === 'overview') void loadOverview();
    if (section === 'customers') void loadCustomers();
    if (section === 'suppliers') void loadCustomers('suppliers');
    if (section === 'buyers') void loadCustomers('buyers');
    if (section === 'listings') void loadListings();
    if (section === 'orders') void loadOrders();
    if (section === 'food-rescue') void loadFoodRescue();
    if (section === 'oil-recovery') void loadOilRecovery();
    if (section === 'ai-verifications') void loadAiVerifications();
    if (section === 'verifications' || section === 'reports-impact') void loadVerificationsAndReports();
    if (section === 'audit-logs') void loadAuditLogs();
  }, [
    user,
    section,
    loadOverview,
    loadCustomers,
    loadListings,
    loadOrders,
    loadFoodRescue,
    loadOilRecovery,
    loadAiVerifications,
    loadVerificationsAndReports,
    loadAuditLogs,
  ]);

  if (!user || user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10">
          <ShieldAlert className="mx-auto h-10 w-10 text-[#93C9A3]" />
          <h1 className="mt-4 font-display text-3xl font-semibold text-[#F4F7F4]">
            Administrator Authorization Required
          </h1>
          <p className="mt-2 text-sm text-[#C8D6CD]">
            Only authenticated platform administrators with active role permissions can access real
            customer administration and moderation controls.
          </p>
          <button
            type="button"
            onClick={onBackToWorkspace}
            className="mt-6 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
          >
            Return to Workspace
          </button>
        </div>
      </div>
    );
  }

  const jumpTo = (targetSection: AdminSection, opts?: { customerFilter?: string; listingStatus?: string }) => {
    setSelectedCustomer(null);
    if (opts?.customerFilter) {
      setCustFilter(opts.customerFilter);
      setCustPage(1);
    } else if (targetSection === 'customers') {
      setCustFilter('all');
      setCustPage(1);
    }
    if (opts?.listingStatus) {
      setListStatus(opts.listingStatus);
      setListPage(1);
    }
    setSection(targetSection);
    setMobileMenuOpen(false);
  };

  const openCustomerDetail = async (id: string) => {
    setLoadingCustomerDetail(true);
    try {
      const detail = await api.adminGetCustomerDetail(id);
      setSelectedCustomer(detail);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to load customer profile.');
    } finally {
      setLoadingCustomerDetail(false);
    }
  };

  const requestConfirmation = (action: PendingConfirmAction) => {
    setConfirmReason('');
    setConfirmError(null);
    setConfirmModal(action);
  };

  const handleConfirmSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirmModal) return;
    if (confirmModal.requireReason && confirmReason.trim().length < 5) {
      setConfirmError('Please enter a clear administrative reason (at least 5 characters).');
      return;
    }
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      await confirmModal.onConfirm(confirmReason.trim());
      setConfirmModal(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Administrative action failed.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleAddCustomerNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || newAdminNote.trim().length < 3) return;
    setSavingNote(true);
    try {
      await api.adminAddCustomerNote(selectedCustomer.customer.id, newAdminNote.trim());
      setNewAdminNote('');
      onToast('Administrative note recorded.');
      await openCustomerDetail(selectedCustomer.customer.id);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not save administrative note.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleCustomerStatusAction = (targetId: string, targetName: string, nextStatus: AccountStatus) => {
    requestConfirmation({
      title: `${nextStatus === 'Active' ? 'Reactivate' : nextStatus === 'Suspended' ? 'Suspend' : 'Deactivate'} Customer Account`,
      description:
        nextStatus === 'Active'
          ? `Restore full login and marketplace access for ${targetName}.`
          : `Changing ${targetName} to ${nextStatus} immediately revokes all active sessions and prevents future logins while preserving historical ledger integrity.`,
      confirmLabel: `Confirm ${nextStatus}`,
      requireReason: nextStatus !== 'Active',
      tone: nextStatus === 'Active' ? 'primary' : 'danger',
      onConfirm: async (reason) => {
        await api.adminUpdateCustomerStatus(targetId, { accountStatus: nextStatus, reason });
        onToast(`Customer account marked ${nextStatus}.`);
        await Promise.all([
          openCustomerDetail(targetId),
          loadCustomers(section === 'suppliers' ? 'suppliers' : section === 'buyers' ? 'buyers' : custFilter),
          loadOverview(),
        ]);
      },
    });
  };

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await api.createCategory({
        name: newCatName.trim(),
        type: newCatType,
        description: newCatDesc.trim(),
      });
      setNewCatName('');
      setNewCatDesc('');
      onToast('Platform category added.');
      await onRefreshAll();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not add category.');
    }
  };

  const renderCustomerTable = (
    rows: AdminCustomerSummary[],
    totalRows: number,
    showDirectoryFilters: boolean,
    emptyHeadline: string
  ) => (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
          <input
            type="search"
            value={custQ}
            onChange={(e) => {
              setCustQ(e.target.value);
              setCustPage(1);
            }}
            placeholder="Search by customer name, email, ID, or business name..."
            className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
          />
        </div>
        {showDirectoryFilters && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#9BB0A3] shrink-0" />
            <select
              aria-label="Filter customers"
              value={custFilter}
              onChange={(e) => {
                setCustFilter(e.target.value);
                setCustPage(1);
              }}
              className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
            >
              <option value="all">All customers</option>
              <option value="buyers">Buyers</option>
              <option value="suppliers">Suppliers</option>
              <option value="restaurants">Restaurants</option>
              <option value="food_donors">Food donors</option>
              <option value="food_recipients">Food recipients</option>
              <option value="industrial_buyers">Industrial buyers</option>
              <option value="verified_businesses">Verified businesses</option>
              <option value="pending_verification">Pending verification</option>
              <option value="active">Active accounts</option>
              <option value="suspended">Suspended accounts</option>
              <option value="deactivated">Deactivated accounts</option>
            </select>
          </div>
        )}
        <select
          aria-label="Sort customers"
          value={custSort}
          onChange={(e) => setCustSort(e.target.value)}
          className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
        >
          <option value="newest">Newest registered</option>
          <option value="name-asc">Name (A–Z)</option>
          <option value="activity-desc">Most recent activity</option>
          <option value="orders-desc">Most orders</option>
        </select>
      </div>

      {loadingCustomers ? (
        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
          Loading real customer records...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center">
          <Users className="mx-auto h-8 w-8 text-[#93C9A3]" />
          <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
            {custQ || (showDirectoryFilters && custFilter !== 'all')
              ? 'No matching registered customers'
              : emptyHeadline}
          </h3>
          <p className="mt-1.5 text-xs text-[#C8D6CD] max-w-md mx-auto">
            VERDORA displays only genuine accounts created through completed registration. Page
            views and anonymous sessions never appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#A9B78D]/18 bg-[#172620] text-[#D2DDD6]">
                  <th className="py-3 px-3 font-semibold">Customer ID</th>
                  <th className="py-3 px-3 font-semibold">Customer Name</th>
                  <th className="py-3 px-3 font-semibold">Registered Email</th>
                  <th className="py-3 px-3 font-semibold">Account Type</th>
                  <th className="py-3 px-3 font-semibold">Business Name</th>
                  <th className="py-3 px-3 font-semibold">Registration Date</th>
                  <th className="py-3 px-3 font-semibold">Account Status</th>
                  <th className="py-3 px-3 font-semibold">Verification</th>
                  <th className="py-3 px-3 text-right font-semibold">Listings</th>
                  <th className="py-3 px-3 text-right font-semibold">Orders</th>
                  <th className="py-3 px-3 font-semibold">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => void openCustomerDetail(c.id)}
                    className="hover:bg-[#172620]/70 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-3 font-mono-tabular text-[11px] text-[#9BB0A3] whitespace-nowrap">
                      {c.id}
                    </td>
                    <td className="py-3 px-3 font-semibold text-[#F4F7F4] whitespace-nowrap">
                      {c.name}
                    </td>
                    <td className="py-3 px-3 text-[#C8D6CD] whitespace-nowrap">{c.email}</td>
                    <td className="py-3 px-3 text-[#C8D6CD] whitespace-nowrap">
                      {formatAccountType(c.accountType)}
                    </td>
                    <td className="py-3 px-3 text-[#C8D6CD] whitespace-nowrap">
                      {c.organization || '—'}
                    </td>
                    <td className="py-3 px-3 font-mono-tabular whitespace-nowrap">
                      {formatShortDate(c.createdAt)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <StatusText status={c.accountStatus} />
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <StatusText status={c.verificationStatus} />
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#93C9A3]">
                      {c.listingsCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-[#93C9A3]">
                      {c.ordersCount}
                    </td>
                    <td className="py-3 px-3 font-mono-tabular text-[11px] text-[#9BB0A3] whitespace-nowrap">
                      {c.lastActivityAt ? formatDateTime(c.lastActivityAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalRows > 15 && (
            <div className="flex items-center justify-between border-t border-[#A9B78D]/15 px-4 py-3 text-xs">
              <span className="tabular-nums text-[#9BB0A3]">
                Showing {rows.length} of {totalRows} registered accounts
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={custPage <= 1}
                  onClick={() => setCustPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={custPage * 15 >= totalRows}
                  onClick={() => setCustPage((p) => p + 1)}
                  className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      {/* Top Admin Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-[#A9B78D]/15 pb-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Toggle admin menu"
            onClick={() => setMobileMenuOpen((p) => !p)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#A9B78D]/25 bg-[#111C17] text-[#F4F7F4] lg:hidden cursor-pointer"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
              <ShieldCheck className="h-4 w-4 text-[#93C9A3]" />
              <span>VERDORA Platform Administration</span>
            </div>
            <h1 className="mt-0.5 font-display text-2xl font-semibold text-[#F4F7F4] sm:text-3xl">
              {selectedCustomer
                ? `Customer Profile: ${selectedCustomer.customer.name}`
                : SIDEBAR_ITEMS.find((s) => s.id === section)?.label}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (section === 'overview') void loadOverview();
              if (section === 'customers') void loadCustomers();
              if (section === 'suppliers') void loadCustomers('suppliers');
              if (section === 'buyers') void loadCustomers('buyers');
              if (section === 'listings') void loadListings();
              if (section === 'orders') void loadOrders();
              if (section === 'food-rescue') void loadFoodRescue();
              if (section === 'oil-recovery') void loadOilRecovery();
              if (section === 'verifications' || section === 'reports-impact') void loadVerificationsAndReports();
              if (section === 'audit-logs') void loadAuditLogs();
              void onRefreshAll();
            }}
            className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3.5 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#93C9A3]" />
            <span>Refresh Live Data</span>
          </button>
          <button
            type="button"
            onClick={onBackToWorkspace}
            className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>User Workspace</span>
          </button>
        </div>
      </div>

      {errorBanner && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-[#E06C75]/35 bg-[#361619] px-4 py-3 text-xs font-medium text-[#FFB3B8]">
          <span>{errorBanner}</span>
          <button type="button" onClick={() => setErrorBanner(null)} className="cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <aside
          className={`${
            mobileMenuOpen ? 'block' : 'hidden'
          } w-full shrink-0 lg:block lg:w-60`}
        >
          <nav
            aria-label="Admin sections"
            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-2.5 space-y-1"
          >
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id && !selectedCustomer;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => jumpTo(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#2B7A58] text-white'
                      : 'text-[#C8D6CD] hover:bg-[#172620] hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Admin Canvas */}
        <div className="min-w-0 flex-1 space-y-6">
          {/* CUSTOMER DETAIL VIEW */}
          {loadingCustomerDetail ? (
            <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center text-sm text-[#C8D6CD]">
              Loading customer activity & database records...
            </div>
          ) : selectedCustomer ? (
            <div className="space-y-6">
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#93C9A3] hover:underline cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to customer directory</span>
              </button>

              {/* Profile Header & Moderation Actions */}
              <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-5">
                <div className="flex flex-col justify-between gap-4 border-b border-[#A9B78D]/15 pb-5 md:flex-row md:items-start">
                  <div className="flex items-start gap-3.5">
                    {selectedCustomer.customer.avatarUrl ? (
                      <img
                        src={selectedCustomer.customer.avatarUrl}
                        alt={selectedCustomer.customer.name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                        className="h-12 w-12 shrink-0 rounded-full border border-[#A9B78D]/25 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#2B7A58] font-display text-base font-semibold text-white">
                        {selectedCustomer.customer.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-[#9BB0A3] font-mono-tabular">
                        ID: {selectedCustomer.customer.id} · Registered{' '}
                        {formatDateTime(selectedCustomer.customer.createdAt)} · Auth:{' '}
                        {selectedCustomer.customer.authProvider || 'email'}
                      </div>
                      <h2 className="mt-1 font-display text-2xl font-semibold text-[#F4F7F4]">
                        {selectedCustomer.customer.name}
                      </h2>
                      <div className="mt-1 text-sm text-[#D2DDD6]">
                        {selectedCustomer.customer.email} ·{' '}
                        {formatAccountType(selectedCustomer.customer.accountType)}
                        {selectedCustomer.customer.organization
                          ? ` · ${selectedCustomer.customer.organization}`
                          : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedCustomer.customer.accountStatus !== 'Active' && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCustomerStatusAction(
                            selectedCustomer.customer.id,
                            selectedCustomer.customer.name,
                            'Active'
                          )
                        }
                        className="rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                      >
                        Reactivate Account
                      </button>
                    )}
                    {selectedCustomer.customer.accountStatus === 'Active' && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCustomerStatusAction(
                            selectedCustomer.customer.id,
                            selectedCustomer.customer.name,
                            'Suspended'
                          )
                        }
                        className="rounded-lg border border-[#D99B38]/35 bg-[#2E230F] px-4 py-2 text-xs font-semibold text-[#FAD089] hover:bg-[#3D2E14] cursor-pointer"
                      >
                        Suspend Account
                      </button>
                    )}
                    {selectedCustomer.customer.accountStatus !== 'Deactivated' && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCustomerStatusAction(
                            selectedCustomer.customer.id,
                            selectedCustomer.customer.name,
                            'Deactivated'
                          )
                        }
                        className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-4 py-2 text-xs font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                      >
                        Deactivate Account
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-5">
                  <div>
                    <div className="text-[#9BB0A3]">Account Status</div>
                    <div className="mt-0.5 text-sm">
                      <StatusText status={selectedCustomer.customer.accountStatus} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[#9BB0A3]">Business Verification</div>
                    <div className="mt-0.5 text-sm">
                      <StatusText status={selectedCustomer.customer.verificationStatus} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[#9BB0A3]">Location</div>
                    <div className="mt-0.5 font-medium text-[#F4F7F4]">
                      {selectedCustomer.customer.location || 'Not provided'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#9BB0A3]">WhatsApp</div>
                    <div className="mt-0.5 font-mono-tabular font-medium text-[#F4F7F4]">
                      {selectedCustomer.customer.whatsappNumber || 'Not shared'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#9BB0A3]">Last Activity</div>
                    <div className="mt-0.5 font-mono-tabular font-medium text-[#F4F7F4]">
                      {selectedCustomer.customer.lastActivityAt
                        ? formatDateTime(selectedCustomer.customer.lastActivityAt)
                        : 'No recorded activity'}
                    </div>
                  </div>
                </div>

                {selectedCustomer.customer.suspensionReason && (
                  <div className="rounded-xl border border-[#E06C75]/35 bg-[#361619] px-4 py-3 text-xs text-[#FFB3B8]">
                    <strong>Recorded Suspension Reason:</strong>{' '}
                    {selectedCustomer.customer.suspensionReason}
                  </div>
                )}
              </div>

              {/* Customer Activity Sections */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Material Listings & Orders */}
                <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5 space-y-3">
                  <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                    Material Listings ({selectedCustomer.materialListings.length}) & Orders (
                    {selectedCustomer.materialOrders.length})
                  </h3>
                  {selectedCustomer.materialListings.length === 0 &&
                  selectedCustomer.materialOrders.length === 0 ? (
                    <p className="text-xs text-[#9BB0A3]">
                      No material listings or orders recorded for this customer.
                    </p>
                  ) : (
                    <div className="space-y-2 text-xs text-[#D2DDD6]">
                      {selectedCustomer.materialListings.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-lg border border-[#A9B78D]/15 bg-[#172620] px-3 py-2"
                        >
                          <span>
                            <strong className="text-[#F4F7F4]">{m.title}</strong> ({m.quantity} {m.unit})
                          </span>
                          <StatusText status={m.isHidden ? 'Hidden' : m.status} />
                        </div>
                      ))}
                      {selectedCustomer.materialOrders.map((o) => (
                        <div
                          key={o.id}
                          className="flex items-center justify-between rounded-lg border border-[#A9B78D]/15 bg-[#0D1612] px-3 py-2"
                        >
                          <span>
                            Order {o.listingTitle} ({o.requestedQuantity} {o.listingUnit})
                          </span>
                          <StatusText status={o.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Food Rescue & Oil Recovery */}
                <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5 space-y-3">
                  <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                    Food Rescue ({selectedCustomer.foodDonations.length + selectedCustomer.foodRequests.length}) & Oil Recovery (
                    {selectedCustomer.oilListings.length + selectedCustomer.oilEnquiries.length})
                  </h3>
                  {selectedCustomer.foodDonations.length +
                    selectedCustomer.foodRequests.length +
                    selectedCustomer.oilListings.length +
                    selectedCustomer.oilEnquiries.length ===
                  0 ? (
                    <p className="text-xs text-[#9BB0A3]">
                      No food rescue or oil recovery records for this customer.
                    </p>
                  ) : (
                    <div className="space-y-2 text-xs text-[#D2DDD6]">
                      {selectedCustomer.foodDonations.map((fd) => (
                        <div
                          key={fd.id}
                          className="flex items-center justify-between rounded-lg border border-[#A9B78D]/15 bg-[#172620] px-3 py-2"
                        >
                          <span>
                            Food Donation: <strong className="text-[#F4F7F4]">{fd.title}</strong> ({fd.remainingPortions}/{fd.portions} portions)
                          </span>
                          <StatusText status={fd.isHidden ? 'Hidden' : fd.status} />
                        </div>
                      ))}
                      {selectedCustomer.foodRequests.map((fr) => (
                        <div
                          key={fr.id}
                          className="flex items-center justify-between rounded-lg border border-[#A9B78D]/15 bg-[#0D1612] px-3 py-2"
                        >
                          <span>
                            Food Claim: {fr.donationTitle} ({fr.requestedPortions} portions)
                          </span>
                          <StatusText status={fr.status} />
                        </div>
                      ))}
                      {selectedCustomer.oilListings.map((ol) => (
                        <div
                          key={ol.id}
                          className="flex items-center justify-between rounded-lg border border-[#A9B78D]/15 bg-[#172620] px-3 py-2"
                        >
                          <span>
                            Oil Lot: <strong className="text-[#F4F7F4]">{ol.title}</strong> ({ol.volumeLiters} L)
                          </span>
                          <StatusText status={ol.isHidden ? 'Hidden' : ol.collectionStatus} />
                        </div>
                      ))}
                      {selectedCustomer.oilEnquiries.map((oe) => (
                        <div
                          key={oe.id}
                          className="flex items-center justify-between rounded-lg border border-[#A9B78D]/15 bg-[#0D1612] px-3 py-2"
                        >
                          <span>
                            Oil Enquiry: {oe.listingTitle} ({oe.requestedLiters} L)
                          </span>
                          <StatusText status={oe.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* Admin Notes & Moderation History */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5 space-y-4">
                  <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                    Internal Administrative Notes ({selectedCustomer.adminNotes.length})
                  </h3>
                  <form onSubmit={handleAddCustomerNote} className="space-y-2">
                    <textarea
                      rows={2}
                      required
                      minLength={3}
                      value={newAdminNote}
                      onChange={(e) => setNewAdminNote(e.target.value)}
                      placeholder="Record factual verification, outreach, or compliance observation..."
                      className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-xs text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                    />
                    <button
                      type="submit"
                      disabled={savingNote}
                      className="rounded-lg bg-[#2B7A58] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#348F68] disabled:opacity-60 cursor-pointer"
                    >
                      {savingNote ? 'Saving...' : 'Save Admin Note'}
                    </button>
                  </form>
                  <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
                    {selectedCustomer.adminNotes.length === 0 ? (
                      <p className="text-[#9BB0A3]">No administrative notes recorded yet.</p>
                    ) : (
                      selectedCustomer.adminNotes.map((n) => (
                        <div key={n.id} className="rounded-lg border border-[#A9B78D]/15 bg-[#172620] p-3">
                          <div className="flex items-center justify-between text-[11px] text-[#9BB0A3]">
                            <span className="font-semibold text-[#93C9A3]">{n.adminName}</span>
                            <span className="font-mono-tabular">{formatDateTime(n.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-[#D2DDD6]">{n.note}</p>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5 space-y-3">
                  <h3 className="font-display text-lg font-semibold text-[#F4F7F4]">
                    Verification & Moderation History
                  </h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
                    {selectedCustomer.verifications.map((v) => (
                      <div key={v.id} className="rounded-lg border border-[#A9B78D]/15 bg-[#172620] p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#F4F7F4]">
                            Verification Submission ({v.organization})
                          </span>
                          <StatusText status={v.status} />
                        </div>
                        <div className="mt-1 text-[#C8D6CD]">{v.businessSummary}</div>
                      </div>
                    ))}
                    {selectedCustomer.moderationHistory.length === 0 &&
                    selectedCustomer.verifications.length === 0 ? (
                      <p className="text-[#9BB0A3]">No moderation events recorded for this account.</p>
                    ) : (
                      selectedCustomer.moderationHistory.map((log) => (
                        <div key={log.id} className="rounded-lg border border-[#A9B78D]/15 bg-[#0D1612] p-3">
                          <div className="flex items-center justify-between font-semibold text-[#F4F7F4]">
                            <span>{log.action}</span>
                            <span className="font-mono-tabular text-[11px] text-[#9BB0A3]">
                              {formatDateTime(log.createdAt)}
                            </span>
                          </div>
                          <div className="mt-1 text-[#C8D6CD]">{log.details}</div>
                          {log.reason && (
                            <div className="mt-1 text-[11px] text-[#9BB0A3]">
                              Reason: {log.reason}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <>
              {/* 1. OVERVIEW */}
              {section === 'overview' && (
                <div className="space-y-8">
                  {loadingOverview && !overview ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-28 animate-pulse rounded-2xl border border-[#A9B78D]/15 bg-[#111C17] p-5"
                        />
                      ))}
                    </div>
                  ) : overview ? (
                    <>
                      {overview.customers.total === 0 && (
                        <div className="rounded-2xl border border-[#2B7A58]/40 bg-[#123324] p-5 text-xs text-[#9BF0BC]">
                          <strong>Live Database Clean:</strong> Currently <strong>0</strong> registered
                          non-admin customers exist in production. Cards below reflect exact live
                          database counts and never display fabricated statistics.
                        </div>
                      )}

                      {/* Customer Statistics */}
                      <section className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-[#93C9A3]" />
                          <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                            Customer Statistics
                          </h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                          {[
                            { label: 'Total Registered Customers', val: overview.customers.total, filter: 'all' },
                            { label: 'Active Registered Accounts', val: overview.customers.active, filter: 'active' },
                            { label: 'New Registrations Today', val: overview.customers.newToday, filter: 'all' },
                            { label: 'New Registrations This Week', val: overview.customers.newThisWeek, filter: 'all' },
                            { label: 'New Registrations This Month', val: overview.customers.newThisMonth, filter: 'all' },
                            {
                              label: 'Pending Business Verifications',
                              val: overview.customers.pendingVerifications,
                              target: 'verifications' as AdminSection,
                            },
                            { label: 'Suspended Accounts', val: overview.customers.suspended, filter: 'suspended' },
                            { label: 'Deactivated Accounts', val: overview.customers.deactivated, filter: 'deactivated' },
                          ].map((card) => (
                            <button
                              key={card.label}
                              type="button"
                              onClick={() =>
                                card.target
                                  ? jumpTo(card.target)
                                  : jumpTo('customers', { customerFilter: card.filter })
                              }
                              className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left transition-colors hover:border-[#93C9A3]/40 cursor-pointer"
                            >
                              <div className="text-xs text-[#C8D6CD]">{card.label}</div>
                              <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                                {card.val}
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>

                      {/* Marketplace Statistics */}
                      <section className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-[#93C9A3]" />
                          <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                            Marketplace Statistics
                          </h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                          <button
                            type="button"
                            onClick={() => jumpTo('listings', { listingStatus: 'Active' })}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/40 cursor-pointer"
                          >
                            <div className="text-xs text-[#C8D6CD]">Active Material Listings</div>
                            <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                              {overview.marketplace.activeListings}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpTo('listings', { listingStatus: 'Hidden' })}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/40 cursor-pointer"
                          >
                            <div className="text-xs text-[#C8D6CD]">Hidden / Paused Listings</div>
                            <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                              {overview.marketplace.hiddenListings}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpTo('orders')}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/40 cursor-pointer"
                          >
                            <div className="text-xs text-[#C8D6CD]">Completed Orders</div>
                            <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                              {overview.marketplace.completedOrders}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpTo('orders')}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/40 cursor-pointer"
                          >
                            <div className="text-xs text-[#C8D6CD]">Pending Orders</div>
                            <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                              {overview.marketplace.pendingOrders}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpTo('orders')}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/40 cursor-pointer"
                          >
                            <div className="text-xs text-[#C8D6CD]">Cancelled / Declined Orders</div>
                            <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                              {overview.marketplace.cancelledOrders}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpTo('suppliers')}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/40 cursor-pointer"
                          >
                            <div className="text-xs text-[#C8D6CD]">Registered Suppliers</div>
                            <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                              {overview.marketplace.registeredSuppliers}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpTo('buyers')}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/40 cursor-pointer"
                          >
                            <div className="text-xs text-[#C8D6CD]">Registered Buyers</div>
                            <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                              {overview.marketplace.registeredBuyers}
                            </div>
                          </button>
                        </div>
                      </section>

                      {/* Food Rescue Statistics */}
                      <section className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Utensils className="h-4 w-4 text-[#93C9A3]" />
                          <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                            Food Rescue Statistics
                          </h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                          {[
                            { label: 'Registered Food Donors', val: overview.foodRescue.registeredDonors, action: () => jumpTo('customers', { customerFilter: 'food_donors' }) },
                            { label: 'Registered Recipients', val: overview.foodRescue.registeredRecipients, action: () => jumpTo('customers', { customerFilter: 'food_recipients' }) },
                            { label: 'Active Food Donations', val: overview.foodRescue.activeDonations, action: () => jumpTo('food-rescue') },
                            { label: 'Accepted Requests', val: overview.foodRescue.acceptedRequests, action: () => jumpTo('food-rescue') },
                            { label: 'Completed Handovers', val: overview.foodRescue.completedHandovers, action: () => jumpTo('food-rescue') },
                            { label: 'Rescued Portions', val: overview.foodRescue.rescuedPortions, action: () => jumpTo('reports-impact') },
                          ].map((c) => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={c.action}
                              className="rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] p-4 text-left hover:border-[#93C9A3]/50 cursor-pointer"
                            >
                              <div className="text-xs text-[#C8D6CD]">{c.label}</div>
                              <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#93C9A3]">
                                {c.val}
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>

                      {/* Circular Economy & Used Cooking Oil Statistics */}
                      <section className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Droplets className="h-4 w-4 text-[#D9BA7E]" />
                          <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                            Circular Economy & Used Cooking Oil Statistics
                          </h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                          {[
                            { label: 'Cooking Oil Listings', val: overview.oilRecovery.totalListings, action: () => jumpTo('oil-recovery') },
                            { label: 'Registered Oil Suppliers', val: overview.oilRecovery.registeredOilSuppliers, action: () => jumpTo('oil-recovery') },
                            { label: 'Industrial Buyers', val: overview.oilRecovery.registeredIndustrialBuyers, action: () => jumpTo('customers', { customerFilter: 'industrial_buyers' }) },
                            { label: 'Pending Buyer Enquiries', val: overview.oilRecovery.pendingEnquiries, action: () => jumpTo('oil-recovery') },
                            { label: 'Completed Recoveries', val: overview.oilRecovery.completedRecoveries, action: () => jumpTo('oil-recovery') },
                            { label: 'Oil Recovered (L)', val: overview.oilRecovery.totalLitersRecovered, action: () => jumpTo('reports-impact') },
                          ].map((c) => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={c.action}
                              className="rounded-2xl border border-[#D9BA7E]/25 bg-[#111C17] p-4 text-left hover:border-[#D9BA7E]/50 cursor-pointer"
                            >
                              <div className="text-xs text-[#C8D6CD]">{c.label}</div>
                              <div className="mt-2 font-mono-tabular text-2xl font-semibold text-[#D9BA7E]">
                                {c.val}
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    </>
                  ) : null}
                </div>
              )}

              {/* 2. CUSTOMERS / 3. SUPPLIERS / 4. BUYERS */}
              {section === 'customers' &&
                renderCustomerTable(customers, custTotal, true, 'No registered customers yet.')}
              {section === 'suppliers' &&
                renderCustomerTable(customers, custTotal, false, 'No registered suppliers yet.')}
              {section === 'buyers' &&
                renderCustomerTable(customers, custTotal, false, 'No registered buyers yet.')}

              {/* 5. MARKETPLACE LISTINGS */}
              {section === 'listings' && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
                      <input
                        type="search"
                        value={listQ}
                        onChange={(e) => {
                          setListQ(e.target.value);
                          setListPage(1);
                        }}
                        placeholder="Search material title, seller, category, or city..."
                        className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>
                    <select
                      aria-label="Filter listings by status"
                      value={listStatus}
                      onChange={(e) => {
                        setListStatus(e.target.value);
                        setListPage(1);
                      }}
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                    >
                      <option value="All">All Statuses</option>
                      <option value="Active">Active</option>
                      <option value="Paused">Paused</option>
                      <option value="Hidden">Hidden by Admin</option>
                      <option value="Unavailable">Unavailable</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>

                  {loadingListings ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
                      Loading marketplace listings...
                    </div>
                  ) : adminListings.length === 0 ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center">
                      <Package className="mx-auto h-8 w-8 text-[#93C9A3]" />
                      <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
                        No marketplace listings recorded yet.
                      </h3>
                      <p className="mt-1 text-xs text-[#C8D6CD]">
                        Only real surplus material lots published by registered users appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]">
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#A9B78D]/18 bg-[#172620] text-[#D2DDD6]">
                              <th className="py-3 px-4 font-semibold">Listing</th>
                              <th className="py-3 px-4 font-semibold">Supplier</th>
                              <th className="py-3 px-4 font-semibold">Quantity</th>
                              <th className="py-3 px-4 font-semibold">Location</th>
                              <th className="py-3 px-4 font-semibold">Status</th>
                              <th className="py-3 px-4 text-right font-semibold">Moderation</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                            {adminListings.map((m) => (
                              <tr key={m.id}>
                                <td className="py-3 px-4">
                                  <div className="font-semibold text-[#F4F7F4]">{m.title}</div>
                                  <div className="text-[11px] text-[#9BB0A3]">{m.category}</div>
                                </td>
                                <td className="py-3 px-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      jumpTo('customers');
                                      void openCustomerDetail(m.sellerId);
                                    }}
                                    className="font-medium text-[#93C9A3] hover:underline cursor-pointer"
                                  >
                                    {m.sellerName}
                                  </button>
                                </td>
                                <td className="py-3 px-4 font-mono-tabular">
                                  {m.quantity} {m.unit}
                                </td>
                                <td className="py-3 px-4">{m.location}</td>
                                <td className="py-3 px-4">
                                  <StatusText status={m.isHidden ? 'Hidden' : m.status} />
                                  {m.hiddenReason && (
                                    <div className="text-[11px] text-[#FCA5A5]">{m.hiddenReason}</div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                                  {m.isHidden ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        requestConfirmation({
                                          title: 'Restore Hidden Listing',
                                          description: `Make "${m.title}" publicly visible again in the Marketplace.`,
                                          confirmLabel: 'Restore Listing',
                                          requireReason: false,
                                          tone: 'primary',
                                          onConfirm: async (reason) => {
                                            await api.adminModerateListing(m.id, {
                                              isHidden: false,
                                              status: 'Active',
                                              reason,
                                            });
                                            onToast('Listing restored.');
                                            await Promise.all([loadListings(), onRefreshAll()]);
                                          },
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded-md bg-[#2B7A58] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                                    >
                                      <Eye className="h-3 w-3" /> Unhide
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        requestConfirmation({
                                          title: 'Hide Material Listing',
                                          description: `Hide "${m.title}" from public Marketplace views while preserving its order records.`,
                                          confirmLabel: 'Hide Listing',
                                          requireReason: true,
                                          tone: 'danger',
                                          onConfirm: async (reason) => {
                                            await api.adminModerateListing(m.id, { isHidden: true, reason });
                                            onToast('Listing hidden from public view.');
                                            await Promise.all([loadListings(), onRefreshAll()]);
                                          },
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded-md border border-[#E06C75]/35 bg-[#361619] px-2.5 py-1 text-[11px] font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                                    >
                                      <EyeOff className="h-3 w-3" /> Hide
                                    </button>
                                  )}
                                  {m.status === 'Active' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        requestConfirmation({
                                          title: 'Pause Material Listing',
                                          description: `Pause "${m.title}" pending supplier clarification.`,
                                          confirmLabel: 'Pause Listing',
                                          requireReason: true,
                                          tone: 'danger',
                                          onConfirm: async (reason) => {
                                            await api.adminModerateListing(m.id, { status: 'Paused', reason });
                                            onToast('Listing paused.');
                                            await Promise.all([loadListings(), onRefreshAll()]);
                                          },
                                        })
                                      }
                                      className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-2.5 py-1 text-[11px] font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                                    >
                                      Pause
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {listTotal > 15 && (
                        <div className="flex items-center justify-between border-t border-[#A9B78D]/15 px-4 py-3 text-xs">
                          <span className="tabular-nums text-[#9BB0A3]">
                            Page {listPage} · {listTotal} total listings
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={listPage <= 1}
                              onClick={() => setListPage((p) => p - 1)}
                              className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              disabled={listPage * 15 >= listTotal}
                              onClick={() => setListPage((p) => p + 1)}
                              className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 6. ORDERS */}
              {section === 'orders' && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
                      <input
                        type="search"
                        value={ordQ}
                        onChange={(e) => {
                          setOrdQ(e.target.value);
                          setOrdPage(1);
                        }}
                        placeholder="Search order ID, listing, buyer, or supplier..."
                        className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>
                    <select
                      aria-label="Filter orders by status"
                      value={ordStatus}
                      onChange={(e) => {
                        setOrdStatus(e.target.value);
                        setOrdPage(1);
                      }}
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                    >
                      <option value="All">All Order Statuses</option>
                      <option value="Request Created">Request Created</option>
                      <option value="Accepted">Accepted</option>
                      <option value="Pickup Scheduled">Pickup Scheduled</option>
                      <option value="Completed">Completed</option>
                      <option value="Declined">Declined</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>

                  {loadingOrders ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
                      Loading real orders...
                    </div>
                  ) : adminOrders.length === 0 ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center">
                      <ClipboardList className="mx-auto h-8 w-8 text-[#93C9A3]" />
                      <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
                        No real orders have been recorded yet.
                      </h3>
                      <p className="mt-1 text-xs text-[#C8D6CD]">
                        Completed and pending material pickup orders placed by registered buyers
                        will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]">
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#A9B78D]/18 bg-[#172620] text-[#D2DDD6]">
                              <th className="py-3 px-4 font-semibold">Order ID</th>
                              <th className="py-3 px-4 font-semibold">Material Lot</th>
                              <th className="py-3 px-4 font-semibold">Buyer</th>
                              <th className="py-3 px-4 font-semibold">Supplier</th>
                              <th className="py-3 px-4 font-semibold">Qty</th>
                              <th className="py-3 px-4 font-semibold">Pickup Date</th>
                              <th className="py-3 px-4 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                            {adminOrders.map((o) => (
                              <tr key={o.id}>
                                <td className="py-3 px-4 font-mono-tabular text-[11px] text-[#9BB0A3]">{o.id}</td>
                                <td className="py-3 px-4 font-semibold text-[#F4F7F4]">
                                  {o.listingTitle}
                                </td>
                                <td className="py-3 px-4">{o.buyerName}</td>
                                <td className="py-3 px-4">{o.sellerName}</td>
                                <td className="py-3 px-4 font-mono-tabular">
                                  {o.requestedQuantity} {o.listingUnit}
                                </td>
                                <td className="py-3 px-4 font-mono-tabular">
                                  {o.preferredDate} {o.preferredTime}
                                </td>
                                <td className="py-3 px-4">
                                  <StatusText status={o.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {ordTotal > 15 && (
                        <div className="flex items-center justify-between border-t border-[#A9B78D]/15 px-4 py-3 text-xs">
                          <span className="tabular-nums text-[#9BB0A3]">
                            Page {ordPage} · {ordTotal} total orders
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={ordPage <= 1}
                              onClick={() => setOrdPage((p) => p - 1)}
                              className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              disabled={ordPage * 15 >= ordTotal}
                              onClick={() => setOrdPage((p) => p + 1)}
                              className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 7. FOOD RESCUE */}
              {section === 'food-rescue' && (
                <div className="space-y-6">
                  <div className="flex flex-col gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
                      <input
                        type="search"
                        value={foodQ}
                        onChange={(e) => setFoodQ(e.target.value)}
                        placeholder="Search donations, donors, recipients, or areas..."
                        className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>
                    <select
                      aria-label="Filter food donations"
                      value={foodStatus}
                      onChange={(e) => setFoodStatus(e.target.value)}
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                    >
                      <option value="All">All Donation Statuses</option>
                      <option value="Available">Available</option>
                      <option value="Accepted">Accepted</option>
                      <option value="Completed">Completed</option>
                      <option value="Expired">Expired</option>
                      <option value="Cancelled">Cancelled</option>
                      <option value="Hidden">Hidden by Admin</option>
                    </select>
                  </div>

                  {loadingFood ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
                      Loading food rescue records...
                    </div>
                  ) : foodDonations.length === 0 ? (
                    <div className="rounded-2xl border border-[#93C9A3]/25 bg-[#111C17] p-12 text-center">
                      <Utensils className="mx-auto h-8 w-8 text-[#93C9A3]" />
                      <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
                        No food donations have been recorded yet.
                      </h3>
                      <p className="mt-1 text-xs text-[#C8D6CD]">
                        Verified surplus food batches posted by restaurants and kitchens will appear
                        here.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-[#93C9A3]/25 bg-[#111C17]">
                      <div className="border-b border-[#A9B78D]/15 bg-[#172620] px-4 py-3 text-xs font-semibold text-[#F4F7F4]">
                        Food Donations ({foodDonations.length})
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#A9B78D]/15 text-[#D2DDD6]">
                              <th className="py-3 px-4 font-semibold">Donation</th>
                              <th className="py-3 px-4 font-semibold">Donor</th>
                              <th className="py-3 px-4 font-semibold">Portions Left</th>
                              <th className="py-3 px-4 font-semibold">Deadline</th>
                              <th className="py-3 px-4 font-semibold">Status</th>
                              <th className="py-3 px-4 text-right font-semibold">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                            {foodDonations.map((d) => (
                              <tr key={d.id}>
                                <td className="py-3 px-4 font-semibold text-[#F4F7F4]">{d.title}</td>
                                <td className="py-3 px-4">{d.donorName}</td>
                                <td className="py-3 px-4 font-mono-tabular">
                                  {d.remainingPortions} / {d.portions}
                                </td>
                                <td className="py-3 px-4 font-mono-tabular">
                                  {formatDateTime(d.pickupDeadline)}
                                </td>
                                <td className="py-3 px-4">
                                  <StatusText status={d.isHidden ? 'Hidden' : d.status} />
                                </td>
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  {d.isHidden ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        requestConfirmation({
                                          title: 'Restore Food Donation',
                                          description: `Make "${d.title}" visible again on Food Rescue.`,
                                          confirmLabel: 'Unhide Donation',
                                          requireReason: false,
                                          tone: 'primary',
                                          onConfirm: async (reason) => {
                                            await api.adminModerateFoodDonation(d.id, {
                                              isHidden: false,
                                              reason,
                                            });
                                            onToast('Food donation restored.');
                                            await Promise.all([loadFoodRescue(), onRefreshAll()]);
                                          },
                                        })
                                      }
                                      className="rounded-md bg-[#2B7A58] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                                    >
                                      Unhide
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        requestConfirmation({
                                          title: 'Hide Food Donation',
                                          description: `Hide "${d.title}" from Food Rescue due to safety or compliance concerns.`,
                                          confirmLabel: 'Hide Donation',
                                          requireReason: true,
                                          tone: 'danger',
                                          onConfirm: async (reason) => {
                                            await api.adminModerateFoodDonation(d.id, {
                                              isHidden: true,
                                              reason,
                                            });
                                            onToast('Food donation hidden.');
                                            await Promise.all([loadFoodRescue(), onRefreshAll()]);
                                          },
                                        })
                                      }
                                      className="rounded-md border border-[#E06C75]/35 bg-[#361619] px-2.5 py-1 text-[11px] font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                                    >
                                      Hide
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {foodRequests.length > 0 && (
                    <div className="overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]">
                      <div className="border-b border-[#A9B78D]/15 bg-[#172620] px-4 py-3 text-xs font-semibold text-[#F4F7F4]">
                        Food Rescue Collection Requests ({foodRequests.length})
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#A9B78D]/15 text-[#D2DDD6]">
                              <th className="py-3 px-4 font-semibold">Donation</th>
                              <th className="py-3 px-4 font-semibold">Donor</th>
                              <th className="py-3 px-4 font-semibold">Recipient</th>
                              <th className="py-3 px-4 font-semibold">Portions</th>
                              <th className="py-3 px-4 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                            {foodRequests.map((r) => (
                              <tr key={r.id}>
                                <td className="py-3 px-4 font-semibold text-[#F4F7F4]">
                                  {r.donationTitle}
                                </td>
                                <td className="py-3 px-4">{r.donorName}</td>
                                <td className="py-3 px-4">{r.recipientName}</td>
                                <td className="py-3 px-4 font-mono-tabular">{r.requestedPortions}</td>
                                <td className="py-3 px-4">
                                  <StatusText status={r.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 8. OIL RECOVERY */}
              {section === 'oil-recovery' && (
                <div className="space-y-6">
                  <div className="flex flex-col gap-3 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4 sm:flex-row">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
                      <input
                        type="search"
                        value={oilQ}
                        onChange={(e) => setOilQ(e.target.value)}
                        placeholder="Search used cooking oil lots, suppliers, or industrial buyers..."
                        className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>
                    <select
                      aria-label="Filter oil lots"
                      value={oilStatus}
                      onChange={(e) => setOilStatus(e.target.value)}
                      className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-sm text-[#F4F7F4] focus-ring"
                    >
                      <option value="All">All Collection Statuses</option>
                      <option value="Available">Available</option>
                      <option value="Enquiry Pending">Enquiry Pending</option>
                      <option value="Scheduled">Scheduled</option>
                      <option value="Collected">Collected</option>
                      <option value="Processed">Processed</option>
                      <option value="Paused">Paused</option>
                    </select>
                  </div>

                  {loadingOil ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
                      Loading oil recovery records...
                    </div>
                  ) : oilListings.length === 0 && oilEnquiries.length === 0 ? (
                    <div className="rounded-2xl border border-[#D9BA7E]/25 bg-[#111C17] p-12 text-center">
                      <Droplets className="mx-auto h-8 w-8 text-[#D9BA7E]" />
                      <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
                        No used cooking oil recovery lots recorded yet.
                      </h3>
                      <p className="mt-1 text-xs text-[#C8D6CD]">
                        Verified kitchen oil lots and industrial buyer enquiries will appear here.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="overflow-hidden rounded-2xl border border-[#D9BA7E]/25 bg-[#111C17]">
                        <div className="border-b border-[#A9B78D]/15 bg-[#172620] px-4 py-3 text-xs font-semibold text-[#F4F7F4]">
                          Used Cooking Oil Lots ({oilListings.length})
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-[#A9B78D]/15 text-[#D2DDD6]">
                                <th className="py-3 px-4 font-semibold">Title & Type</th>
                                <th className="py-3 px-4 font-semibold">Supplier</th>
                                <th className="py-3 px-4 font-semibold">Volume</th>
                                <th className="py-3 px-4 font-semibold">Grade & Container</th>
                                <th className="py-3 px-4 font-semibold">Status</th>
                                <th className="py-3 px-4 text-right font-semibold">Moderation</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                              {oilListings.map((ol) => (
                                <tr key={ol.id}>
                                  <td className="py-3 px-4">
                                    <div className="font-semibold text-[#F4F7F4]">{ol.title}</div>
                                    <div className="text-[11px] text-[#9BB0A3]">{ol.oilType}</div>
                                  </td>
                                  <td className="py-3 px-4">{ol.supplierName}</td>
                                  <td className="py-3 px-4 font-mono-tabular">{ol.volumeLiters} L</td>
                                  <td className="py-3 px-4">
                                    {ol.qualityGrade} · {ol.containerType}
                                  </td>
                                  <td className="py-3 px-4">
                                    <StatusText status={ol.isHidden ? 'Hidden' : ol.collectionStatus} />
                                  </td>
                                  <td className="py-3 px-4 text-right whitespace-nowrap">
                                    {ol.isHidden ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          requestConfirmation({
                                            title: 'Restore Oil Recovery Lot',
                                            description: `Make "${ol.title}" visible again in Used Cooking Oil Recovery.`,
                                            confirmLabel: 'Restore Lot',
                                            requireReason: false,
                                            tone: 'primary',
                                            onConfirm: async (reason) => {
                                              await api.adminModerateOilListing(ol.id, {
                                                isHidden: false,
                                                reason,
                                              });
                                              onToast('Oil listing restored.');
                                              await Promise.all([loadOilRecovery(), onRefreshAll()]);
                                            },
                                          })
                                        }
                                        className="rounded-md bg-[#2B7A58] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                                      >
                                        Unhide
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          requestConfirmation({
                                            title: 'Hide Oil Recovery Lot',
                                            description: `Hide "${ol.title}" from public listings.`,
                                            confirmLabel: 'Hide Lot',
                                            requireReason: true,
                                            tone: 'danger',
                                            onConfirm: async (reason) => {
                                              await api.adminModerateOilListing(ol.id, {
                                                isHidden: true,
                                                reason,
                                              });
                                              onToast('Oil listing hidden.');
                                              await Promise.all([loadOilRecovery(), onRefreshAll()]);
                                            },
                                          })
                                        }
                                        className="rounded-md border border-[#E06C75]/35 bg-[#361619] px-2.5 py-1 text-[11px] font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                                      >
                                        Hide
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {oilEnquiries.length > 0 && (
                        <div className="overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]">
                          <div className="border-b border-[#A9B78D]/15 bg-[#172620] px-4 py-3 text-xs font-semibold text-[#F4F7F4]">
                            Industrial Buyer Enquiries ({oilEnquiries.length})
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b border-[#A9B78D]/15 text-[#D2DDD6]">
                                  <th className="py-3 px-4 font-semibold">Oil Lot</th>
                                  <th className="py-3 px-4 font-semibold">Industrial Buyer</th>
                                  <th className="py-3 px-4 font-semibold">Processing Pathway</th>
                                  <th className="py-3 px-4 font-semibold">Requested Volume</th>
                                  <th className="py-3 px-4 font-semibold">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                                {oilEnquiries.map((oe) => (
                                  <tr key={oe.id}>
                                    <td className="py-3 px-4 font-semibold text-[#F4F7F4]">
                                      {oe.listingTitle}
                                    </td>
                                    <td className="py-3 px-4">
                                      {oe.buyerName}
                                      {oe.buyerOrganization ? ` (${oe.buyerOrganization})` : ''}
                                    </td>
                                    <td className="py-3 px-4">{oe.intendedProcessing}</td>
                                    <td className="py-3 px-4 font-mono-tabular">
                                      {oe.requestedLiters} L
                                    </td>
                                    <td className="py-3 px-4">
                                      <StatusText status={oe.status} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 9. BUSINESS VERIFICATION */}
              {section === 'verifications' && (
                <div className="space-y-4">
                  {verifications.length === 0 ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center">
                      <UserCheck className="mx-auto h-8 w-8 text-[#93C9A3]" />
                      <h3 className="mt-3 font-display text-xl font-semibold text-[#F4F7F4]">
                        No business verification submissions yet.
                      </h3>
                      <p className="mt-1 text-xs text-[#C8D6CD]">
                        Verification requests submitted by registered businesses will appear here for
                        human review.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {verifications.map((v) => (
                        <div
                          key={v.id}
                          className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5 space-y-3 text-xs text-[#D2DDD6]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-display text-lg font-semibold text-[#F4F7F4]">
                                {v.organization}
                              </div>
                              <div className="text-[#9BB0A3]">
                                {v.userName} ({v.userEmail}) · Submitted {formatShortDate(v.submittedAt)}
                              </div>
                            </div>
                            <StatusText status={v.status} />
                          </div>
                          <div>
                            <strong className="text-[#93C9A3]">Materials / Food Handled:</strong>{' '}
                            {v.materialsHandled}
                          </div>
                          <p className="text-[#C8D6CD] leading-relaxed">{v.businessSummary}</p>
                          {v.reviewerNotes && (
                            <div className="rounded-lg border border-[#A9B78D]/15 bg-[#172620] px-3 py-2 text-[#D2DDD6]">
                              <strong className="text-[#F4F7F4]">Reviewer Notes:</strong> {v.reviewerNotes}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2 border-t border-[#A9B78D]/15 pt-3">
                            <button
                              type="button"
                              onClick={() =>
                                requestConfirmation({
                                  title: 'Approve Business Verification',
                                  description: `Grant Verified Business status to ${v.organization} (${v.userName}).`,
                                  confirmLabel: 'Approve Verification',
                                  requireReason: false,
                                  tone: 'primary',
                                  onConfirm: async (reason) => {
                                    await api.reviewVerification(v.id, {
                                      status: 'Approved',
                                      reviewerNotes: reason || undefined,
                                    });
                                    onToast('Business verification approved.');
                                    await Promise.all([loadVerificationsAndReports(), onRefreshAll()]);
                                  },
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-lg bg-[#2B7A58] px-3 py-1.5 font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                requestConfirmation({
                                  title: 'Request Additional Business Information',
                                  description: `Ask ${v.userName} for clarification before deciding on verification.`,
                                  confirmLabel: 'Send Info Request',
                                  requireReason: true,
                                  tone: 'primary',
                                  onConfirm: async (reason) => {
                                    await api.reviewVerification(v.id, {
                                      status: 'More Information Required',
                                      reviewerNotes: reason,
                                    });
                                    onToast('Additional information requested.');
                                    await Promise.all([loadVerificationsAndReports(), onRefreshAll()]);
                                  },
                                })
                              }
                              className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-1.5 font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                            >
                              Request Info
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                requestConfirmation({
                                  title: 'Reject Business Verification',
                                  description: `Decline verification for ${v.organization}. Please provide clear feedback.`,
                                  confirmLabel: 'Reject Verification',
                                  requireReason: true,
                                  tone: 'danger',
                                  onConfirm: async (reason) => {
                                    await api.reviewVerification(v.id, {
                                      status: 'Rejected',
                                      reviewerNotes: reason,
                                    });
                                    onToast('Business verification rejected.');
                                    await Promise.all([loadVerificationsAndReports(), onRefreshAll()]);
                                  },
                                })
                              }
                              className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-1.5 font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 9B. AI LISTING VERIFICATION REVIEWS */}
              {section === 'ai-verifications' && (
                <div className="space-y-6">
                  <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                      <div>
                        <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
                          AI Listing Verification Moderation Queue
                        </h2>
                        <p className="mt-1 text-xs text-[#C8D6CD]">
                          Review AI authenticity checks, user-submitted supporting evidence, and approve or reject listings flagged for human moderation.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadAiVerifications()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] self-start cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Refresh</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9BB0A3]" />
                        <input
                          type="text"
                          value={aiVerQ}
                          onChange={(e) => setAiVerQ(e.target.value)}
                          placeholder="Search listing title, seller, or email..."
                          className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] pl-9 pr-3 py-2 text-xs text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                        />
                      </div>
                      <select
                        value={aiVerStatusFilter}
                        onChange={(e) => setAiVerStatusFilter(e.target.value)}
                        className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-xs text-[#F4F7F4] focus-ring"
                      >
                        <option value="All">All AI Statuses</option>
                        <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
                        <option value="HIGH_RISK">HIGH_RISK</option>
                        <option value="VERIFIED">VERIFIED</option>
                      </select>
                      <select
                        value={aiVerReviewFilter}
                        onChange={(e) => setAiVerReviewFilter(e.target.value)}
                        className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-xs text-[#F4F7F4] focus-ring"
                      >
                        <option value="All">All Human Review States</option>
                        <option value="pending">Pending Human Review</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        <option value="none">Not Requested</option>
                      </select>
                    </div>
                  </div>

                  {loadingAiVer ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-8 text-center text-xs text-[#C8D6CD]">
                      Loading AI verification records...
                    </div>
                  ) : aiVerifications.length === 0 ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-8 text-center text-xs text-[#9BB0A3]">
                      No AI listing verification records match the current filter.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {aiVerifications.map((item) => {
                        const title = String(item.payload?.title ?? 'Untitled Listing');
                        const category = String(item.payload?.category ?? item.payload?.oilType ?? 'N/A');
                        const statusColor =
                          item.status === 'VERIFIED'
                            ? 'text-[#7CE0A3]'
                            : item.status === 'NEEDS_REVIEW'
                              ? 'text-[#FAD089]'
                              : 'text-[#FCA5A5]';
                        const reviewLabel =
                          item.humanReviewStatus === 'none'
                            ? 'Not Requested'
                            : item.humanReviewStatus.charAt(0).toUpperCase() + item.humanReviewStatus.slice(1);
                        return (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-5 space-y-3 text-xs"
                          >
                            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-display text-base font-semibold text-[#F4F7F4]">
                                    {title}
                                  </span>
                                  <span className="rounded bg-[#172620] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#93C9A3]">
                                    {item.listingType}
                                  </span>
                                  <span className={`font-semibold ${statusColor}`}>
                                    AI: {item.status.replace('_', ' ')}
                                  </span>
                                  <span className="text-[#9BB0A3]">
                                    · Human Review: <StatusText status={reviewLabel} />
                                  </span>
                                </div>
                                <div className="mt-1 text-[#9BB0A3]">
                                  Submitted by <strong className="text-[#D2DDD6]">{item.userName || 'User'}</strong>{' '}
                                  {item.userEmail ? `(${item.userEmail})` : ''} · Category: {category} ·{' '}
                                  Risk Score: <span className="font-mono-tabular text-[#F4F7F4]">{item.riskScore}/100</span> ·{' '}
                                  {formatDateTime(item.createdAt)}
                                </div>
                              </div>
                              {item.publishedListingId && (
                                <span className="rounded border border-[#2B7A58]/40 bg-[#123324] px-2.5 py-1 text-[11px] font-semibold text-[#9BF0BC]">
                                  Published
                                </span>
                              )}
                            </div>

                            <p className="text-[#D2DDD6] leading-relaxed">{item.summary}</p>

                            {item.reasons.length > 0 && (
                              <div className="rounded-xl border border-[#A9B78D]/15 bg-[#0D1612] p-3 space-y-1">
                                <div className="font-semibold text-[#93C9A3]">Key Findings</div>
                                <ul className="list-disc pl-4 space-y-1 text-[#D2DDD6]">
                                  {item.reasons.map((r, i) => (
                                    <li key={i}>{r}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {item.evidenceNotes && (
                              <div className="rounded-xl border border-[#D9BA7E]/30 bg-[#251E10] p-3 text-[#F6DFB0]">
                                <strong>Seller Supporting Evidence:</strong> {item.evidenceNotes}
                              </div>
                            )}

                            {item.humanReviewNotes && (
                              <div className="rounded-xl border border-[#A9B78D]/20 bg-[#172620] p-3 text-[#C8D6CD]">
                                <strong>Admin Review Note:</strong> {item.humanReviewNotes}
                              </div>
                            )}

                            {!item.publishedListingId && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    requestConfirmation({
                                      title: 'Approve Listing for Publishing',
                                      description: `Approve "${title}" after reviewing AI findings and supporting evidence so the owner can publish it.`,
                                      confirmLabel: 'Approve Listing',
                                      requireReason: false,
                                      tone: 'primary',
                                      onConfirm: async (reason) => {
                                        await api.adminReviewAiVerification(item.id, {
                                          decision: 'approved',
                                          notes: reason || undefined,
                                        });
                                        onToast('Listing verification approved. Owner can now publish.');
                                        await loadAiVerifications();
                                      },
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#2B7A58] px-3 py-1.5 font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve to Publish
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    requestConfirmation({
                                      title: 'Reject Listing Verification',
                                      description: `Reject "${title}" and keep it blocked from publishing. Provide a clear reason for the user.`,
                                      confirmLabel: 'Reject Listing',
                                      requireReason: true,
                                      tone: 'danger',
                                      onConfirm: async (reason) => {
                                        await api.adminReviewAiVerification(item.id, {
                                          decision: 'rejected',
                                          notes: reason,
                                        });
                                        onToast('Listing verification rejected.');
                                        await loadAiVerifications();
                                      },
                                    })
                                  }
                                  className="rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-1.5 font-semibold text-[#FFB3B8] hover:bg-[#4A1D21] cursor-pointer"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 10. REPORTS & IMPACT */}
              {section === 'reports-impact' && (
                <div className="space-y-8">
                  {/* Verified vs Total Live Impact Ledger */}
                  {impact && (
                    <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-[#93C9A3]" />
                        <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                          Live Impact Ledger: Verified vs Total Completed
                        </h2>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
                        <div className="rounded-xl border border-[#A9B78D]/18 bg-[#172620] p-4">
                          <div className="text-[#C8D6CD]">Materials Recovered</div>
                          <div className="mt-1 font-mono-tabular text-2xl font-semibold text-[#F4F7F4]">
                            {impact.live.materialsRecoveredKg} kg
                          </div>
                          <div className="mt-1 text-[#9BB0A3] tabular-nums">
                            From verified businesses: {impact.live.verifiedMaterialsRecoveredKg} kg
                          </div>
                        </div>
                        <div className="rounded-xl border border-[#93C9A3]/25 bg-[#172620] p-4">
                          <div className="text-[#C8D6CD]">Food Portions Rescued</div>
                          <div className="mt-1 font-mono-tabular text-2xl font-semibold text-[#93C9A3]">
                            {impact.live.foodPortionsRescued} portions
                          </div>
                          <div className="mt-1 text-[#9BB0A3] tabular-nums">
                            From verified donors: {impact.live.verifiedFoodPortionsRescued} portions
                          </div>
                        </div>
                        <div className="rounded-xl border border-[#D9BA7E]/25 bg-[#172620] p-4">
                          <div className="text-[#C8D6CD]">Used Cooking Oil Recovered</div>
                          <div className="mt-1 font-mono-tabular text-2xl font-semibold text-[#D9BA7E]">
                            {impact.live.oilLitersRecovered} L
                          </div>
                          <div className="mt-1 text-[#9BB0A3] tabular-nums">
                            From verified suppliers: {impact.live.verifiedOilLitersRecovered} L
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* User Reports */}
                  <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                      Submitted Moderation Reports ({reports.length})
                    </h2>
                    {reports.length === 0 ? (
                      <p className="text-xs text-[#9BB0A3]">
                        No moderation reports have been filed by users.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {reports.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-xl border border-[#A9B78D]/18 bg-[#172620] p-4 text-xs space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-[#F4F7F4]">
                                {r.targetTitle} ({r.targetType})
                              </span>
                              <StatusText status={r.status} />
                            </div>
                            <div className="text-[#9BB0A3]">
                              Reason: {r.reason} · Reported by {r.reporterName} ·{' '}
                              {formatDateTime(r.createdAt)}
                            </div>
                            {r.details && <p className="text-[#D2DDD6]">{r.details}</p>}
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  requestConfirmation({
                                    title: 'Resolve Report & Pause Target Listing',
                                    description: `Resolve this report and pause/hide "${r.targetTitle}".`,
                                    confirmLabel: 'Resolve & Pause',
                                    requireReason: false,
                                    tone: 'danger',
                                    onConfirm: async (reason) => {
                                      await api.reviewReport(r.id, {
                                        status: 'Resolved',
                                        pauseTarget: true,
                                        adminNotes: reason,
                                      });
                                      onToast('Report resolved and target paused.');
                                      await Promise.all([loadVerificationsAndReports(), onRefreshAll()]);
                                    },
                                  })
                                }
                                className="rounded-md bg-[#2B7A58] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                              >
                                Resolve & Pause Listing
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  requestConfirmation({
                                    title: 'Dismiss Report',
                                    description: `Dismiss report against "${r.targetTitle}" without pausing the listing.`,
                                    confirmLabel: 'Dismiss Report',
                                    requireReason: false,
                                    tone: 'primary',
                                    onConfirm: async (reason) => {
                                      await api.reviewReport(r.id, {
                                        status: 'Dismissed',
                                        pauseTarget: false,
                                        adminNotes: reason,
                                      });
                                      onToast('Report dismissed.');
                                      await loadVerificationsAndReports();
                                    },
                                  })
                                }
                                className="rounded-md border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-1.5 text-[11px] font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* 11. ADMIN AUDIT LOGS */}
              {section === 'audit-logs' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-4">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9BB0A3]" />
                      <input
                        type="search"
                        value={auditQ}
                        onChange={(e) => {
                          setAuditQ(e.target.value);
                          setAuditPage(1);
                        }}
                        placeholder="Search audit action, admin name, target user ID, or details..."
                        className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] py-2 pl-9 pr-3 text-sm text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </div>
                  </div>

                  {loadingAudit ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-10 text-center text-sm text-[#C8D6CD]">
                      Loading audit logs...
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-12 text-center text-sm text-[#C8D6CD]">
                      No administrative audit events recorded yet.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]">
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#A9B78D]/18 bg-[#172620] text-[#D2DDD6]">
                              <th className="py-3 px-3 font-semibold">Timestamp</th>
                              <th className="py-3 px-3 font-semibold">Admin</th>
                              <th className="py-3 px-3 font-semibold">Action</th>
                              <th className="py-3 px-3 font-semibold">Target User ID</th>
                              <th className="py-3 px-3 font-semibold">Reason</th>
                              <th className="py-3 px-3 font-semibold">Result</th>
                              <th className="py-3 px-3 font-semibold">Details</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#A9B78D]/12 text-[#D2DDD6]">
                            {auditLogs.map((l) => (
                              <tr key={l.id}>
                                <td className="py-3 px-3 font-mono-tabular text-[11px] text-[#9BB0A3] whitespace-nowrap">
                                  {formatDateTime(l.createdAt)}
                                </td>
                                <td className="py-3 px-3 whitespace-nowrap">
                                  <div className="font-semibold text-[#F4F7F4]">{l.actorName}</div>
                                  <div className="font-mono-tabular text-[10px] text-[#9BB0A3]">
                                    {l.actorId}
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-mono-tabular font-semibold text-[#93C9A3] whitespace-nowrap">
                                  {l.action}
                                </td>
                                <td className="py-3 px-3 font-mono-tabular text-[11px] whitespace-nowrap">
                                  {l.targetUserId || '—'}
                                </td>
                                <td className="py-3 px-3 text-[#C8D6CD]">{l.reason || '—'}</td>
                                <td className="py-3 px-3 whitespace-nowrap">
                                  <StatusText status={l.result || 'Success'} />
                                </td>
                                <td className="py-3 px-3 text-[#D2DDD6]">{l.details}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {auditTotal > 25 && (
                        <div className="flex items-center justify-between border-t border-[#A9B78D]/15 px-4 py-3 text-xs">
                          <span className="tabular-nums text-[#9BB0A3]">
                            Page {auditPage} · {auditTotal} total audit records
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={auditPage <= 1}
                              onClick={() => setAuditPage((p) => p - 1)}
                              className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              disabled={auditPage * 25 >= auditTotal}
                              onClick={() => setAuditPage((p) => p + 1)}
                              className="rounded-md border border-[#A9B78D]/25 bg-[#172620] px-3 py-1 font-semibold text-[#F4F7F4] disabled:opacity-40 cursor-pointer"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 12. SETTINGS */}
              {section === 'settings' && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                      Marketplace & Food Categories ({categories.length})
                    </h2>
                    <form onSubmit={handleAddCategory} className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          required
                          value={newCatName}
                          onChange={(e) => setNewCatName(e.target.value)}
                          placeholder="Category name"
                          className="flex-1 rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-xs text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                        />
                        <select
                          value={newCatType}
                          onChange={(e) => setNewCatType(e.target.value as 'material' | 'food')}
                          className="rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-xs text-[#F4F7F4] focus-ring"
                        >
                          <option value="material">Material</option>
                          <option value="food">Food</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                        >
                          Add Category
                        </button>
                      </div>
                      <input
                        type="text"
                        value={newCatDesc}
                        onChange={(e) => setNewCatDesc(e.target.value)}
                        placeholder="Short description (optional)"
                        className="w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-xs text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                      />
                    </form>
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#A9B78D]/12 text-xs">
                      {categories.map((c) => (
                        <div key={c.id} className="flex items-center justify-between py-2.5 text-[#D2DDD6]">
                          <div>
                            <strong className="text-[#F4F7F4]">{c.name}</strong> ({c.type})
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.toggleCategory(c.id, !c.isActive);
                              onToast(`Category ${c.isActive ? 'disabled' : 'enabled'}.`);
                              await onRefreshAll();
                            }}
                            className="font-semibold text-[#93C9A3] hover:underline cursor-pointer"
                          >
                            {c.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6 space-y-4 text-xs leading-relaxed text-[#D2DDD6]">
                    <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
                      Platform Security & Data Integrity Policy
                    </h2>
                    <ul className="space-y-2.5">
                      <li className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
                        <span>
                          <strong className="text-[#F4F7F4]">Zero Fake Customers:</strong> Production initializes with zero
                          demo accounts or seeded orders. Only genuine registrations appear in
                          customer directories.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
                        <span>
                          <strong className="text-[#F4F7F4]">Server-Side Role Enforcement:</strong> Every administrative route
                          enforces active session validation and database-verified admin privileges.
                          Self-registration as admin is blocked.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#93C9A3]" />
                        <span>
                          <strong className="text-[#F4F7F4]">Sensitive Data Protection:</strong> Password hashes and session
                          tokens are never serialized to any API response or UI view.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#D9BA7E]" />
                        <span>
                          <strong className="text-[#F4F7F4]">Provisioning Additional Admins:</strong> Use the CLI operator
                          script (<code className="text-[#93C9A3]">npm run create-admin -- "&lt;Name&gt;" &lt;email&gt; &lt;password&gt;</code>)
                          to promote or provision new platform administrators securely.
                        </span>
                      </li>
                    </ul>
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* CONFIRMATION MODAL */}
      {confirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040806]/80 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-[#A9B78D]/25 bg-[#111C17] p-6 text-[#F4F7F4] shadow-2xl">
            <button
              type="button"
              aria-label="Cancel administrative action"
              onClick={() => setConfirmModal(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-[#C8D6CD] hover:bg-[#172620] hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <h3 id="admin-confirm-title" className="font-display text-xl font-semibold text-[#F4F7F4]">
              {confirmModal.title}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#C8D6CD]">
              {confirmModal.description}
            </p>

            {confirmError && (
              <div className="mt-3 rounded-lg border border-[#E06C75]/35 bg-[#361619] px-3 py-2 text-xs text-[#FFB3B8]">
                {confirmError}
              </div>
            )}

            <form onSubmit={handleConfirmSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#D2DDD6]">
                  Administrative Reason {confirmModal.requireReason ? '*' : '(Optional)'}
                </label>
                <textarea
                  rows={3}
                  required={confirmModal.requireReason}
                  minLength={confirmModal.requireReason ? 5 : undefined}
                  value={confirmReason}
                  onChange={(e) => setConfirmReason(e.target.value)}
                  placeholder="Document reason for permanent audit log..."
                  className="mt-1 w-full rounded-lg border border-[#A9B78D]/25 bg-[#0D1612] px-3 py-2 text-xs text-[#F4F7F4] placeholder-[#8FA89B] focus-ring"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-4 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirmBusy}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60 cursor-pointer ${
                    confirmModal.tone === 'danger'
                      ? 'bg-[#A63A42] hover:bg-[#8E2F36]'
                      : 'bg-[#2B7A58] hover:bg-[#348F68]'
                  }`}
                >
                  {confirmBusy ? 'Applying...' : confirmModal.confirmLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
