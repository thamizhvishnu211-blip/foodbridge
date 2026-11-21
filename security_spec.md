# VERDORA Firestore Security Specification

## 1. Data Invariants
1. User profile documents at `/users/{userId}` can ONLY be created, read (`get`), or updated by the authenticated owner (`request.auth.uid == userId` and `request.auth.token.email_verified == true`) or admin. Listing `/users` is denied to prevent PII harvesting.
2. Saved bookmarks at `/users/{userId}/saved/{savedId}` are private to `isOwner(userId)` only.
3. Public catalog collections (`/material_listings`, `/food_donations`, `/oil_recovery_listings`) NEVER store PII (`email`, `whatsappNumber`), expose `list`/`get` strictly where `resource.data.isPublic == true` (which is enforced equal to `isHidden == false && status != 'Cancelled'`) or to the authenticated owner (`sellerUid`/`donorUid`/`supplierUid == request.auth.uid`), and require verified-email ownership on `create`/`update`.
4. Interaction request collections (`/material_requests`, `/food_requests`, `/oil_buyer_enquiries`) require verified-email authentication, verify the parent listing/donation exists via `exists()` and matches the declared owner UID via `get()`, enforce `buyerUid`/`recipientUid == request.auth.uid` and `buyerUid != sellerUid` on creation, and restrict `get`/`list`/`update` strictly to the participating buyer/recipient or seller/donor/supplier (or admin).
5. All entities enforce strict `hasAll` + `hasOnly` key checks, `.size()` bounds on every string and list, immutable `id`/owner UID/`createdAt`, server-verified timestamps (`createdAt == request.time`, `updatedAt == request.time`), terminal state locking (`Completed`, `Cancelled`, `Expired`, `Declined`), and `isValidId()` regex guards (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars).

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. Unauthenticated write or private `/users` list query -> `PERMISSION_DENIED`
2. Unverified Google email (`email_verified == false`) create/update on any collection -> `PERMISSION_DENIED`
3. Creating `/material_listings/{id}` with spoofed `sellerUid != request.auth.uid` -> `PERMISSION_DENIED`
4. Shadow field injection (e.g. `isAdmin: true`, `whatsappNumber: "+91..."`, `sellerVerified: true` tampering) -> `PERMISSION_DENIED`
5. Marking `isPublic: true` when `isHidden: true` or `status: "Cancelled"` -> `PERMISSION_DENIED`
6. Querying `/material_requests`, `/food_requests`, or `/oil_buyer_enquiries` without matching participant UID -> `PERMISSION_DENIED`
7. Creating a request referencing a non-existent `listingId` / `donationId` or mismatched `sellerUid` / `donorUid` -> `PERMISSION_DENIED`
8. Self-requesting own listing (`buyerUid == sellerUid` or `recipientUid == donorUid`) -> `PERMISSION_DENIED`
9. Buyer/recipient directly accepting their own request (`status: "Accepted"` by non-owner) -> `PERMISSION_DENIED`
10. Modifying a listing/request after terminal state (`Completed`, `Cancelled`, `Expired`, `Declined`) -> `PERMISSION_DENIED`
11. Backdated/forged `createdAt != request.time` or mutating immutable `createdAt`/`sellerUid` on update -> `PERMISSION_DENIED`
12. Resource poisoning (`> 128` char ID or oversized string exceeding `.size()` bounds) -> `PERMISSION_DENIED`
