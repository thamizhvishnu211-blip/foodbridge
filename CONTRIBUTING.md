# Contributing to VERDORA

## Development Workflow

1. Create a feature branch before making changes (e.g., `feature/verdora-hackathon-upgrade`).
2. Keep `@google/genai` calls strictly server-side in `server/ai.ts`. Never expose API keys in client code.
3. Preserve database integrity:
   - Never count pending, cancelled, or expired requests in `impact_ledger`.
   - Always separate `is_demo = 1` sample data from `is_demo = 0` live records.
   - Validate all status transitions and ownership checks server-side.
4. Before submitting changes, run:
   - `npm run lint`
   - `npm run build`
