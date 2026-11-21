import type {
  AccountStatus,
  AccountType,
  AdminCustomerDetail,
  AdminCustomerSummary,
  AdminOverview,
  AppTab,
  AuditLogEntry,
  Category,
  CustomerAdminNote,
  FoodDonation,
  FoodRequest,
  FoodScanResult,
  ImpactSummary,
  ListingKind,
  ListingVerificationRecord,
  MaterialListing,
  MaterialRequest,
  MaterialScanResult,
  NotificationItem,
  OilBuyerEnquiry,
  OilRecoveryListing,
  PersonalImpactSummary,
  ReportRecord,
  ResourceGuideResult,
  User,
  VerificationSubmission,
} from '../types';

const SESSION_STORAGE_KEY = 'verdora_session_id';

function readStoredSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSessionToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const bearer = readStoredSessionToken();
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    storeSessionToken(null);
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getMe: async () => {
    const res = await request<{ user: User | null }>('/api/auth/me');
    if (!res.user) {
      storeSessionToken(null);
    }
    return res;
  },
  loginWithFirebase: async (idToken: string) => {
    const res = await request<{ user: User; token: string; isNewUser: boolean }>('/api/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    storeSessionToken(res.token);
    return res;
  },
  getGoogleAuthStatus: () =>
    request<{ configured: boolean; provider: string; projectId: string | null }>('/api/auth/google/status'),
  logout: async () => {
    try {
      return await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      storeSessionToken(null);
    }
  },
  updateProfile: (payload: {
    name?: string;
    accountType?: Exclude<AccountType, 'admin'>;
    organization?: string;
    location?: string;
    whatsappNumber?: string | null;
  }) =>
    request<{ user: User }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getCategories: () => request<{ categories: Category[] }>('/api/categories'),
  createCategory: (payload: { name: string; type: 'material' | 'food'; description?: string }) =>
    request<{ ok: boolean; id: string }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  toggleCategory: (id: string, isActive: boolean) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  getMaterials: (params?: { q?: string; category?: string; condition?: string; location?: string; status?: string; sort?: string }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
    }
    const qs = sp.toString();
    return request<{ listings: MaterialListing[] }>(`/api/materials${qs ? `?${qs}` : ''}`);
  },
  getMyMaterials: () => request<{ listings: MaterialListing[] }>('/api/my/materials'),
  createMaterial: (payload: Record<string, unknown>) =>
    request<{ listing: MaterialListing }>('/api/materials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMaterial: (id: string, payload: Record<string, unknown>) =>
    request<{ listing: MaterialListing }>(`/api/materials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  cancelMaterial: (id: string) =>
    request<{ listing: MaterialListing }>(`/api/materials/${id}/cancel`, {
      method: 'POST',
    }),

  getMaterialRequests: () => request<{ requests: MaterialRequest[] }>('/api/material-requests'),
  createMaterialRequest: (payload: {
    listingId: string;
    requestedQuantity: number;
    intendedUse: string;
    preferredDate: string;
    preferredTime: string;
    arrangement: 'Pickup' | 'Delivery Coordination';
    notes?: string;
  }) =>
    request<{ ok: boolean; id: string }>('/api/material-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMaterialRequestStatus: (
    id: string,
    payload: { status: string; preferredDate?: string; preferredTime?: string; notes?: string }
  ) =>
    request<{ ok: boolean; status: string }>(`/api/material-requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getFoodDonations: (params?: { q?: string; category?: string; location?: string; status?: string; includeEnded?: boolean; sort?: string }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') sp.set(k, String(v));
      });
    }
    const qs = sp.toString();
    return request<{ donations: FoodDonation[] }>(`/api/food-donations${qs ? `?${qs}` : ''}`);
  },
  getMyFoodDonations: () => request<{ donations: FoodDonation[] }>('/api/my/food-donations'),
  createFoodDonation: (payload: Record<string, unknown>) =>
    request<{ donation: FoodDonation }>('/api/food-donations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateFoodDonation: (id: string, payload: Record<string, unknown>) =>
    request<{ donation: FoodDonation }>(`/api/food-donations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  cancelFoodDonation: (id: string) =>
    request<{ donation: FoodDonation }>(`/api/food-donations/${id}/cancel`, {
      method: 'POST',
    }),
  getFoodRequests: () => request<{ requests: FoodRequest[] }>('/api/food-requests'),
  createFoodRequest: (payload: {
    donationId: string;
    requestedPortions: number;
    preferredTime: string;
    notes?: string;
  }) =>
    request<{ ok: boolean; id: string }>('/api/food-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateFoodRequestStatus: (
    id: string,
    payload: { status: string; preferredTime?: string; notes?: string }
  ) =>
    request<{ ok: boolean; status: string }>(`/api/food-requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Used Cooking Oil Recovery
  getOilListings: (params?: { q?: string; status?: string; location?: string }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
    }
    const qs = sp.toString();
    return request<{ listings: OilRecoveryListing[] }>(`/api/oil-recovery${qs ? `?${qs}` : ''}`);
  },
  createOilListing: (payload: Record<string, unknown>) =>
    request<{ listing: OilRecoveryListing }>('/api/oil-recovery', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOilListing: (id: string, payload: { collectionStatus: string }) =>
    request<{ listing: OilRecoveryListing }>(`/api/oil-recovery/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getOilEnquiries: () => request<{ enquiries: OilBuyerEnquiry[] }>('/api/oil-enquiries'),
  createOilEnquiry: (payload: {
    listingId: string;
    requestedLiters: number;
    intendedProcessing: string;
    preferredCollectionDate: string;
    notes?: string;
  }) =>
    request<{ ok: boolean; id: string }>('/api/oil-enquiries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOilEnquiryStatus: (id: string, payload: { status: string; processingNotes?: string }) =>
    request<{ ok: boolean; status: string }>(`/api/oil-enquiries/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getSaved: () => request<{ saved: Array<{ itemType: 'material' | 'food'; itemId: string }> }>('/api/saved'),
  toggleSaved: (itemType: 'material' | 'food', itemId: string) =>
    request<{ saved: boolean }>('/api/saved/toggle', {
      method: 'POST',
      body: JSON.stringify({ itemType, itemId }),
    }),

  getVerifications: () => request<{ verifications: VerificationSubmission[] }>('/api/verifications'),
  submitVerification: (payload: { organization: string; materialsHandled: string; businessSummary: string }) =>
    request<{ ok: boolean; id: string; status: string }>('/api/verifications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reviewVerification: (id: string, payload: { status: string; reviewerNotes?: string }) =>
    request<{ ok: boolean; status: string }>(`/api/verifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  submitReport: (payload: {
    targetType: 'material' | 'food' | 'oil' | 'user';
    targetId: string;
    targetTitle: string;
    reason: string;
    details?: string;
  }) =>
    request<{ ok: boolean; id: string }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getReports: () => request<{ reports: ReportRecord[] }>('/api/reports'),
  reviewReport: (id: string, payload: { status: string; adminNotes?: string; pauseTarget?: boolean }) =>
    request<{ ok: boolean }>(`/api/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getNotifications: () => request<{ notifications: NotificationItem[] }>('/api/notifications'),
  markNotificationsRead: () => request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  // Real Admin Panel API
  adminGetOverview: () => request<AdminOverview>('/api/admin/overview'),
  adminGetCustomers: (params?: { q?: string; filter?: string; sort?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') sp.set(k, String(v));
      });
    }
    const qs = sp.toString();
    return request<{ customers: AdminCustomerSummary[]; total: number; page: number; pageSize: number }>(
      `/api/admin/customers${qs ? `?${qs}` : ''}`
    );
  },
  adminGetCustomerDetail: (id: string) => request<AdminCustomerDetail>(`/api/admin/customers/${id}`),
  adminUpdateCustomerStatus: (id: string, payload: { accountStatus: AccountStatus; reason?: string }) =>
    request<{ ok: boolean; accountStatus: AccountStatus }>(`/api/admin/customers/${id}/status`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminAddCustomerNote: (id: string, note: string) =>
    request<{ note: CustomerAdminNote }>(`/api/admin/customers/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  adminGetListings: (params?: { q?: string; status?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') sp.set(k, String(v));
      });
    }
    const qs = sp.toString();
    return request<{ listings: MaterialListing[]; total: number; page: number; pageSize: number }>(
      `/api/admin/listings${qs ? `?${qs}` : ''}`
    );
  },
  adminModerateListing: (id: string, payload: { isHidden?: boolean; status?: string; reason?: string }) =>
    request<{ listing: MaterialListing }>(`/api/admin/listings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  adminGetOrders: (params?: { q?: string; status?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') sp.set(k, String(v));
      });
    }
    const qs = sp.toString();
    return request<{
      orders: Array<{
        id: string;
        listingId: string;
        listingTitle: string;
        listingCategory: string;
        listingUnit: string;
        listingLocation: string;
        sellerId: string;
        sellerName: string;
        buyerId: string;
        buyerName: string;
        requestedQuantity: number;
        intendedUse: string;
        preferredDate: string;
        preferredTime: string;
        arrangement: string;
        status: string;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/admin/orders${qs ? `?${qs}` : ''}`);
  },
  adminGetFoodRescue: (params?: { q?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
    }
    const qs = sp.toString();
    return request<{
      donations: FoodDonation[];
      requests: Array<{
        id: string;
        donationId: string;
        donationTitle: string;
        donorId: string;
        donorName: string;
        recipientId: string;
        recipientName: string;
        requestedPortions: number;
        preferredTime: string;
        pickupDeadline: string;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/admin/food-rescue${qs ? `?${qs}` : ''}`);
  },
  adminModerateFoodDonation: (id: string, payload: { isHidden?: boolean; status?: string; reason?: string }) =>
    request<{ donation: FoodDonation }>(`/api/admin/food-donations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  adminGetOilRecovery: (params?: { q?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
    }
    const qs = sp.toString();
    return request<{
      listings: OilRecoveryListing[];
      enquiries: Array<{
        id: string;
        listingId: string;
        listingTitle: string;
        oilType: string;
        supplierId: string;
        supplierName: string;
        buyerId: string;
        buyerName: string;
        buyerOrganization: string;
        requestedLiters: number;
        intendedProcessing: string;
        preferredCollectionDate: string;
        processingNotes: string;
        status: string;
        createdAt: string;
      }>;
    }>(`/api/admin/oil-recovery${qs ? `?${qs}` : ''}`);
  },
  adminModerateOilListing: (id: string, payload: { isHidden?: boolean; collectionStatus?: string; reason?: string }) =>
    request<{ listing: OilRecoveryListing }>(`/api/admin/oil-recovery/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getAuditLogs: (params?: { q?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') sp.set(k, String(v));
      });
    }
    const qs = sp.toString();
    return request<{ logs: AuditLogEntry[]; total?: number; page?: number; pageSize?: number }>(
      `/api/admin/audit-logs${qs ? `?${qs}` : ''}`
    );
  },

  getImpact: () => request<ImpactSummary>('/api/impact'),
  getMyImpactSummary: () => request<PersonalImpactSummary>('/api/my/impact-summary'),

  verifyListing: (payload: {
    listingType: ListingKind;
    payload: Record<string, unknown>;
    evidenceNotes?: string;
    evidenceImageUrl?: string | null;
  }) =>
    request<{ verification: ListingVerificationRecord; mode: 'live-gemini' | 'rule-engine' }>('/api/ai/verify-listing', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  requestVerificationHumanReview: (
    id: string,
    payload: { evidenceNotes?: string; evidenceImageUrl?: string | null }
  ) =>
    request<{ verification: ListingVerificationRecord }>(`/api/ai/verifications/${id}/request-review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getMyVerifications: () => request<{ verifications: ListingVerificationRecord[] }>('/api/ai/verifications/mine'),
  adminGetAiVerifications: (params?: { status?: string; review?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) sp.set(k, v);
      });
    }
    const qs = sp.toString();
    return request<{ verifications: ListingVerificationRecord[] }>(
      `/api/admin/ai-verifications${qs ? `?${qs}` : ''}`
    );
  },
  adminReviewAiVerification: (id: string, payload: { decision: 'approved' | 'rejected'; notes?: string }) =>
    request<{ verification: ListingVerificationRecord }>(`/api/admin/ai-verifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  scanMaterial: (imageDataUrl: string | null, contextText: string) =>
    request<MaterialScanResult>('/api/ai/scan-material', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl, contextText }),
    }),
  scanFood: (imageDataUrl: string | null, contextText: string) =>
    request<FoodScanResult>('/api/ai/scan-food', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl, contextText }),
    }),
  guideResource: (payload: {
    kind: 'food' | 'material';
    query: string;
    location?: string;
    quantityOrPortions?: number;
  }) =>
    request<ResourceGuideResult>('/api/ai/guide', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  askAssistant: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    request<{ reply: string; mode: 'live-gemini' | 'demo-fallback'; isDemoFallback: boolean }>('/api/ai/assistant', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),
};

export type { AppTab };
