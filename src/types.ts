export type UserRole = 'member' | 'seller' | 'donor' | 'admin';

export type AccountType =
  | 'buyer'
  | 'material_buyer'
  | 'material_supplier'
  | 'restaurant_donor'
  | 'food_recipient'
  | 'industrial_buyer'
  | 'oil_collection_partner'
  | 'recycling_processor'
  | 'general_user'
  | 'admin';

export type AccountStatus = 'Active' | 'Suspended' | 'Deactivated';

export type VerificationStatus =
  | 'Not Submitted'
  | 'Submitted'
  | 'Under Review'
  | 'Approved'
  | 'Rejected'
  | 'More Information Required';

export type MaterialStatus = 'Active' | 'Paused' | 'Unavailable' | 'Completed' | 'Cancelled';

export type MaterialRequestStatus =
  | 'Request Created'
  | 'Accepted'
  | 'Coordination In Progress'
  | 'Pickup Scheduled'
  | 'Collected'
  | 'Completed'
  | 'Declined'
  | 'Cancelled';

export type FoodDonationStatus =
  | 'Available'
  | 'Request Received'
  | 'Accepted'
  | 'Coordination In Progress'
  | 'Pickup Scheduled'
  | 'Completed'
  | 'Cancelled'
  | 'Expired';

export type FoodRequestStatus =
  | 'Request Received'
  | 'Accepted'
  | 'Coordination In Progress'
  | 'Pickup Scheduled'
  | 'Completed'
  | 'Declined'
  | 'Cancelled';

export type OilCollectionStatus =
  | 'Available'
  | 'Enquiry Pending'
  | 'Scheduled'
  | 'Collected'
  | 'Processed'
  | 'Paused'
  | 'Cancelled';

export type OilEnquiryStatus =
  | 'Pending'
  | 'Accepted'
  | 'Scheduled'
  | 'Collected'
  | 'Completed'
  | 'Declined'
  | 'Cancelled';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  accountType: AccountType;
  accountStatus: AccountStatus;
  organization: string;
  location: string;
  whatsappNumber: string | null;
  verificationStatus: VerificationStatus;
  verificationNotes: string | null;
  publicLeaderboard: boolean;
  points: number;
  isDemo: boolean;
  avatarUrl?: string | null;
  authProvider?: 'email' | 'google' | 'email+google';
  lastLoginAt?: string | null;
  firebaseUid?: string | null;
  needsRoleSelection?: boolean;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  type: 'material' | 'food';
  description: string;
  isActive: boolean;
}

export interface MaterialListing {
  id: string;
  sellerId: string;
  sellerUid?: string;
  sellerName: string;
  sellerOrganization: string;
  sellerVerified: boolean;
  title: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  condition: string;
  location: string;
  indicativePrice: number | null;
  currency: string;
  imageUrl: string;
  availableUntil: string;
  pickupPreferences: string;
  reuseApplications: string[];
  whatsappNumber: string | null;
  status: MaterialStatus;
  verificationId?: string | null;
  aiVerificationStatus?: string | null;
  isHidden?: boolean;
  hiddenReason?: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialRequest {
  id: string;
  listingId: string;
  listingTitle: string;
  listingCategory: string;
  listingUnit: string;
  listingLocation: string;
  sellerId: string;
  sellerUid?: string;
  sellerName: string;
  sellerWhatsapp: string | null;
  buyerId: string;
  buyerUid?: string;
  buyerName: string;
  buyerWhatsapp: string | null;
  requestedQuantity: number;
  intendedUse: string;
  preferredDate: string;
  preferredTime: string;
  arrangement: 'Pickup' | 'Delivery Coordination';
  notes: string;
  status: MaterialRequestStatus;
  handoverConfirmedByBuyer: boolean;
  handoverConfirmedBySeller: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FoodDonation {
  id: string;
  donorId: string;
  donorUid?: string;
  donorName: string;
  donorOrganization: string;
  donorVerified: boolean;
  title: string;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  portions: number;
  remainingPortions: number;
  preparedAt: string | null;
  availableUntil: string;
  pickupDeadline: string;
  storageInfo: string;
  packagingInfo: string;
  allergens: string;
  dietaryInfo: string;
  location: string;
  collectionInstructions: string;
  imageUrl: string;
  whatsappNumber: string | null;
  status: FoodDonationStatus;
  verificationId?: string | null;
  aiVerificationStatus?: string | null;
  isHidden?: boolean;
  hiddenReason?: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FoodRequest {
  id: string;
  donationId: string;
  donationTitle: string;
  donationLocation: string;
  pickupDeadline: string;
  donorId: string;
  donorUid?: string;
  donorName: string;
  donorWhatsapp: string | null;
  recipientId: string;
  recipientUid?: string;
  recipientName: string;
  recipientWhatsapp: string | null;
  requestedPortions: number;
  preferredTime: string;
  notes: string;
  status: FoodRequestStatus;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OilRecoveryListing {
  id: string;
  supplierId: string;
  supplierUid?: string;
  supplierName: string;
  supplierOrganization: string;
  supplierVerified: boolean;
  title: string;
  oilType: string;
  volumeLiters: number;
  qualityGrade: string;
  containerType: string;
  filtrationStatus: string;
  pickupWindow: string;
  location: string;
  collectionStatus: OilCollectionStatus;
  verificationId?: string | null;
  aiVerificationStatus?: string | null;
  whatsappNumber: string | null;
  isHidden?: boolean;
  hiddenReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OilBuyerEnquiry {
  id: string;
  listingId: string;
  listingTitle: string;
  oilType: string;
  listingLocation: string;
  supplierId: string;
  supplierUid?: string;
  supplierName: string;
  supplierWhatsapp: string | null;
  buyerId: string;
  buyerUid?: string;
  buyerName: string;
  buyerOrganization: string;
  buyerWhatsapp: string | null;
  requestedLiters: number;
  intendedProcessing: string;
  preferredCollectionDate: string;
  notes: string;
  processingNotes: string;
  status: OilEnquiryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReportRecord {
  id: string;
  reporterId: string;
  reporterName: string;
  targetType: 'material' | 'food' | 'oil' | 'user';
  targetId: string;
  targetTitle: string;
  reason: string;
  details: string;
  status: 'Open' | 'Under Review' | 'Resolved' | 'Dismissed';
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationSubmission {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  organization: string;
  materialsHandled: string;
  businessSummary: string;
  status: VerificationStatus;
  reviewerNotes: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  linkTab: string;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  targetUserId?: string | null;
  reason?: string | null;
  result?: string;
  details: string;
  createdAt: string;
}

export interface CustomerAdminNote {
  id: string;
  userId: string;
  adminId: string;
  adminName: string;
  note: string;
  createdAt: string;
}

export interface AdminOverview {
  customers: {
    total: number;
    active: number;
    newToday: number;
    newThisWeek: number;
    newThisMonth: number;
    pendingVerifications: number;
    suspended: number;
    deactivated: number;
  };
  marketplace: {
    activeListings: number;
    hiddenListings: number;
    completedOrders: number;
    pendingOrders: number;
    cancelledOrders: number;
    registeredSuppliers: number;
    registeredBuyers: number;
  };
  foodRescue: {
    registeredDonors: number;
    registeredRecipients: number;
    activeDonations: number;
    acceptedRequests: number;
    completedHandovers: number;
    rescuedPortions: number;
  };
  oilRecovery: {
    totalListings: number;
    registeredOilSuppliers: number;
    registeredIndustrialBuyers: number;
    pendingEnquiries: number;
    completedRecoveries: number;
    totalLitersRecovered: number;
  };
  moderation: {
    openReports: number;
    pendingVerifications: number;
  };
}

export interface AdminCustomerSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  accountType: AccountType;
  accountStatus: AccountStatus;
  organization: string;
  location: string;
  whatsappNumber: string | null;
  verificationStatus: VerificationStatus;
  avatarUrl?: string | null;
  authProvider?: 'email' | 'google' | 'email+google';
  lastLoginAt?: string | null;
  points: number;
  listingsCount: number;
  ordersCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface AdminCustomerDetail {
  customer: User & {
    suspendedAt: string | null;
    suspensionReason: string | null;
    deactivatedAt: string | null;
  };
  materialListings: MaterialListing[];
  materialOrders: Array<{
    id: string;
    listingId: string;
    listingTitle: string;
    listingUnit: string;
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
  }>;
  foodDonations: FoodDonation[];
  foodRequests: Array<{
    id: string;
    donationId: string;
    donationTitle: string;
    donorId: string;
    donorName: string;
    recipientId: string;
    recipientName: string;
    requestedPortions: number;
    preferredTime: string;
    status: string;
    createdAt: string;
  }>;
  oilListings: OilRecoveryListing[];
  oilEnquiries: Array<{
    id: string;
    listingId: string;
    listingTitle: string;
    supplierName: string;
    buyerName: string;
    requestedLiters: number;
    intendedProcessing: string;
    status: string;
    createdAt: string;
  }>;
  verifications: Array<{
    id: string;
    organization: string;
    materialsHandled: string;
    businessSummary: string;
    status: VerificationStatus;
    reviewerNotes: string | null;
    submittedAt: string;
    reviewedAt: string | null;
  }>;
  adminNotes: CustomerAdminNote[];
  moderationHistory: AuditLogEntry[];
}

export interface ImpactSummary {
  live: {
    materialsRecoveredKg: number;
    verifiedMaterialsRecoveredKg: number;
    materialHandoversCompleted: number;
    nonMassMaterialUnitsCompleted: number;
    foodPortionsRescued: number;
    verifiedFoodPortionsRescued: number;
    foodHandoversCompleted: number;
    oilLitersRecovered: number;
    verifiedOilLitersRecovered: number;
    oilRecoveriesCompleted: number;
    activeMaterialListings: number;
    activeFoodDonations: number;
    activeOilListings: number;
    pendingMaterialRequests: number;
    pendingFoodRequests: number;
    pendingOilEnquiries: number;
    communityParticipants: number;
  };
  categoryBreakdown: Array<{
    category: string;
    handovers: number;
    massKg: number;
    portions: number;
    liters: number;
  }>;
  monthlySeries: Array<{
    month: string;
    materialKg: number;
    foodPortions: number;
    oilLiters: number;
    handovers: number;
  }>;
  methodology: {
    massRule: string;
    exclusionRule: string;
    duplicateRule: string;
    verifiedDistinction: string;
    carbonPolicy: string;
  };
}

export interface PersonalImpactSummary {
  points: number;
  completedHandovers: number;
  achievements: string[];
}

export type ListingKind = 'material' | 'food' | 'oil';

export type AIVerificationStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'HIGH_RISK';

export interface VerificationCheckItem {
  area:
    | 'description'
    | 'duplicates'
    | 'image'
    | 'consistency'
    | 'pricing'
    | 'evidence'
    | 'safety';
  label: string;
  status: 'pass' | 'warning' | 'fail';
  explanation: string;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  location: string;
  reason: string;
  similarityScore: number;
}

export interface ListingVerificationRecord {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  listingType: ListingKind;
  status: AIVerificationStatus;
  humanReviewStatus: 'none' | 'pending' | 'approved' | 'rejected';
  humanReviewNotes: string | null;
  riskScore: number;
  summary: string;
  reasons: string[];
  actionRequired: string | null;
  checks: VerificationCheckItem[];
  duplicateMatches: DuplicateMatch[];
  evidenceNotes: string;
  hasEvidenceImage: boolean;
  canPublish: boolean;
  publishedListingId: string | null;
  payload: Record<string, unknown>;
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface MaterialScanResult {
  mode: 'live-gemini' | 'demo-fallback';
  isDemoFallback: boolean;
  predictedMaterial: string;
  suggestedCategory: string;
  visibleCondition: string;
  confidenceLabel: string;
  confidenceScore: number | null;
  observations: string[];
  reuseApplications: string[];
  qualityChecklist: string[];
  suggestedTitle: string;
  suggestedDescription: string;
  disclaimer: string;
}

export interface FoodScanResult {
  mode: 'live-gemini' | 'demo-fallback';
  isDemoFallback: boolean;
  predictedFood: string;
  suggestedCategory: string;
  estimatedQuantity: number;
  estimatedUnit: string;
  estimatedPortions: number;
  storageAdvice: string;
  packagingAdvice: string;
  potentialAllergens: string;
  dietaryTags: string;
  confidenceLabel: string;
  confidenceScore: number | null;
  observations: string[];
  handlingChecklist: string[];
  suggestedTitle: string;
  suggestedDescription: string;
  disclaimer: string;
}

export interface ResourceGuideResult {
  mode: 'live-gemini' | 'demo-fallback';
  isDemoFallback: boolean;
  summary: string;
  steps: string[];
  safetyOrQualityNote: string;
  matchedIds: string[];
}

export interface MatchResult {
  listing: MaterialListing;
  relevanceScore: number;
  reasons: string[];
  quantityCompatibility: 'Exact / Sufficient' | 'Partial Supply' | 'Check Quantity';
}

export type AppTab =
  | 'home'
  | 'marketplace'
  | 'oil-recovery'
  | 'food-rescue'
  | 'ai-lab'
  | 'impact'
  | 'workspace'
  | 'admin';
