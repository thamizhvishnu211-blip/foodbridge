import { Express } from 'express';
import { createId, db } from './db.ts';
import {
  addNotification,
  AuthedRequest,
  createRateLimiter,
  expireOutdatedFoodDonations,
  logAudit,
  mapFoodDonation,
  mapMaterialListing,
  mapOilListing,
  requireAdmin,
  sanitizeUser,
} from './shared.ts';

export function registerAdminRoutes(app: Express) {
  const adminMutationLimiter = createRateLimiter(60_000, 60, 'admin-mut');

  // 1. LIVE OVERVIEW METRICS (100% real DB queries)
  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    expireOutdatedFoodDonations();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 86400_000).toISOString();

    const totalCustomers = (
      db.prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin'`).get() as { c: number }
    ).c;
    const activeAccounts = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin' AND account_status = 'Active'`)
        .get() as { c: number }
    ).c;
    const newToday = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin' AND created_at >= ?`)
        .get(startOfToday) as { c: number }
    ).c;
    const newThisWeek = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin' AND created_at >= ?`)
        .get(weekAgo) as { c: number }
    ).c;
    const newThisMonth = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin' AND created_at >= ?`)
        .get(monthAgo) as { c: number }
    ).c;
    const pendingVerifications = (
      db
        .prepare(`SELECT COUNT(*) as c FROM verification_requests WHERE status IN ('Submitted','Under Review','More Information Required')`)
        .get() as { c: number }
    ).c;
    const suspendedAccounts = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin' AND account_status = 'Suspended'`)
        .get() as { c: number }
    ).c;
    const deactivatedAccounts = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND role != 'admin' AND account_status = 'Deactivated'`)
        .get() as { c: number }
    ).c;

    // Marketplace metrics
    const activeListings = (
      db
        .prepare(`SELECT COUNT(*) as c FROM material_listings WHERE is_demo = 0 AND status = 'Active' AND is_hidden = 0`)
        .get() as { c: number }
    ).c;
    const hiddenListings = (
      db
        .prepare(`SELECT COUNT(*) as c FROM material_listings WHERE is_demo = 0 AND (is_hidden = 1 OR status = 'Paused')`)
        .get() as { c: number }
    ).c;
    const completedOrders = (
      db.prepare(`SELECT COUNT(*) as c FROM material_requests WHERE is_demo = 0 AND status = 'Completed'`).get() as {
        c: number;
      }
    ).c;
    const pendingOrders = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM material_requests WHERE is_demo = 0 AND status IN ('Request Created','Accepted','Coordination In Progress','Pickup Scheduled','Collected')`
        )
        .get() as { c: number }
    ).c;
    const cancelledOrders = (
      db
        .prepare(`SELECT COUNT(*) as c FROM material_requests WHERE is_demo = 0 AND status IN ('Cancelled','Declined')`)
        .get() as { c: number }
    ).c;
    const registeredSuppliers = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND account_type IN ('material_supplier','recycling_processor','oil_collection_partner')`
        )
        .get() as { c: number }
    ).c;
    const registeredBuyers = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND account_type IN ('buyer','material_buyer','industrial_buyer')`
        )
        .get() as { c: number }
    ).c;

    // Food rescue metrics
    const registeredFoodDonors = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND account_type = 'restaurant_donor'`)
        .get() as { c: number }
    ).c;
    const registeredFoodRecipients = (
      db
        .prepare(`SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND account_type = 'food_recipient'`)
        .get() as { c: number }
    ).c;
    const activeFoodDonations = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM food_donations WHERE is_demo = 0 AND is_hidden = 0 AND status IN ('Available','Request Received','Accepted','Coordination In Progress','Pickup Scheduled') AND remaining_portions > 0`
        )
        .get() as { c: number }
    ).c;
    const acceptedFoodRequests = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM food_requests WHERE is_demo = 0 AND status IN ('Accepted','Coordination In Progress','Pickup Scheduled')`
        )
        .get() as { c: number }
    ).c;
    const completedFoodHandovers = (
      db.prepare(`SELECT COUNT(*) as c FROM food_requests WHERE is_demo = 0 AND status = 'Completed'`).get() as {
        c: number;
      }
    ).c;
    const rescuedFoodPortions = (
      db
        .prepare(`SELECT COALESCE(SUM(portions), 0) as p FROM impact_ledger WHERE is_demo = 0 AND source_type = 'food'`)
        .get() as { p: number }
    ).p;

    // Oil recovery metrics
    const oilListings = (
      db.prepare(`SELECT COUNT(*) as c FROM oil_recovery_listings WHERE is_hidden = 0`).get() as { c: number }
    ).c;
    const registeredOilSuppliers = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT u.id) as c FROM users u LEFT JOIN oil_recovery_listings ol ON ol.supplier_id = u.id WHERE u.is_demo = 0 AND (u.account_type IN ('restaurant_donor','oil_collection_partner') OR ol.id IS NOT NULL)`
        )
        .get() as { c: number }
    ).c;
    const registeredIndustrialBuyers = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM users WHERE is_demo = 0 AND account_type IN ('industrial_buyer','recycling_processor')`
        )
        .get() as { c: number }
    ).c;
    const pendingOilEnquiries = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM oil_buyer_enquiries WHERE status IN ('Pending','Accepted','Scheduled','Collected')`
        )
        .get() as { c: number }
    ).c;
    const completedOilRecoveries = (
      db.prepare(`SELECT COUNT(*) as c FROM oil_buyer_enquiries WHERE status = 'Completed'`).get() as { c: number }
    ).c;
    const totalOilLitersRecovered = (
      db
        .prepare(`SELECT COALESCE(SUM(liters), 0) as l FROM impact_ledger WHERE is_demo = 0 AND source_type = 'oil'`)
        .get() as { l: number }
    ).l;

    const openReports = (
      db.prepare(`SELECT COUNT(*) as c FROM reports WHERE status IN ('Open','Under Review')`).get() as { c: number }
    ).c;

    res.json({
      customers: {
        total: totalCustomers,
        active: activeAccounts,
        newToday,
        newThisWeek,
        newThisMonth,
        pendingVerifications,
        suspended: suspendedAccounts,
        deactivated: deactivatedAccounts,
      },
      marketplace: {
        activeListings,
        hiddenListings,
        completedOrders,
        pendingOrders,
        cancelledOrders,
        registeredSuppliers,
        registeredBuyers,
      },
      foodRescue: {
        registeredDonors: registeredFoodDonors,
        registeredRecipients: registeredFoodRecipients,
        activeDonations: activeFoodDonations,
        acceptedRequests: acceptedFoodRequests,
        completedHandovers: completedFoodHandovers,
        rescuedPortions: Number(rescuedFoodPortions || 0),
      },
      oilRecovery: {
        totalListings: oilListings,
        registeredOilSuppliers,
        registeredIndustrialBuyers,
        pendingEnquiries: pendingOilEnquiries,
        completedRecoveries: completedOilRecoveries,
        totalLitersRecovered: Number(Number(totalOilLitersRecovered || 0).toFixed(1)),
      },
      moderation: {
        openReports,
        pendingVerifications,
      },
    });
  });

  // 2. CUSTOMERS LIST (Search, Filter, Sort, Paginate) — NO PASSWORDS / TOKENS
  app.get('/api/admin/customers', requireAdmin, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const filter = typeof req.query.filter === 'string' ? req.query.filter.trim() : 'all';
    const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : 'newest';
    const includeAdmins = req.query.includeAdmins === 'true';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 15));

    const rows = db
      .prepare(
        `SELECT u.*,
          (SELECT COUNT(*) FROM material_listings ml WHERE ml.seller_id = u.id) +
          (SELECT COUNT(*) FROM food_donations fd WHERE fd.donor_id = u.id) +
          (SELECT COUNT(*) FROM oil_recovery_listings ol WHERE ol.supplier_id = u.id) as total_listings,
          (SELECT COUNT(*) FROM material_requests mr WHERE mr.buyer_id = u.id) +
          (SELECT COUNT(*) FROM food_requests fr WHERE fr.recipient_id = u.id) +
          (SELECT COUNT(*) FROM oil_buyer_enquiries oe WHERE oe.buyer_id = u.id) as total_orders
         FROM users u
         WHERE u.is_demo = 0`
      )
      .all() as Array<Record<string, unknown>>;

    let list = rows
      .filter((r) => includeAdmins || String(r.role) !== 'admin')
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        email: String(r.email),
        role: String(r.role),
        accountType: String(r.account_type || 'buyer'),
        accountStatus: String(r.account_status || 'Active'),
        organization: String(r.organization ?? ''),
        location: String(r.location ?? ''),
        whatsappNumber: r.whatsapp_number ? String(r.whatsapp_number) : null,
        verificationStatus: String(r.verification_status ?? 'Not Submitted'),
        avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
        authProvider: String(r.auth_provider || 'email') as 'email' | 'google' | 'email+google',
        lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
        points: Number(r.points ?? 0),
        listingsCount: Number(r.total_listings ?? 0),
        ordersCount: Number(r.total_orders ?? 0),
        lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
        createdAt: String(r.created_at),
      }));

    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.organization.toLowerCase().includes(q)
      );
    }

    switch (filter) {
      case 'buyers':
        list = list.filter(
          (c) =>
            c.accountType === 'buyer' ||
            c.accountType === 'material_buyer' ||
            c.accountType === 'industrial_buyer'
        );
        break;
      case 'suppliers':
        list = list.filter(
          (c) =>
            c.accountType === 'material_supplier' ||
            c.accountType === 'recycling_processor' ||
            c.accountType === 'oil_collection_partner'
        );
        break;
      case 'restaurants':
      case 'food_donors':
        list = list.filter((c) => c.accountType === 'restaurant_donor');
        break;
      case 'food_recipients':
        list = list.filter((c) => c.accountType === 'food_recipient');
        break;
      case 'industrial_buyers':
        list = list.filter(
          (c) =>
            c.accountType === 'industrial_buyer' ||
            c.accountType === 'recycling_processor' ||
            c.accountType === 'oil_collection_partner'
        );
        break;
      case 'verified_businesses':
        list = list.filter((c) => c.verificationStatus === 'Approved');
        break;
      case 'pending_verification':
        list = list.filter((c) => ['Submitted', 'Under Review', 'More Information Required'].includes(c.verificationStatus));
        break;
      case 'active':
        list = list.filter((c) => c.accountStatus === 'Active');
        break;
      case 'suspended':
        list = list.filter((c) => c.accountStatus === 'Suspended');
        break;
      case 'deactivated':
        list = list.filter((c) => c.accountStatus === 'Deactivated');
        break;
      default:
        break;
    }

    if (sort === 'name-asc') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'activity-desc') {
      list.sort((a, b) => new Date(b.lastActivityAt || b.createdAt).getTime() - new Date(a.lastActivityAt || a.createdAt).getTime());
    } else if (sort === 'orders-desc') {
      list.sort((a, b) => b.ordersCount - a.ordersCount || b.listingsCount - a.listingsCount);
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const total = list.length;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);

    res.json({ customers: items, total, page, pageSize });
  });

  // 3. CUSTOMER DETAIL PROFILE — NO PASSWORD HASH OR TOKENS
  app.get('/api/admin/customers/:id', requireAdmin, (req, res) => {
    const userRow = db.prepare('SELECT * FROM users WHERE id = ? AND is_demo = 0').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!userRow) {
      res.status(404).json({ error: 'Registered customer not found.' });
      return;
    }

    const uid = String(userRow.id);
    const materialListings = (
      db.prepare('SELECT * FROM material_listings WHERE seller_id = ? ORDER BY created_at DESC').all(uid) as Array<
        Record<string, unknown>
      >
    ).map(mapMaterialListing);

    const materialOrders = (
      db
        .prepare(
          `SELECT mr.*, ml.title as listing_title, ml.unit as listing_unit, ml.seller_id, ml.seller_name
           FROM material_requests mr
           JOIN material_listings ml ON ml.id = mr.listing_id
           WHERE mr.buyer_id = ? OR ml.seller_id = ?
           ORDER BY mr.created_at DESC`
        )
        .all(uid, uid) as Array<Record<string, unknown>>
    ).map((r) => ({
      id: String(r.id),
      listingId: String(r.listing_id),
      listingTitle: String(r.listing_title),
      listingUnit: String(r.listing_unit),
      sellerId: String(r.seller_id),
      sellerName: String(r.seller_name),
      buyerId: String(r.buyer_id),
      buyerName: String(r.buyer_name),
      requestedQuantity: Number(r.requested_quantity),
      intendedUse: String(r.intended_use),
      preferredDate: String(r.preferred_date),
      preferredTime: String(r.preferred_time),
      arrangement: String(r.arrangement),
      status: String(r.status),
      createdAt: String(r.created_at),
    }));

    const foodDonations = (
      db.prepare('SELECT * FROM food_donations WHERE donor_id = ? ORDER BY created_at DESC').all(uid) as Array<
        Record<string, unknown>
      >
    ).map(mapFoodDonation);

    const foodRequests = (
      db
        .prepare(
          `SELECT fr.*, fd.title as donation_title, fd.donor_id, fd.donor_name
           FROM food_requests fr
           JOIN food_donations fd ON fd.id = fr.donation_id
           WHERE fr.recipient_id = ? OR fd.donor_id = ?
           ORDER BY fr.created_at DESC`
        )
        .all(uid, uid) as Array<Record<string, unknown>>
    ).map((r) => ({
      id: String(r.id),
      donationId: String(r.donation_id),
      donationTitle: String(r.donation_title),
      donorId: String(r.donor_id),
      donorName: String(r.donor_name),
      recipientId: String(r.recipient_id),
      recipientName: String(r.recipient_name),
      requestedPortions: Number(r.requested_portions),
      preferredTime: String(r.preferred_time),
      status: String(r.status),
      createdAt: String(r.created_at),
    }));

    const oilListings = (
      db.prepare('SELECT * FROM oil_recovery_listings WHERE supplier_id = ? ORDER BY created_at DESC').all(uid) as Array<
        Record<string, unknown>
      >
    ).map(mapOilListing);

    const oilEnquiries = (
      db
        .prepare(
          `SELECT oe.*, ol.title as listing_title, ol.supplier_id, ol.supplier_name
           FROM oil_buyer_enquiries oe
           JOIN oil_recovery_listings ol ON ol.id = oe.listing_id
           WHERE oe.buyer_id = ? OR ol.supplier_id = ?
           ORDER BY oe.created_at DESC`
        )
        .all(uid, uid) as Array<Record<string, unknown>>
    ).map((r) => ({
      id: String(r.id),
      listingId: String(r.listing_id),
      listingTitle: String(r.listing_title),
      supplierName: String(r.supplier_name),
      buyerName: String(r.buyer_name),
      requestedLiters: Number(r.requested_liters),
      intendedProcessing: String(r.intended_processing),
      status: String(r.status),
      createdAt: String(r.created_at),
    }));

    const verifications = (
      db.prepare('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY submitted_at DESC').all(uid) as Array<
        Record<string, unknown>
      >
    ).map((r) => ({
      id: String(r.id),
      organization: String(r.organization),
      materialsHandled: String(r.materials_handled),
      businessSummary: String(r.business_summary),
      status: String(r.status),
      reviewerNotes: r.reviewer_notes ? String(r.reviewer_notes) : null,
      submittedAt: String(r.submitted_at),
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    }));

    const adminNotes = (
      db.prepare('SELECT * FROM customer_admin_notes WHERE user_id = ? ORDER BY created_at DESC').all(uid) as Array<
        Record<string, unknown>
      >
    ).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      adminId: String(r.admin_id),
      adminName: String(r.admin_name),
      note: String(r.note),
      createdAt: String(r.created_at),
    }));

    const moderationHistory = (
      db
        .prepare('SELECT * FROM audit_logs WHERE target_user_id = ? OR target_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(uid, uid) as Array<Record<string, unknown>>
    ).map((r) => ({
      id: String(r.id),
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      action: String(r.action),
      targetType: String(r.target_type),
      targetId: String(r.target_id),
      targetUserId: r.target_user_id ? String(r.target_user_id) : null,
      reason: r.reason ? String(r.reason) : null,
      result: String(r.result ?? 'Success'),
      details: String(r.details),
      createdAt: String(r.created_at),
    }));

    res.json({
      customer: {
        ...sanitizeUser(userRow as unknown as Parameters<typeof sanitizeUser>[0]),
        suspendedAt: userRow.suspended_at ? String(userRow.suspended_at) : null,
        suspensionReason: userRow.suspension_reason ? String(userRow.suspension_reason) : null,
        deactivatedAt: userRow.deactivated_at ? String(userRow.deactivated_at) : null,
      },
      materialListings,
      materialOrders,
      foodDonations,
      foodRequests,
      oilListings,
      oilEnquiries,
      verifications,
      adminNotes,
      moderationHistory,
    });
  });

  // 4. SUSPEND / REACTIVATE / DEACTIVATE CUSTOMER ACCOUNT
  app.post('/api/admin/customers/:id/status', requireAdmin, adminMutationLimiter, (req: AuthedRequest, res) => {
    const { accountStatus, reason } = req.body ?? {};
    if (!['Active', 'Suspended', 'Deactivated'].includes(accountStatus)) {
      res.status(400).json({ error: 'Account status must be Active, Suspended, or Deactivated.' });
      return;
    }
    if ((accountStatus === 'Suspended' || accountStatus === 'Deactivated') && (typeof reason !== 'string' || reason.trim().length < 5)) {
      res.status(400).json({ error: 'A clear administrative reason (minimum 5 characters) is required.' });
      return;
    }

    const target = db.prepare('SELECT * FROM users WHERE id = ? AND is_demo = 0').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Customer account not found.' });
      return;
    }
    if (String(target.id) === req.user!.id) {
      res.status(400).json({ error: 'Administrators cannot suspend or deactivate their own active account.' });
      return;
    }

    const now = new Date().toISOString();
    const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 400) : null;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE users
         SET account_status = ?,
             suspended_at = CASE WHEN ? = 'Suspended' THEN ? WHEN ? = 'Active' THEN NULL ELSE suspended_at END,
             suspension_reason = CASE WHEN ? = 'Suspended' THEN ? WHEN ? = 'Active' THEN NULL ELSE suspension_reason END,
             deactivated_at = CASE WHEN ? = 'Deactivated' THEN ? WHEN ? = 'Active' THEN NULL ELSE deactivated_at END,
             updated_at = ?
         WHERE id = ?`
      ).run(
        accountStatus,
        accountStatus,
        now,
        accountStatus,
        accountStatus,
        cleanReason,
        accountStatus,
        accountStatus,
        now,
        accountStatus,
        now,
        String(target.id)
      );

      if (accountStatus !== 'Active') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(String(target.id));
      }

      logAudit(
        req.user!.id,
        req.user!.name,
        `ACCOUNT_${accountStatus.toUpperCase()}`,
        'customer',
        String(target.id),
        `Changed account status for ${target.name} (${target.email}) from ${target.account_status} to ${accountStatus}`,
        { targetUserId: String(target.id), reason: cleanReason, result: 'Success' }
      );

      if (accountStatus === 'Active') {
        addNotification(
          String(target.id),
          'Account Reactivated',
          'Your VERDORA account has been reactivated by platform administration.',
          'workspace'
        );
      }

      db.exec('COMMIT');
      res.json({ ok: true, accountStatus });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update customer status.' });
    }
  });

  // 5. RECORD ADMINISTRATIVE NOTE ON CUSTOMER
  app.post('/api/admin/customers/:id/notes', requireAdmin, adminMutationLimiter, (req: AuthedRequest, res) => {
    const { note } = req.body ?? {};
    if (typeof note !== 'string' || note.trim().length < 3) {
      res.status(400).json({ error: 'Administrative note must be at least 3 characters.' });
      return;
    }
    const target = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_demo = 0').get(req.params.id) as
      | { id: string; name: string }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    const id = createId('note');
    const now = new Date().toISOString();
    const cleanNote = note.trim().slice(0, 1000);

    db.prepare(
      'INSERT INTO customer_admin_notes (id, user_id, admin_id, admin_name, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, target.id, req.user!.id, req.user!.name, cleanNote, now);

    logAudit(
      req.user!.id,
      req.user!.name,
      'CUSTOMER_NOTE_ADDED',
      'customer',
      target.id,
      `Recorded internal administrative note on ${target.name}.`,
      { targetUserId: target.id, result: 'Success' }
    );

    res.status(201).json({
      note: {
        id,
        userId: target.id,
        adminId: req.user!.id,
        adminName: req.user!.name,
        note: cleanNote,
        createdAt: now,
      },
    });
  });

  // 6. MARKETPLACE LISTINGS MODERATION
  app.get('/api/admin/listings', requireAdmin, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'All';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 15));

    const rows = db.prepare('SELECT * FROM material_listings WHERE is_demo = 0 ORDER BY created_at DESC').all() as Array<
      Record<string, unknown>
    >;
    let items = rows.map(mapMaterialListing);

    if (q) {
      items = items.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.sellerName.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q) ||
          m.location.toLowerCase().includes(q)
      );
    }
    if (status === 'Hidden') {
      items = items.filter((m) => m.isHidden);
    } else if (status !== 'All') {
      items = items.filter((m) => m.status === status && !m.isHidden);
    }

    const total = items.length;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);
    res.json({ listings: paged, total, page, pageSize });
  });

  app.patch('/api/admin/listings/:id', requireAdmin, adminMutationLimiter, (req: AuthedRequest, res) => {
    const { isHidden, status, reason } = req.body ?? {};
    const existing = db.prepare('SELECT * FROM material_listings WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Listing not found.' });
      return;
    }

    const validStatuses = ['Active', 'Paused', 'Unavailable', 'Completed', 'Cancelled'];
    const nextStatus = validStatuses.includes(status) ? String(status) : String(existing.status);
    const nextHidden = typeof isHidden === 'boolean' ? (isHidden ? 1 : 0) : Number(existing.is_hidden || 0);
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 300) : null;
    const now = new Date().toISOString();

    db.prepare(
      'UPDATE material_listings SET status = ?, is_hidden = ?, hidden_reason = ?, updated_at = ? WHERE id = ?'
    ).run(nextStatus, nextHidden, nextHidden ? cleanReason : null, now, req.params.id);

    logAudit(
      req.user!.id,
      req.user!.name,
      nextHidden ? 'LISTING_HIDDEN' : 'LISTING_MODERATED',
      'material',
      String(req.params.id),
      `Listing "${existing.title}" -> status=${nextStatus}, hidden=${Boolean(nextHidden)}`,
      { targetUserId: String(existing.seller_id), reason: cleanReason, result: 'Success' }
    );

    const updated = db.prepare('SELECT * FROM material_listings WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ listing: mapMaterialListing(updated) });
  });

  // 7. ORDERS (MATERIAL REQUESTS)
  app.get('/api/admin/orders', requireAdmin, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'All';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 15));

    const rows = db
      .prepare(
        `SELECT mr.*, ml.title as listing_title, ml.category as listing_category, ml.unit as listing_unit,
                ml.location as listing_location, ml.seller_id, ml.seller_name
         FROM material_requests mr
         JOIN material_listings ml ON ml.id = mr.listing_id
         WHERE mr.is_demo = 0
         ORDER BY mr.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    let items = rows.map((r) => ({
      id: String(r.id),
      listingId: String(r.listing_id),
      listingTitle: String(r.listing_title),
      listingCategory: String(r.listing_category),
      listingUnit: String(r.listing_unit),
      listingLocation: String(r.listing_location),
      sellerId: String(r.seller_id),
      sellerName: String(r.seller_name),
      buyerId: String(r.buyer_id),
      buyerName: String(r.buyer_name),
      requestedQuantity: Number(r.requested_quantity),
      intendedUse: String(r.intended_use),
      preferredDate: String(r.preferred_date),
      preferredTime: String(r.preferred_time),
      arrangement: String(r.arrangement),
      status: String(r.status),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    if (q) {
      items = items.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.listingTitle.toLowerCase().includes(q) ||
          o.buyerName.toLowerCase().includes(q) ||
          o.sellerName.toLowerCase().includes(q)
      );
    }
    if (status !== 'All') {
      items = items.filter((o) => o.status === status);
    }

    const total = items.length;
    res.json({ orders: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize });
  });

  // 8. FOOD RESCUE ADMIN
  app.get('/api/admin/food-rescue', requireAdmin, (req, res) => {
    expireOutdatedFoodDonations();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'All';

    const donRows = db.prepare('SELECT * FROM food_donations WHERE is_demo = 0 ORDER BY created_at DESC').all() as Array<
      Record<string, unknown>
    >;
    let donations = donRows.map(mapFoodDonation);

    const reqRows = db
      .prepare(
        `SELECT fr.*, fd.title as donation_title, fd.donor_id, fd.donor_name, fd.pickup_deadline
         FROM food_requests fr
         JOIN food_donations fd ON fd.id = fr.donation_id
         WHERE fr.is_demo = 0
         ORDER BY fr.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    let requests = reqRows.map((r) => ({
      id: String(r.id),
      donationId: String(r.donation_id),
      donationTitle: String(r.donation_title),
      donorId: String(r.donor_id),
      donorName: String(r.donor_name),
      recipientId: String(r.recipient_id),
      recipientName: String(r.recipient_name),
      requestedPortions: Number(r.requested_portions),
      preferredTime: String(r.preferred_time),
      pickupDeadline: String(r.pickup_deadline),
      status: String(r.status),
      createdAt: String(r.created_at),
    }));

    if (q) {
      donations = donations.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.donorName.toLowerCase().includes(q) ||
          d.location.toLowerCase().includes(q)
      );
      requests = requests.filter(
        (r) =>
          r.donationTitle.toLowerCase().includes(q) ||
          r.donorName.toLowerCase().includes(q) ||
          r.recipientName.toLowerCase().includes(q)
      );
    }
    if (status !== 'All') {
      donations = donations.filter((d) => (status === 'Hidden' ? d.isHidden : d.status === status));
    }

    res.json({ donations, requests });
  });

  app.patch('/api/admin/food-donations/:id', requireAdmin, adminMutationLimiter, (req: AuthedRequest, res) => {
    const { isHidden, status, reason } = req.body ?? {};
    const existing = db.prepare('SELECT * FROM food_donations WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Food donation not found.' });
      return;
    }

    const validStatuses = ['Available', 'Request Received', 'Accepted', 'Completed', 'Cancelled', 'Expired'];
    const nextStatus = validStatuses.includes(status) ? String(status) : String(existing.status);
    const nextHidden = typeof isHidden === 'boolean' ? (isHidden ? 1 : 0) : Number(existing.is_hidden || 0);
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 300) : null;

    db.prepare(
      'UPDATE food_donations SET status = ?, is_hidden = ?, hidden_reason = ?, updated_at = ? WHERE id = ?'
    ).run(nextStatus, nextHidden, nextHidden ? cleanReason : null, new Date().toISOString(), req.params.id);

    logAudit(
      req.user!.id,
      req.user!.name,
      nextHidden ? 'FOOD_DONATION_HIDDEN' : 'FOOD_DONATION_MODERATED',
      'food',
      String(req.params.id),
      `Food donation "${existing.title}" -> status=${nextStatus}, hidden=${Boolean(nextHidden)}`,
      { targetUserId: String(existing.donor_id), reason: cleanReason, result: 'Success' }
    );

    const updated = db.prepare('SELECT * FROM food_donations WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ donation: mapFoodDonation(updated) });
  });

  // 9. OIL RECOVERY ADMIN
  app.get('/api/admin/oil-recovery', requireAdmin, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'All';

    const listRows = db.prepare('SELECT * FROM oil_recovery_listings ORDER BY created_at DESC').all() as Array<
      Record<string, unknown>
    >;
    let listings = listRows.map(mapOilListing);

    const enqRows = db
      .prepare(
        `SELECT oe.*, ol.title as listing_title, ol.oil_type, ol.supplier_id, ol.supplier_name
         FROM oil_buyer_enquiries oe
         JOIN oil_recovery_listings ol ON ol.id = oe.listing_id
         ORDER BY oe.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    let enquiries = enqRows.map((r) => ({
      id: String(r.id),
      listingId: String(r.listing_id),
      listingTitle: String(r.listing_title),
      oilType: String(r.oil_type),
      supplierId: String(r.supplier_id),
      supplierName: String(r.supplier_name),
      buyerId: String(r.buyer_id),
      buyerName: String(r.buyer_name),
      buyerOrganization: String(r.buyer_organization ?? ''),
      requestedLiters: Number(r.requested_liters),
      intendedProcessing: String(r.intended_processing),
      preferredCollectionDate: String(r.preferred_collection_date),
      processingNotes: String(r.processing_notes ?? ''),
      status: String(r.status),
      createdAt: String(r.created_at),
    }));

    if (q) {
      listings = listings.filter(
        (o) =>
          o.title.toLowerCase().includes(q) ||
          o.supplierName.toLowerCase().includes(q) ||
          o.oilType.toLowerCase().includes(q)
      );
      enquiries = enquiries.filter(
        (e) =>
          e.listingTitle.toLowerCase().includes(q) ||
          e.buyerName.toLowerCase().includes(q) ||
          e.supplierName.toLowerCase().includes(q)
      );
    }
    if (status !== 'All') {
      listings = listings.filter((o) => o.collectionStatus === status);
    }

    res.json({ listings, enquiries });
  });

  app.patch('/api/admin/oil-recovery/:id', requireAdmin, adminMutationLimiter, (req: AuthedRequest, res) => {
    const { isHidden, collectionStatus, reason } = req.body ?? {};
    const existing = db.prepare('SELECT * FROM oil_recovery_listings WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Oil recovery listing not found.' });
      return;
    }

    const validStatuses = ['Available', 'Enquiry Pending', 'Scheduled', 'Collected', 'Processed', 'Paused', 'Cancelled'];
    const nextStatus = validStatuses.includes(collectionStatus)
      ? String(collectionStatus)
      : String(existing.collection_status);
    const nextHidden = typeof isHidden === 'boolean' ? (isHidden ? 1 : 0) : Number(existing.is_hidden || 0);
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 300) : null;

    db.prepare(
      'UPDATE oil_recovery_listings SET collection_status = ?, is_hidden = ?, hidden_reason = ?, updated_at = ? WHERE id = ?'
    ).run(nextStatus, nextHidden, nextHidden ? cleanReason : null, new Date().toISOString(), req.params.id);

    logAudit(
      req.user!.id,
      req.user!.name,
      nextHidden ? 'OIL_LISTING_HIDDEN' : 'OIL_LISTING_MODERATED',
      'oil',
      String(req.params.id),
      `Oil listing "${existing.title}" -> status=${nextStatus}, hidden=${Boolean(nextHidden)}`,
      { targetUserId: String(existing.supplier_id), reason: cleanReason, result: 'Success' }
    );

    const updated = db.prepare('SELECT * FROM oil_recovery_listings WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ listing: mapOilListing(updated) });
  });

  // 10. AUDIT LOGS (Searchable & Paginated)
  app.get('/api/admin/audit-logs', requireAdmin, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));

    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all() as Array<
      Record<string, unknown>
    >;
    let items = rows.map((r) => ({
      id: String(r.id),
      actorId: String(r.actor_id),
      actorName: String(r.actor_name),
      action: String(r.action),
      targetType: String(r.target_type),
      targetId: String(r.target_id),
      targetUserId: r.target_user_id ? String(r.target_user_id) : null,
      reason: r.reason ? String(r.reason) : null,
      result: String(r.result ?? 'Success'),
      details: String(r.details),
      createdAt: String(r.created_at),
    }));

    if (q) {
      items = items.filter(
        (l) =>
          l.action.toLowerCase().includes(q) ||
          l.actorName.toLowerCase().includes(q) ||
          l.actorId.toLowerCase().includes(q) ||
          (l.targetUserId ?? '').toLowerCase().includes(q) ||
          l.details.toLowerCase().includes(q)
      );
    }

    const total = items.length;
    res.json({ logs: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize });
  });
}
