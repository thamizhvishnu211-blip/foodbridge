import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { ImpactSummary, PersonalImpactSummary, User } from '../types';
import { AnimatedCounter } from './AnimatedCounter';

interface ImpactRewardsViewProps {
  impact: ImpactSummary | null;
  user: User | null;
  onToast: (msg: string) => void;
}

export function ImpactRewardsView({ impact, user, onToast }: ImpactRewardsViewProps) {
  const [mySummary, setMySummary] = useState<PersonalImpactSummary | null>(null);
  const [copiedCard, setCopiedCard] = useState(false);

  useEffect(() => {
    if (!user) {
      setMySummary(null);
      return;
    }
    let active = true;
    api
      .getMyImpactSummary()
      .then((res) => {
        if (active) setMySummary(res);
      })
      .catch(() => {
        if (active) setMySummary(null);
      });
    return () => {
      active = false;
    };
  }, [user?.id, user?.points]);

  const metrics = impact?.live;
  const categories = impact?.categoryBreakdown ?? [];
  const monthly = impact?.monthlySeries ?? [];
  const maxMonthVal = Math.max(
    1,
    ...monthly.map((m) => Math.max(m.materialKg, m.foodPortions, m.oilLiters))
  );

  const copyShareSummary = async () => {
    if (!user) return;
    const completedHandovers = mySummary?.completedHandovers ?? 0;
    const text = `VERDORA Impact Summary — ${user.name} (${user.organization || 'Community Member'}): ${user.points} recognition points, ${completedHandovers} completed handovers. "A Better Life for Every Resource."`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCard(true);
      onToast('Impact summary copied to clipboard.');
      setTimeout(() => setCopiedCard(false), 2000);
    } catch {
      onToast('Copy failed.');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-12 text-[#F4F7F4]">
      {/* Header */}
      <div className="border-b border-[#A9B78D]/15 pb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
          Real Database Ledger
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-[#F4F7F4] sm:text-4xl">
          Live Eco Impact & Personal Recognition
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[#C8D6CD]">
          Every figure below is calculated exclusively from completed real handovers recorded in the
          VERDORA database. Incomplete claims, sample entries, and pending requests are excluded.
        </p>
      </div>

      {/* Core Metric Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6">
          <div className="text-xs font-medium text-[#C8D6CD]">Materials Recovered (Mass)</div>
          <div className="mt-2 text-3xl font-semibold text-[#F4F7F4]">
            <AnimatedCounter value={metrics?.materialsRecoveredKg ?? 0} decimals={1} suffix=" kg" />
          </div>
          <div className="mt-2 text-xs text-[#9BB0A3] font-mono-tabular">
            {metrics?.verifiedMaterialsRecoveredKg ?? 0} kg verified ·{' '}
            {metrics?.materialHandoversCompleted ?? 0} handovers
          </div>
        </div>

        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6">
          <div className="text-xs font-medium text-[#C8D6CD]">Food Portions Rescued</div>
          <div className="mt-2 text-3xl font-semibold text-[#F4F7F4]">
            <AnimatedCounter value={metrics?.foodPortionsRescued ?? 0} />
          </div>
          <div className="mt-2 text-xs text-[#9BB0A3] font-mono-tabular">
            {metrics?.verifiedFoodPortionsRescued ?? 0} verified ·{' '}
            {metrics?.foodHandoversCompleted ?? 0} handovers
          </div>
        </div>

        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6">
          <div className="text-xs font-medium text-[#C8D6CD]">Cooking Oil Recovered</div>
          <div className="mt-2 text-3xl font-semibold text-[#F4F7F4]">
            <AnimatedCounter value={metrics?.oilLitersRecovered ?? 0} decimals={1} suffix=" L" />
          </div>
          <div className="mt-2 text-xs text-[#9BB0A3] font-mono-tabular">
            {metrics?.verifiedOilLitersRecovered ?? 0} L verified ·{' '}
            {metrics?.oilRecoveriesCompleted ?? 0} recoveries
          </div>
        </div>

        <div className="rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6">
          <div className="text-xs font-medium text-[#C8D6CD]">Active Listings & Coordination</div>
          <div className="mt-2 text-3xl font-semibold text-[#F4F7F4]">
            <AnimatedCounter
              value={
                (metrics?.activeMaterialListings ?? 0) +
                (metrics?.activeFoodDonations ?? 0) +
                (metrics?.activeOilListings ?? 0)
              }
            />
          </div>
          <div className="mt-2 text-xs text-[#9BB0A3] font-mono-tabular">
            {(metrics?.pendingMaterialRequests ?? 0) +
              (metrics?.pendingFoodRequests ?? 0) +
              (metrics?.pendingOilEnquiries ?? 0)}{' '}
            pending (excluded from totals)
          </div>
        </div>
      </div>

      {/* Charts + Methodology */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-6">
          <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
            Completed Recovery by Category
          </h2>
          <p className="mt-1 text-xs text-[#C8D6CD]">
            Real completed handovers across materials, surplus food, and used cooking oil.
          </p>

          {categories.length === 0 ? (
            <div className="mt-8 rounded-xl border border-[#A9B78D]/15 bg-[#172620] p-8 text-center text-xs text-[#C8D6CD]">
              No completed handovers have been recorded yet. Verified and completed real
              transactions will appear here automatically.
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {categories.map((cat) => {
                const maxBar = Math.max(
                  1,
                  ...categories.map((c) => Math.max(c.massKg, c.portions, c.liters))
                );
                const barValue = Math.max(cat.massKg, cat.portions, cat.liters);
                const pct = Math.max(8, Math.round((barValue / maxBar) * 100));
                return (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#F4F7F4]">{cat.category}</span>
                      <span className="font-mono-tabular text-[#C8D6CD]">
                        {cat.handovers} handovers
                        {cat.massKg > 0 ? ` · ${cat.massKg} kg` : ''}
                        {cat.portions > 0 ? ` · ${cat.portions} portions` : ''}
                        {cat.liters > 0 ? ` · ${cat.liters} L` : ''}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[#1B2C24]">
                      <div
                        className="h-full rounded-full bg-[#76B88D]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {monthly.length > 0 && (
            <div className="mt-8 border-t border-[#A9B78D]/15 pt-6">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#F4F7F4]">Recorded Monthly Ledger Trend</span>
                <span className="text-[#9BB0A3]">Materials (kg) · Food Portions · Oil (L)</span>
              </div>
              <div className="mt-4 flex items-end gap-4 h-36">
                {monthly.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex w-full items-end justify-center gap-1.5 h-24">
                      <div
                        title={`${m.materialKg} kg`}
                        className="w-3.5 rounded-t bg-[#76B88D]"
                        style={{
                          height: `${Math.max(4, Math.round((m.materialKg / maxMonthVal) * 96))}px`,
                        }}
                      />
                      <div
                        title={`${m.foodPortions} portions`}
                        className="w-3.5 rounded-t bg-[#569873]"
                        style={{
                          height: `${Math.max(4, Math.round((m.foodPortions / maxMonthVal) * 96))}px`,
                        }}
                      />
                      <div
                        title={`${m.oilLiters} L oil`}
                        className="w-3.5 rounded-t bg-[#D9BA7E]"
                        style={{
                          height: `${Math.max(4, Math.round((m.oilLiters / maxMonthVal) * 96))}px`,
                        }}
                      />
                    </div>
                    <span className="font-mono-tabular text-[11px] text-[#C8D6CD]">{m.month}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Calculation Methodology */}
        <div className="lg:col-span-5 rounded-2xl border border-[#93C9A3]/25 bg-[#14241D] p-6 text-[#F4F7F4]">
          <h2 className="font-display text-xl font-semibold text-[#F4F7F4]">
            Impact Calculation Methodology
          </h2>
          <p className="mt-1 text-xs text-[#C8D6CD]">
            Transparent audit rules separating verified business records from unverified claims.
          </p>
          <dl className="mt-5 space-y-4 text-xs leading-relaxed text-[#D2DDD6]">
            <div>
              <dt className="font-semibold text-[#93C9A3]">Mass Conversion Rule</dt>
              <dd className="mt-0.5">{impact?.methodology.massRule}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#93C9A3]">Non-Mass Exclusions</dt>
              <dd className="mt-0.5">{impact?.methodology.exclusionRule}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#93C9A3]">Verified vs. Unverified Distinction</dt>
              <dd className="mt-0.5">{impact?.methodology.verifiedDistinction}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#93C9A3]">Duplicate Handover Protection</dt>
              <dd className="mt-0.5">{impact?.methodology.duplicateRule}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#93C9A3]">Carbon Disclosure Policy</dt>
              <dd className="mt-0.5">{impact?.methodology.carbonPolicy}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Personal Shareable Impact Card */}
      {user && (
        <section className="rounded-2xl border border-[#93C9A3]/25 bg-[#14241D] p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                Personal Impact Summary
              </p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-[#F4F7F4]">
                {user.name} · {user.organization || 'Community Participant'}
              </h2>
              <p className="mt-1 text-xs text-[#D2DDD6]">
                <span className="font-mono-tabular font-semibold text-[#93C9A3]">
                  {mySummary?.points ?? user.points} pts
                </span>{' '}
                ·{' '}
                <span className="font-mono-tabular font-semibold text-[#F4F7F4]">
                  {mySummary?.completedHandovers ?? 0}
                </span>{' '}
                completed handovers · Verification: {user.verificationStatus}
              </p>
              {mySummary && mySummary.achievements.length > 0 && (
                <div className="mt-3 text-xs text-[#93C9A3]">
                  Achievements: {mySummary.achievements.join(' · ')}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={copyShareSummary}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] self-start cursor-pointer"
            >
              {copiedCard ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{copiedCard ? 'Copied Summary' : 'Copy Shareable Summary'}</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
