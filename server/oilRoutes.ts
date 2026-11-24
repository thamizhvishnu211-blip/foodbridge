import { Express } from 'express';
import { createId, db } from './db.ts';
import {
  fetchPublicOilListingsFromFirestore,
  mergeWithRemoteById,
} from './firestorePublicSync.ts';
import {
  addNotification,
  AuthedRequest,
  isValidPhone,
  logAudit,
  mapOilListing,
  normalizePhoneOrNull,
  requireAuth,
  touchUserActivity,
} from './shared.ts';

export function registerOilRoutes(app: Express) {
  app.get('/api/oil-recovery', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const location = typeof req.query.location === 'string' ? req.query.location.trim().toLowerCase() : '';

    const rows = db
      .prepare('SELECT * FROM oil_recovery_listings WHERE is_hidden = 0 ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;

    const remote = await fetchPublicOilListingsFromFirestore();
    let items = mergeWithRemoteById(rows.map(mapOilListing), remote)
      .filter((o) => !o.isHidden && o.collectionStatus !== 'Cancelled')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (q) {
      items = items.filter(
        (o) =>
          o.title.toLowerCase().includes(q) ||
          o.oilType.toLowerCase().includes(q) ||
          o.location.toLowerCase().includes(q) ||
          o.supplierOrganization.toLowerCase().includes(q)
      );
    }
    if (status && status !== 'All') {
      items = items.filter((o) => o.collectionStatus === status);
    }
    if (location) {
      items = items.filter((o) => o.location.toLowerCase().includes(location));
    }

    res.json({ listings: items });
  });

  app.post('/api/oil-recovery', requireAuth, (req: AuthedRequest, res) => {
    const b = req.body ?? {};
    const errors: string[] = [];
    if (typeof b.title !== 'string' || b.title.trim().length < 3) errors.push('Oil lot title must be at least 3 characters.');
    if (typeof b.oilType !== 'string' || b.oilType.trim().length < 2) errors.push('Oil type is required.');
    const liters = Number(b.volumeLiters);
    if (!Number.isFinite(liters) || liters <= 0) errors.push('Volume in liters must be greater than 0.');
    if (typeof b.qualityGrade !== 'string' || !b.qualityGrade.trim()) errors.push('Quality grade is required.');
    if (typeof b.containerType !== 'string' || !b.containerType.trim()) errors.push('Container type is required.');
    if (typeof b.filtrationStatus !== 'string' || !b.filtrationStatus.trim()) errors.push('Filtration status is required.');
    if (typeof b.pickupWindow !== 'string' || !b.pickupWindow.trim()) errors.push('Pickup window is required.');
    if (typeof b.location !== 'string' || b.location.trim().length < 2) errors.push('Location is required.');
    if (b.whatsappNumber && !isValidPhone(b.whatsappNumber)) errors.push('Invalid WhatsApp phone number.');

    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    const u = req.user!;
    const id = createId('oil');
    const now = new Date().toISOString();
    const whatsapp = normalizePhoneOrNull(b.whatsappNumber) ?? u.whatsapp_number;

    db.prepare(
      `INSERT INTO oil_recovery_listings (
        id, supplier_id, supplier_name, supplier_organization, supplier_verified,
        title, oil_type, volume_liters, quality_grade, container_type, filtration_status,
        pickup_window, location, collection_status, whatsapp_number, is_hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available', ?, 0, ?, ?)`
    ).run(
      id,
      u.id,
      u.name,
      u.organization,
      u.verification_status === 'Approved' ? 1 : 0,
      b.title.trim().slice(0, 120),
      b.oilType.trim().slice(0, 80),
      liters,
      b.qualityGrade.trim().slice(0, 60),
      b.containerType.trim().slice(0, 80),
      b.filtrationStatus.trim().slice(0, 80),
      b.pickupWindow.trim().slice(0, 140),
      b.location.trim().slice(0, 120),
      whatsapp,
      now,
      now
    );

    touchUserActivity(u.id);
    const created = db.prepare('SELECT * FROM oil_recovery_listings WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ listing: mapOilListing(created) });
  });

  app.patch('/api/oil-recovery/:id', requireAuth, (req: AuthedRequest, res) => {
    const existing = db.prepare('SELECT * FROM oil_recovery_listings WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Oil recovery listing not found.' });
      return;
    }
    if (existing.supplier_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'You do not have permission to modify this oil lot.' });
      return;
    }
    const validStatuses = ['Available', 'Enquiry Pending', 'Scheduled', 'Collected', 'Processed', 'Paused', 'Cancelled'];
    const b = req.body ?? {};
    const nextStatus = validStatuses.includes(b.collectionStatus) ? String(b.collectionStatus) : String(existing.collection_status);
    const now = new Date().toISOString();

    db.prepare('UPDATE oil_recovery_listings SET collection_status = ?, updated_at = ? WHERE id = ?').run(
      nextStatus,
      now,
      req.params.id
    );
    touchUserActivity(req.user!.id);

    if (req.user!.role === 'admin' && existing.supplier_id !== req.user!.id) {
      logAudit(
        req.user!.id,
        req.user!.name,
        'OIL_LOT_UPDATED',
        'oil',
        String(req.params.id),
        `Updated oil lot status to ${nextStatus}`,
        { targetUserId: String(existing.supplier_id) }
      );
    }

    const updated = db.prepare('SELECT * FROM oil_recovery_listings WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ listing: mapOilListing(updated) });
  });

  app.get('/api/oil-enquiries', requireAuth, (req: AuthedRequest, res) => {
    const u = req.user!;
    const rows = db
      .prepare(
        `SELECT oe.*, ol.title as listing_title, ol.oil_type, ol.location as listing_location,
                ol.supplier_id, ol.supplier_name, ol.whatsapp_number as supplier_whatsapp,
                bu.whatsapp_number as buyer_whatsapp
         FROM oil_buyer_enquiries oe
         JOIN oil_recovery_listings ol ON ol.id = oe.listing_id
         JOIN users bu ON bu.id = oe.buyer_id
         WHERE (? = 'admin' OR oe.buyer_id = ? OR ol.supplier_id = ?)
         ORDER BY oe.updated_at DESC`
      )
      .all(u.role, u.id, u.id) as Array<Record<string, unknown>>;

    res.json({
      enquiries: rows.map((r) => ({
        id: String(r.id),
        listingId: String(r.listing_id),
        listingTitle: String(r.listing_title),
        oilType: String(r.oil_type),
        listingLocation: String(r.listing_location),
        supplierId: String(r.supplier_id),
        supplierName: String(r.supplier_name),
        supplierWhatsapp: r.supplier_whatsapp ? String(r.supplier_whatsapp) : null,
        buyerId: String(r.buyer_id),
        buyerName: String(r.buyer_name),
        buyerOrganization: String(r.buyer_organization ?? ''),
        buyerWhatsapp: r.buyer_whatsapp ? String(r.buyer_whatsapp) : null,
        requestedLiters: Number(r.requested_liters),
        intendedProcessing: String(r.intended_processing),
        preferredCollectionDate: String(r.preferred_collection_date),
        notes: String(r.notes ?? ''),
        processingNotes: String(r.processing_notes ?? ''),
        status: String(r.status),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
    });
  });

  app.post('/api/oil-enquiries', requireAuth, (req: AuthedRequest, res) => {
    const { listingId, requestedLiters, intendedProcessing, preferredCollectionDate, notes } = req.body ?? {};
    const listing = db
      .prepare('SELECT * FROM oil_recovery_listings WHERE id = ? AND is_hidden = 0')
      .get(String(listingId || '')) as Record<string, unknown> | undefined;

    if (!listing) {
      res.status(404).json({ error: 'Used cooking oil listing not found.' });
      return;
    }
    if (!['Available', 'Enquiry Pending'].includes(String(listing.collection_status))) {
      res.status(400).json({ error: `Oil lot is currently ${listing.collection_status} and cannot accept enquiries.` });
      return;
    }
    if (listing.supplier_id === req.user!.id) {
      res.status(400).json({ error: 'You cannot submit a buyer enquiry on your own oil lot.' });
      return;
    }
    const liters = Number(requestedLiters);
    if (!Number.isFinite(liters) || liters <= 0 || liters > Number(listing.volume_liters)) {
      res.status(400).json({ error: `Requested liters must be between 1 and ${listing.volume_liters} L.` });
      return;
    }
    if (typeof intendedProcessing !== 'string' || intendedProcessing.trim().length < 3) {
      res.status(400).json({ error: 'Please specify intended processing application (e.g., biodiesel, soapstock).' });
      return;
    }

    const id = createId('oenq');
    const now = new Date().toISOString();
    const u = req.user!;

    db.prepare(
      `INSERT INTO oil_buyer_enquiries (
        id, listing_id, buyer_id, buyer_name, buyer_organization, requested_liters,
        intended_processing, preferred_collection_date, notes, processing_notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'Pending', ?, ?)`
    ).run(
      id,
      String(listing.id),
      u.id,
      u.name,
      u.organization,
      liters,
      intendedProcessing.trim().slice(0, 200),
      typeof preferredCollectionDate === 'string' && preferredCollectionDate
        ? preferredCollectionDate
        : new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
      typeof notes === 'string' ? notes.trim().slice(0, 500) : '',
      now,
      now
    );

    if (listing.collection_status === 'Available') {
      db.prepare(`UPDATE oil_recovery_listings SET collection_status = 'Enquiry Pending', updated_at = ? WHERE id = ?`).run(
        now,
        String(listing.id)
      );
    }

    touchUserActivity(u.id);
    addNotification(
      String(listing.supplier_id),
      'New Oil Recovery Enquiry',
      `${u.name} requested ${liters} L of "${listing.title}" for ${intendedProcessing.trim()}.`,
      'workspace'
    );

    res.status(201).json({ ok: true, id });
  });

  app.patch('/api/oil-enquiries/:id/status', requireAuth, (req: AuthedRequest, res) => {
    const { status, processingNotes } = req.body ?? {};
    const validStatuses = ['Accepted', 'Scheduled', 'Collected', 'Completed', 'Declined', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid oil enquiry status transition.' });
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db
        .prepare(
          `SELECT oe.*, ol.supplier_id, ol.supplier_verified, ol.title as listing_title, ol.oil_type
           FROM oil_buyer_enquiries oe
           JOIN oil_recovery_listings ol ON ol.id = oe.listing_id
           WHERE oe.id = ?`
        )
        .get(req.params.id) as Record<string, unknown> | undefined;

      if (!row) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Oil enquiry not found.' });
        return;
      }

      const u = req.user!;
      const isSupplier = row.supplier_id === u.id;
      const isBuyer = row.buyer_id === u.id;
      const isAdmin = u.role === 'admin';
      if (!isSupplier && !isBuyer && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Not authorized to update this oil enquiry.' });
        return;
      }

      const currentStatus = String(row.status);
      if (['Completed', 'Declined', 'Cancelled'].includes(currentStatus)) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: `Cannot update enquiry that is already ${currentStatus}.` });
        return;
      }

      if ((status === 'Accepted' || status === 'Declined') && !isSupplier && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Only the oil supplier can accept or decline this enquiry.' });
        return;
      }
      if (status === 'Cancelled' && !isBuyer && !isAdmin) {
        db.exec('ROLLBACK');
        res.status(403).json({ error: 'Only the buyer can cancel this enquiry.' });
        return;
      }

      const now = new Date().toISOString();
      const nextProcNotes =
        typeof processingNotes === 'string' ? processingNotes.trim().slice(0, 500) : String(row.processing_notes ?? '');

      db.prepare('UPDATE oil_buyer_enquiries SET status = ?, processing_notes = ?, updated_at = ? WHERE id = ?').run(
        status,
        nextProcNotes,
        now,
        req.params.id
      );

      if (status === 'Accepted' || status === 'Scheduled') {
        db.prepare('UPDATE oil_recovery_listings SET collection_status = ?, updated_at = ? WHERE id = ?').run(
          'Scheduled',
          now,
          String(row.listing_id)
        );
      } else if (status === 'Collected') {
        db.prepare('UPDATE oil_recovery_listings SET collection_status = ?, updated_at = ? WHERE id = ?').run(
          'Collected',
          now,
          String(row.listing_id)
        );
      } else if (status === 'Completed') {
        db.prepare(`UPDATE oil_recovery_listings SET collection_status = 'Processed', updated_at = ? WHERE id = ?`).run(
          now,
          String(row.listing_id)
        );

        const ledgerId = `oil_enq_${String(row.id)}`;
        const alreadyRecorded = db.prepare('SELECT id FROM impact_ledger WHERE id = ?').get(ledgerId);
        if (!alreadyRecorded) {
          const liters = Number(row.requested_liters);
          // Standard cooking oil density ~0.92 kg/L recorded transparently
          const estimatedKg = Number((liters * 0.92).toFixed(1));
          const points = 130;
          const isVerified = Number(row.supplier_verified) === 1 ? 1 : 0;

          db.prepare(
            `INSERT INTO impact_ledger (
              id, source_type, source_id, user_id, category, mass_kg, portions, liters, points_awarded, is_verified, is_demo, completed_at
            ) VALUES (?, 'oil', ?, ?, 'Used Cooking Oil', ?, 0, ?, ?, ?, 0, ?)`
          ).run(ledgerId, String(row.id), String(row.supplier_id), estimatedKg, liters, points, isVerified, now);

          db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(points, String(row.supplier_id));
          db.prepare('UPDATE users SET points = points + 65 WHERE id = ?').run(String(row.buyer_id));
        }
      }

      touchUserActivity(u.id);
      const notifyTarget = isSupplier ? String(row.buyer_id) : String(row.supplier_id);
      addNotification(
        notifyTarget,
        `Oil Recovery ${status}`,
        `Enquiry for "${row.listing_title}" moved to ${status}.`,
        'workspace'
      );

      db.exec('COMMIT');
      res.json({ ok: true, status });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update oil enquiry.' });
    }
  });
}
