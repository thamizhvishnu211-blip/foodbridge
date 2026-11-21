# VERDORA — A Better Life for Every Resource

VERDORA is a full-stack, AI-assisted circular economy and surplus food rescue platform connecting reusable materials, surplus food donations, intelligent matchmaking, WhatsApp coordination, and audit-safe environmental impact reporting.

## Core Modules

1. **VERDORA Market (Circular Materials Marketplace)**
   - 15 material categories (Metal, Aluminium, Steel, Copper, Plastic, Paper, Cardboard, Wood, Glass, Textile, Rubber, Construction materials, Electronic components, Organic materials, Other reusable materials).
   - Search, multi-faceted filtering, sorting, bookmarks, side-by-side comparison (up to 3 items), listing creation/editing, and WhatsApp coordination links.
   - **No online payments or checkout**: participants coordinate handovers directly.

2. **VERDORA Food Rescue**
   - Dedicated editorial experience (`"Good Food Deserves Another Chance."`).
   - Donor workflow capturing food category, quantity, portions, preparation time, storage conditions, packaging, known allergens, dietary info, and pickup deadline.
   - Automatic expiry closure and atomic portion locking (`remaining_portions` decremented inside a SQLite `BEGIN IMMEDIATE` transaction so two recipients cannot claim the same portions).

3. **AI Material Scanner, Smart Matchmaking & Eco AI Assistant**
   - Server-side `@google/genai` (`gemini-4-hydrogen`) integration for multimodal material image analysis and circular-economy chat guidance, with transparent fallback mode when `GEMINI_API_KEY` is not configured.
   - Rule-based Smart Material Matchmaking with explicit relevance explanations.

4. **Impact Dashboard, Green Rewards & Moderation**
   - Strict separation between **Live Platform Records** and **Demo Showcase Data**.
   - Duplicate handover protection via unique primary keys in `impact_ledger`.
   - Non-mass units (e.g., pallets) are excluded from kilogram totals.
   - Server-enforced RBAC for Trust Verification reviews, User Reports, Category Management, and Audit Logs.

## Technology Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Motion, Lucide React
- **Backend:** Express (`server.ts`), Node 22 built-in SQLite (`node:sqlite`), `@google/genai`
- **Build:** Vite 8 + esbuild

## Environment Variables

Configure via `.env` or AI Studio Secrets:

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
APP_URL="http://localhost:3000"
```

## Setup & Commands

```bash
npm install
npm run dev      # Starts full-stack Express + Vite dev server on port 3000
npm run lint     # Runs TypeScript type-checking (tsc --noEmit)
npm run build    # Builds client bundle and compiles server.ts -> dist/server.mjs
npm run start    # Runs compiled production server
```

## Known Limitations

- The cinematic hero video slot defaults to a generated high-resolution forest studio photograph until an `.mp4` video asset is connected.
- Pickup coordination is participant-driven via WhatsApp and status updates; no live GPS courier tracking is included.
- Environmental totals reflect recorded platform quantities only and do not claim independently verified CO2e savings.
