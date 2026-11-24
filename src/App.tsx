/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AILabView } from './components/AILabView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { AuthModal } from './components/AuthModal';
import { FoodRescueView, type FoodDraftPrefill } from './components/FoodRescueView';
import { HomePage } from './components/HomePage';
import { ImpactRewardsView } from './components/ImpactRewardsView';
import { MarketplaceView, type MaterialDraftPrefill } from './components/MarketplaceView';
import { Navbar } from './components/Navbar';
import { OilRecoveryView } from './components/OilRecoveryView';
import { WorkspaceView } from './components/WorkspaceView';
import { auth, onAuthStateChanged, signOutFirebase, syncFirestoreUserProfile } from './firebase';
import { api } from './services/api';
import {
  backfillOwnedSQLiteRecordsToFirestore,
  fetchMyCatalogFromFirestore,
  fetchPublicCatalogFromFirestore,
  fetchSavedFromFirestore,
  isOwnerOfResource,
  mergeCatalogItems,
  subscribePublicCatalogFromFirestore,
} from './services/firestoreSync';
import type {
  AppTab,
  Category,
  FoodDonation,
  ImpactSummary,
  MaterialListing,
  OilRecoveryListing,
  User,
} from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [aiSection, setAiSection] = useState<string>('scanner');
  const [user, setUser] = useState<User | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [materials, setMaterials] = useState<MaterialListing[]>([]);
  const [myMaterials, setMyMaterials] = useState<MaterialListing[]>([]);
  const [donations, setDonations] = useState<FoodDonation[]>([]);
  const [myDonations, setMyDonations] = useState<FoodDonation[]>([]);
  const [oilListings, setOilListings] = useState<OilRecoveryListing[]>([]);
  const [impact, setImpact] = useState<ImpactSummary | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const [selectedMaterial, setSelectedMaterial] = useState<MaterialListing | null>(null);
  const [selectedDonation, setSelectedDonation] = useState<FoodDonation | null>(null);
  const [draftPrefill, setDraftPrefill] = useState<MaterialDraftPrefill | null>(null);
  const [foodDraftPrefill, setFoodDraftPrefill] = useState<FoodDraftPrefill | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [pendingTabAfterAuth, setPendingTabAfterAuth] = useState<AppTab | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const userRef = useRef<User | null>(null);
  const authModalOpenRef = useRef(false);
  const restoringFirebaseRef = useRef(false);
  const backfilledUidRef = useRef<string | null>(null);

  const sqliteMaterialsRef = useRef<MaterialListing[]>([]);
  const fsMaterialsRef = useRef<MaterialListing[]>([]);
  const sqliteDonationsRef = useRef<FoodDonation[]>([]);
  const fsDonationsRef = useRef<FoodDonation[]>([]);
  const sqliteOilRef = useRef<OilRecoveryListing[]>([]);
  const fsOilRef = useRef<OilRecoveryListing[]>([]);
  const sqliteMyMaterialsRef = useRef<MaterialListing[]>([]);
  const fsMyMaterialsRef = useRef<MaterialListing[]>([]);
  const sqliteMyDonationsRef = useRef<FoodDonation[]>([]);
  const fsMyDonationsRef = useRef<FoodDonation[]>([]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    authModalOpenRef.current = authModalOpen;
  }, [authModalOpen]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const recomputeMergedCatalog = useCallback((activeUser: User | null) => {
    const mergedMaterials = mergeCatalogItems(sqliteMaterialsRef.current, fsMaterialsRef.current);
    const mergedDonations = mergeCatalogItems(sqliteDonationsRef.current, fsDonationsRef.current);
    const mergedOil = mergeCatalogItems(sqliteOilRef.current, fsOilRef.current);

    setMaterials(mergedMaterials);
    setDonations(mergedDonations);
    setOilListings(mergedOil);

    setSelectedMaterial((prev) =>
      prev ? (mergedMaterials.find((m) => m.id === prev.id) ?? null) : null
    );
    setSelectedDonation((prev) =>
      prev ? (mergedDonations.find((d) => d.id === prev.id) ?? null) : null
    );

    if (activeUser) {
      const ownedFromMergedMat = mergedMaterials.filter((m) =>
        isOwnerOfResource(activeUser, m.sellerId, m.sellerUid)
      );
      const ownedFromMergedFood = mergedDonations.filter((d) =>
        isOwnerOfResource(activeUser, d.donorId, d.donorUid)
      );
      setMyMaterials(
        mergeCatalogItems(
          sqliteMyMaterialsRef.current,
          mergeCatalogItems(fsMyMaterialsRef.current, ownedFromMergedMat)
        )
      );
      setMyDonations(
        mergeCatalogItems(
          sqliteMyDonationsRef.current,
          mergeCatalogItems(fsMyDonationsRef.current, ownedFromMergedFood)
        )
      );
    } else {
      setMyMaterials([]);
      setMyDonations([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [meRes, catRes, matRes, foodRes, oilRes, impRes, fsPublic] = await Promise.all([
        api.getMe(),
        api.getCategories(),
        api.getMaterials(),
        api.getFoodDonations({ includeEnded: true }),
        api.getOilListings(),
        api.getImpact(),
        fetchPublicCatalogFromFirestore().catch(() => ({
          materials: [] as MaterialListing[],
          donations: [] as FoodDonation[],
          oilListings: [] as OilRecoveryListing[],
        })),
      ]);

      setUser(meRes.user);
      setCategories(catRes.categories);
      setImpact(impRes);

      sqliteMaterialsRef.current = matRes.listings;
      fsMaterialsRef.current = fsPublic.materials;
      sqliteDonationsRef.current = foodRes.donations;
      fsDonationsRef.current = fsPublic.donations;
      sqliteOilRef.current = oilRes.listings;
      fsOilRef.current = fsPublic.oilListings;

      if (meRes.user) {
        const fbUid = auth.currentUser?.emailVerified ? auth.currentUser.uid : '';
        const [savedRes, ntfRes, myMatRes, myFoodRes, fsMy, fsSaved] = await Promise.all([
          api.getSaved(),
          api.getNotifications(),
          api.getMyMaterials(),
          api.getMyFoodDonations(),
          fbUid
            ? fetchMyCatalogFromFirestore(fbUid).catch(() => ({
                materials: [] as MaterialListing[],
                donations: [] as FoodDonation[],
              }))
            : Promise.resolve({
                materials: [] as MaterialListing[],
                donations: [] as FoodDonation[],
              }),
          fbUid ? fetchSavedFromFirestore(fbUid).catch(() => []) : Promise.resolve([]),
        ]);

        const combinedSaved = new Set<string>(savedRes.saved.map((s) => s.itemId));
        for (const s of fsSaved) combinedSaved.add(s.itemId);
        setSavedIds(combinedSaved);
        setUnreadNotifications(ntfRes.notifications.filter((n) => !n.isRead).length);

        sqliteMyMaterialsRef.current = myMatRes.listings;
        fsMyMaterialsRef.current = fsMy.materials;
        sqliteMyDonationsRef.current = myFoodRes.donations;
        fsMyDonationsRef.current = fsMy.donations;

        recomputeMergedCatalog(meRes.user);

        if (fbUid && backfilledUidRef.current !== fbUid) {
          backfilledUidRef.current = fbUid;
          const myOil = mergeCatalogItems(oilRes.listings, fsPublic.oilListings).filter((o) =>
            isOwnerOfResource(meRes.user, o.supplierId, o.supplierUid)
          );
          void backfillOwnedSQLiteRecordsToFirestore({
            myMaterials: myMatRes.listings,
            myDonations: myFoodRes.donations,
            myOilListings: myOil,
          }).catch(() => {});
        }
      } else {
        backfilledUidRef.current = null;
        sqliteMyMaterialsRef.current = [];
        fsMyMaterialsRef.current = [];
        sqliteMyDonationsRef.current = [];
        fsMyDonationsRef.current = [];
        setSavedIds(new Set());
        setUnreadNotifications(0);
        recomputeMergedCatalog(null);
      }
    } catch {
      // Keep graceful UI if transient fetch fails
    } finally {
      setAuthChecked(true);
    }
  }, [recomputeMergedCatalog]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const unsubscribe = subscribePublicCatalogFromFirestore({
      onMaterials: (items) => {
        fsMaterialsRef.current = items;
        recomputeMergedCatalog(userRef.current);
      },
      onDonations: (items) => {
        fsDonationsRef.current = items;
        recomputeMergedCatalog(userRef.current);
      },
      onOilListings: (items) => {
        fsOilRef.current = items;
        recomputeMergedCatalog(userRef.current);
      },
    });
    return () => unsubscribe();
  }, [recomputeMergedCatalog]);

  useEffect(() => {
    if (!authChecked) return;
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) return;
      if (userRef.current) {
        if (fbUser.emailVerified && backfilledUidRef.current !== fbUser.uid) {
          void loadAll();
        }
        return;
      }
      if (authModalOpenRef.current || restoringFirebaseRef.current) {
        return;
      }
      restoringFirebaseRef.current = true;
      try {
        const idToken = await fbUser.getIdToken();
        const res = await api.loginWithFirebase(idToken);
        setUser(res.user);
        void syncFirestoreUserProfile(fbUser, res.user).catch(() => {});
        await loadAll();
      } catch (err) {
        await signOutFirebase();
        if (err instanceof Error && err.message) {
          showToast(err.message);
        }
      } finally {
        restoringFirebaseRef.current = false;
      }
    });
    return () => unsubscribe();
  }, [authChecked, loadAll, showToast]);

  const handleNavigate = (tab: AppTab, subSection?: string) => {
    if ((tab === 'workspace' || tab === 'admin') && authChecked && !user) {
      setPendingTabAfterAuth(tab);
      setAuthModalOpen(true);
      return;
    }
    setActiveTab(tab);
    if (tab === 'ai-lab' && subSection) {
      setAiSection(subSection);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#0A110E] text-[#F4F7F4] flex flex-col">
      <Navbar
        activeTab={activeTab}
        onNavigate={handleNavigate}
        user={user}
        unreadNotifications={unreadNotifications}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      <main className="flex-1">
        {activeTab === 'home' && (
          <HomePage
            impact={impact}
            materials={materials}
            donations={donations}
            onNavigate={handleNavigate}
            onSelectMaterial={(item) => setSelectedMaterial(item)}
            onSelectDonation={(item) => setSelectedDonation(item)}
          />
        )}

        {activeTab === 'marketplace' && (
          <MarketplaceView
            user={user}
            categories={categories}
            listings={materials}
            savedIds={savedIds}
            selectedListing={selectedMaterial}
            draftPrefill={draftPrefill}
            onClearDraftPrefill={() => setDraftPrefill(null)}
            onSelectListing={setSelectedMaterial}
            onRefresh={loadAll}
            onRequireAuth={() => setAuthModalOpen(true)}
            onToast={showToast}
            onOpenOilRecovery={() => handleNavigate('oil-recovery')}
          />
        )}

        {activeTab === 'oil-recovery' && (
          <OilRecoveryView
            user={user}
            listings={oilListings}
            onRefresh={loadAll}
            onRequireAuth={() => setAuthModalOpen(true)}
            onToast={showToast}
          />
        )}

        {activeTab === 'food-rescue' && (
          <FoodRescueView
            user={user}
            categories={categories}
            donations={donations}
            selectedDonation={selectedDonation}
            draftPrefill={foodDraftPrefill}
            onClearDraftPrefill={() => setFoodDraftPrefill(null)}
            onSelectDonation={setSelectedDonation}
            onRefresh={loadAll}
            onRequireAuth={() => setAuthModalOpen(true)}
            onToast={showToast}
          />
        )}

        {activeTab === 'ai-lab' && (
          <AILabView
            key={aiSection}
            initialSection={aiSection}
            categories={categories}
            listings={materials}
            donations={donations}
            onCreateListingFromScan={(draft) => {
              setDraftPrefill(draft);
              setActiveTab('marketplace');
              if (!user) setAuthModalOpen(true);
            }}
            onCreateFoodDonationFromAI={(draft) => {
              setFoodDraftPrefill(draft);
              setActiveTab('food-rescue');
              if (!user) setAuthModalOpen(true);
            }}
            onInspectListing={(item) => {
              setSelectedMaterial(item);
              setActiveTab('marketplace');
            }}
            onInspectDonation={(item) => {
              setSelectedDonation(item);
              setActiveTab('food-rescue');
            }}
          />
        )}

        {activeTab === 'impact' && (
          <ImpactRewardsView impact={impact} user={user} onToast={showToast} />
        )}

        {activeTab === 'workspace' && (
          <WorkspaceView
            user={user}
            categories={categories}
            materials={myMaterials}
            donations={myDonations}
            oilListings={oilListings}
            onRefreshAll={loadAll}
            onUserUpdated={async (u) => {
              setUser(u);
              if (!u) {
                await signOutFirebase();
                setActiveTab('home');
              }
              await loadAll();
            }}
            onRequireAuth={() => setAuthModalOpen(true)}
            onToast={showToast}
            onOpenAdmin={() => handleNavigate('admin')}
          />
        )}

        {activeTab === 'admin' && (
          <AdminDashboardView
            user={user}
            categories={categories}
            impact={impact}
            onRefreshAll={loadAll}
            onToast={showToast}
            onBackToWorkspace={() => handleNavigate('workspace')}
          />
        )}
      </main>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          setPendingTabAfterAuth(null);
        }}
        onSuccess={async (loggedInUser) => {
          setUser(loggedInUser);
          if (pendingTabAfterAuth) {
            if (pendingTabAfterAuth === 'admin' && loggedInUser.role !== 'admin') {
              setActiveTab('workspace');
            } else {
              setActiveTab(pendingTabAfterAuth);
            }
            setPendingTabAfterAuth(null);
          } else if (activeTab === 'home') {
            setActiveTab(loggedInUser.role === 'admin' ? 'admin' : 'workspace');
          }
          showToast(`Signed in as ${loggedInUser.name}.`);
          await loadAll();
        }}
      />

      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 rounded-xl border border-[#93C9A3]/35 bg-[#1C382C] px-4 py-3 text-xs font-semibold text-[#F4F7F4] shadow-2xl"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
