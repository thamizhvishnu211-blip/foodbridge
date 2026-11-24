import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Droplets,
  MessageCircle,
  Scan,
  ShieldCheck,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { MEDIA_ASSETS, resolveImageSrc } from '../data/media';
import type { AppTab, FoodDonation, ImpactSummary, MaterialListing } from '../types';
import { buildWhatsAppUrl, formatDateTime } from '../utils/format';
import { AnimatedCounter } from './AnimatedCounter';
import { VideoBackground } from './VideoBackground';

interface HomePageProps {
  impact: ImpactSummary | null;
  materials: MaterialListing[];
  donations: FoodDonation[];
  onNavigate: (tab: AppTab, subSection?: string) => void;
  onSelectMaterial: (item: MaterialListing) => void;
  onSelectDonation: (item: FoodDonation) => void;
}

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Sign In & List Surplus',
    detail:
      'Continue directly with Google for your workshop, restaurant, or organization, upload photos for AI-assisted material classification, or publish surplus food and used cooking oil lots.',
  },
  {
    step: '02',
    title: 'Smart Discovery & Matching',
    detail:
      'Buyers, industrial processors, and community recipients search categories or run explainable matchmaking based on quantity, condition, and proximity.',
  },
  {
    step: '03',
    title: 'Coordinate via WhatsApp',
    detail:
      'No online checkout or fees. Participants review enquiries, schedule collection windows, and coordinate logistics directly on WhatsApp.',
  },
  {
    step: '04',
    title: 'Confirm Handover & Impact',
    detail:
      'Once handed over, VERDORA locks a single audit-safe impact record, distinguishes verified business totals, and awards recognition points.',
  },
];

const FAQS = [
  {
    q: 'Does VERDORA process online payments or take commissions?',
    a: 'No. VERDORA is a resource coordination platform. Indicative prices may be listed for reference, and all handovers are coordinated directly between participants via WhatsApp.',
  },
  {
    q: 'How does the AI Material Scanner handle accuracy?',
    a: 'When configured with Gemini, the scanner provides a visual estimate of material type, condition, and reuse applications along with a quality checklist. It never claims laboratory certification.',
  },
  {
    q: 'How are Food Rescue safety and expiration handled?',
    a: 'Donors must disclose storage conditions, packaging, known allergens, and a pickup deadline. Expired donations are automatically closed, and VERDORA never certifies food safety via AI.',
  },
  {
    q: 'How does VERDORA calculate environmental impact?',
    a: 'Only genuine completed handovers recorded in the database are counted. Pending requests, incomplete claims, and non-mass units are excluded from kilogram totals, and verified organization totals are tracked transparently.',
  },
];

export function HomePage({
  impact,
  materials,
  donations,
  onNavigate,
  onSelectMaterial,
  onSelectDonation,
}: HomePageProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const liveMetrics = impact?.live;
  const shownKg = liveMetrics?.materialsRecoveredKg ?? 0;
  const shownPortions = liveMetrics?.foodPortionsRescued ?? 0;
  const shownHandovers =
    (liveMetrics?.materialHandoversCompleted ?? 0) +
    (liveMetrics?.foodHandoversCompleted ?? 0) +
    (liveMetrics?.oilRecoveriesCompleted ?? 0);
  const shownActive =
    (liveMetrics?.activeMaterialListings ?? 0) +
    (liveMetrics?.activeFoodDonations ?? 0) +
    (liveMetrics?.activeOilListings ?? 0);

  const featuredMaterials = materials.filter((m) => m.status === 'Active').slice(0, 3);
  const featuredFood = donations
    .filter((d) => !['Completed', 'Cancelled', 'Expired'].includes(d.status) && d.remainingPortions > 0)
    .slice(0, 2);

  return (
    <div className="bg-[#0A110E] text-[#F4F7F4]">
      {/* 1. CINEMATIC HERO */}
      <section className="relative flex min-h-[82vh] items-center overflow-hidden bg-[#0A110E] text-[#F4F7F4]">
        <VideoBackground alt="Sunlit sustainable circular economy timber pavilion nestled in a forest canopy" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-3xl"
          >
            <p className="text-xs font-semibold tracking-wider uppercase text-[#93C9A3]">
              VERDORA · A Better Life for Every Resource
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.08] tracking-tight text-[#F4F7F4] sm:text-5xl lg:text-6xl text-balance">
              Give Every Resource a Second Life.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[#D2DDD6] sm:text-lg">
              An intelligent circular economy connecting reusable materials, surplus food, used
              cooking oil recovery, and verified businesses building a more sustainable future.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('marketplace')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#348F68] whitespace-nowrap cursor-pointer focus-ring"
              >
                <span>Explore Marketplace</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('food-rescue')}
                className="inline-flex items-center gap-2 rounded-lg border border-[#A9B78D]/35 bg-[#111C17]/85 px-6 py-3 text-sm font-semibold text-[#F4F7F4] transition-colors hover:bg-[#172620] whitespace-nowrap cursor-pointer focus-ring"
              >
                <span>Discover Food Rescue</span>
              </button>
            </div>
          </motion.div>
        </div>

        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-center text-xs text-[#C8D6CD]">
          <span>Scroll to explore</span>
        </div>
      </section>

      {/* 2. LIVE IMPACT OVERVIEW */}
      <section className="border-y border-[#A9B78D]/15 bg-[#0F1A15]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#F4F7F4]">
                Recorded Platform Activity
              </h2>
              <p className="mt-1 text-sm text-[#C8D6CD]">
                Calculated strictly from real registered accounts and completed handovers.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('impact')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#93C9A3] hover:underline self-start cursor-pointer"
            >
              <span>Inspect Impact Methodology</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6 border-t border-[#A9B78D]/15 pt-6 lg:grid-cols-4">
            <div>
              <div className="text-xs font-medium text-[#C8D6CD]">Materials Recovered</div>
              <div className="mt-1 text-3xl font-semibold text-[#F4F7F4]">
                <AnimatedCounter value={shownKg} decimals={1} suffix=" kg" />
              </div>
              <div className="mt-1 text-xs text-[#9BB0A3]">Mass-verified handovers</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#C8D6CD]">Food Portions Rescued</div>
              <div className="mt-1 text-3xl font-semibold text-[#F4F7F4]">
                <AnimatedCounter value={shownPortions} />
              </div>
              <div className="mt-1 text-xs text-[#9BB0A3]">Completed redistributions</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#C8D6CD]">Completed Handovers</div>
              <div className="mt-1 text-3xl font-semibold text-[#F4F7F4]">
                <AnimatedCounter value={shownHandovers} />
              </div>
              <div className="mt-1 text-xs text-[#9BB0A3]">Materials, food & oil</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[#C8D6CD]">Active Listings</div>
              <div className="mt-1 text-3xl font-semibold text-[#F4F7F4]">
                <AnimatedCounter value={shownActive} />
              </div>
              <div className="mt-1 text-xs text-[#9BB0A3]">Live platform resources</div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. CORE CIRCULAR ECONOMY STREAMS */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 items-stretch">
          <div className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[#A9B78D]/20 bg-[#111C17] text-[#F4F7F4]">
            <div className="aspect-[16/9] w-full overflow-hidden bg-[#0D1612]">
              <img
                src={MEDIA_ASSETS.aluminium}
                alt="Sorted brushed aluminium sheets ready for secondary manufacturing"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-1 flex-col justify-between p-7 sm:p-9">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                  VERDORA Market & Oil Recovery
                </p>
                <h2 className="mt-2 font-display text-3xl font-semibold leading-snug text-[#F4F7F4] text-balance">
                  Turn unused materials & oil into industrial feedstock.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[#D2DDD6]">
                  Browse 15 material categories plus used cooking oil recovery lots. Scan batches
                  with AI, submit buyer enquiries, and coordinate pickups directly on WhatsApp.
                </p>
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('marketplace')}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#348F68] cursor-pointer focus-ring"
                >
                  <span>Explore Marketplace</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('oil-recovery')}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#A9B78D]/30 bg-[#172620] px-4 py-2.5 text-sm font-semibold text-[#F4F7F4] transition-colors hover:bg-[#21362D] cursor-pointer focus-ring"
                >
                  <Droplets className="h-4 w-4 text-[#D9BA7E]" />
                  <span>Oil Recovery</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[#93C9A3]/25 bg-[#14231C] text-[#F4F7F4]">
            <div className="aspect-[16/9] w-full overflow-hidden bg-[#0D1612]">
              <img
                src={MEDIA_ASSETS.produce}
                alt="Fresh harvest produce crate prepared for local food rescue redistribution"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-1 flex-col justify-between p-7 sm:p-9">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                  VERDORA Food Rescue
                </p>
                <h2 className="mt-2 font-display text-3xl font-semibold leading-snug text-[#F4F7F4] text-balance">
                  Good food deserves another chance.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[#D2DDD6]">
                  Connect bakeries, kitchens, and grocers with community recipients before pickup
                  deadlines pass. Transparent portion locking, allergen disclosures, and fast
                  WhatsApp handover coordination.
                </p>
              </div>
              <div className="mt-7">
                <button
                  type="button"
                  onClick={() => onNavigate('food-rescue')}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#348F68] cursor-pointer focus-ring"
                >
                  <span>Explore Food Rescue</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. HOW VERDORA WORKS */}
      <section className="border-y border-[#A9B78D]/15 bg-[#0F1A15] py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-[#F4F7F4]">
              How VERDORA Works
            </h2>
            <p className="mt-2 text-sm text-[#C8D6CD]">
              From real registration and surplus discovery to verified handover without payment friction.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="border-t border-[#A9B78D]/25 pt-5">
                <span className="font-mono-tabular text-xs font-semibold text-[#93C9A3]">
                  {item.step}.
                </span>
                <h3 className="mt-2 font-display text-xl font-semibold text-[#F4F7F4]">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#C8D6CD]">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. AI-POWERED CAPABILITIES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-[#F4F7F4]">
              AI-Assisted Resource Intelligence
            </h2>
            <p className="mt-2 text-sm text-[#C8D6CD]">
              Practical computer vision, explainable matchmaking, and circular-economy guidance.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('ai-lab')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#93C9A3] hover:underline self-start sm:self-auto cursor-pointer"
          >
            <span>Open AI Lab</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => onNavigate('ai-lab', 'scanner')}
            className="group flex flex-col justify-between rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-7 text-left transition-colors hover:border-[#93C9A3]/45 hover:bg-[#15231D] cursor-pointer focus-ring"
          >
            <div>
              <Scan className="h-6 w-6 text-[#93C9A3]" />
              <h3 className="mt-4 font-display text-xl font-semibold text-[#F4F7F4]">
                AI Material Scanner
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#C8D6CD]">
                Upload a photo of offcuts, timber, or textiles to generate a structured material
                assessment, quality checklist, and draft listing in one click.
              </p>
            </div>
            <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[#93C9A3] group-hover:underline">
              Launch Scanner <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('ai-lab', 'matcher')}
            className="group flex flex-col justify-between rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-7 text-left transition-colors hover:border-[#93C9A3]/45 hover:bg-[#15231D] cursor-pointer focus-ring"
          >
            <div>
              <Sparkles className="h-6 w-6 text-[#93C9A3]" />
              <h3 className="mt-4 font-display text-xl font-semibold text-[#F4F7F4]">
                Smart Material Matchmaking
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#C8D6CD]">
                Describe what you need—quantity, location, condition, and intended reuse—and get
                ranked live listings with transparent relevance explanations.
              </p>
            </div>
            <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[#93C9A3] group-hover:underline">
              Find Matches <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('ai-lab', 'assistant')}
            className="group flex flex-col justify-between rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-7 text-left transition-colors hover:border-[#93C9A3]/45 hover:bg-[#15231D] cursor-pointer focus-ring"
          >
            <div>
              <MessageCircle className="h-6 w-6 text-[#93C9A3]" />
              <h3 className="mt-4 font-display text-xl font-semibold text-[#F4F7F4]">
                Eco AI Assistant
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#C8D6CD]">
                Ask practical questions about pallet grades, responsible waste sorting, Food Rescue
                disclosures, or VERDORA impact calculation rules.
              </p>
            </div>
            <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[#93C9A3] group-hover:underline">
              Ask Assistant <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      </section>

      {/* 6. LIVE MARKETPLACE LISTINGS */}
      <section className="border-t border-[#A9B78D]/15 bg-[#0F1A15] py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="font-display text-3xl font-semibold text-[#F4F7F4]">
                Active Material Listings
              </h2>
              <p className="mt-1 text-sm text-[#C8D6CD]">
                Real reusable batches published by registered VERDORA suppliers.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('marketplace')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#93C9A3] hover:underline self-start sm:self-auto cursor-pointer"
            >
              <span>View Marketplace</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {featuredMaterials.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-8 text-center">
              <p className="text-sm font-semibold text-[#F4F7F4]">
                No live material listings published yet.
              </p>
              <p className="mt-1 text-xs text-[#C8D6CD]">
                Registered material suppliers and recycling businesses can publish listings in the Marketplace.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
              {featuredMaterials.map((item) => {
                const waUrl = buildWhatsAppUrl(item.whatsappNumber, 'material', item.title);
                return (
                  <article
                    key={item.id}
                    className="flex flex-col overflow-hidden rounded-2xl border border-[#A9B78D]/18 bg-[#111C17]"
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-[#0D1612]">
                      <img
                        src={resolveImageSrc(item.imageUrl, 'aluminium')}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                      />
                    </div>
                    <div className="flex flex-1 flex-col justify-between p-5">
                      <div>
                        <div className="text-xs text-[#9BB0A3]">
                          {item.category} · <span className="tabular-nums text-[#D2DDD6]">{item.quantity} {item.unit}</span> · {item.condition}
                        </div>
                        <h3 className="mt-1.5 font-display text-lg font-semibold text-[#F4F7F4]">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-xs text-[#C8D6CD]">{item.location}</p>
                      </div>
                      <div className="mt-5 flex items-center gap-2 border-t border-[#A9B78D]/15 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectMaterial(item);
                            onNavigate('marketplace');
                          }}
                          className="flex-1 rounded-lg bg-[#2B7A58] px-3 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                        >
                          View Details
                        </button>
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-[#A9B78D]/25 bg-[#172620] px-3 py-2 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D]"
                          >
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 7. ACTIVE FOOD DONATIONS */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-display text-3xl font-semibold text-[#F4F7F4]">
              Active Food Rescue Donations
            </h2>
            <p className="mt-1 text-sm text-[#C8D6CD]">
              Time-sensitive surplus food listed by registered kitchens with storage and allergen details.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('food-rescue')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#93C9A3] hover:underline self-start sm:self-auto cursor-pointer"
          >
            <span>Open Food Rescue</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {featuredFood.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-[#A9B78D]/18 bg-[#111C17] p-8 text-center">
            <p className="text-sm font-semibold text-[#F4F7F4]">
              No food donations have been recorded yet.
            </p>
            <p className="mt-1 text-xs text-[#C8D6CD]">
              Registered restaurants and food donors can post surplus batches in Food Rescue.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {featuredFood.map((donation) => (
              <article
                key={donation.id}
                className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[#A9B78D]/20 bg-[#111C17] sm:grid-cols-5"
              >
                <div className="aspect-[4/3] sm:aspect-auto sm:col-span-2 bg-[#0D1612]">
                  <img
                    src={resolveImageSrc(donation.imageUrl, 'bakery')}
                    alt={donation.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col justify-between p-6 sm:col-span-3">
                  <div>
                    <div className="text-xs text-[#9BB0A3]">
                      {donation.category} · <span className="tabular-nums font-medium text-[#93C9A3]">{donation.remainingPortions} portions left</span>
                    </div>
                    <h3 className="mt-1.5 font-display text-xl font-semibold text-[#F4F7F4]">
                      {donation.title}
                    </h3>
                    <p className="mt-2 text-xs text-[#D2DDD6]">
                      Pickup by {formatDateTime(donation.pickupDeadline)} · {donation.location}
                    </p>
                    <p className="mt-2 text-xs text-[#C8D6CD]">
                      Allergens: {donation.allergens || 'Not disclosed — verify before claiming'}
                    </p>
                  </div>
                  <div className="mt-5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectDonation(donation);
                        onNavigate('food-rescue');
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#2B7A58] px-4 py-2 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                    >
                      <Utensils className="h-3.5 w-3.5" />
                      <span>Inspect & Request</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 8. TRUST, REWARDS & FAQ */}
      <section className="border-t border-[#A9B78D]/15 bg-[#0F1A15] py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#93C9A3]">
                <ShieldCheck className="h-4 w-4" />
                <span>Trust & Transparent Recognition</span>
              </div>
              <h2 className="mt-2 font-display text-3xl font-semibold text-[#F4F7F4]">
                Built for Real Accountability
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#D2DDD6]">
                Organization verification badges are awarded strictly after human administrator
                review. Recognition points reward verified handovers—never clicks or duplicate
                claims—and carry no monetary value.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('impact')}
                  className="rounded-lg bg-[#2B7A58] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#348F68] cursor-pointer"
                >
                  View Impact & Leaderboard
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('workspace')}
                  className="rounded-lg border border-[#A9B78D]/30 bg-[#172620] px-4 py-2.5 text-xs font-semibold text-[#F4F7F4] hover:bg-[#21362D] cursor-pointer"
                >
                  Request Verification
                </button>
              </div>
            </div>

            <div className="lg:col-span-7">
              <h3 className="font-display text-2xl font-semibold text-[#F4F7F4]">
                Frequently Asked Questions
              </h3>
              <div className="mt-4 divide-y divide-[#A9B78D]/15 border-y border-[#A9B78D]/15">
                {FAQS.map((item, idx) => {
                  const open = openFaq === idx;
                  return (
                    <div key={item.q}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenFaq(open ? null : idx)}
                        className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold text-[#F4F7F4] hover:text-[#93C9A3] cursor-pointer"
                      >
                        <span>{item.q}</span>
                        {open ? (
                          <ChevronUp className="h-4 w-4 shrink-0 text-[#93C9A3]" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-[#C8D6CD]" />
                        )}
                      </button>
                      {open && (
                        <p className="pb-4 text-sm leading-relaxed text-[#D2DDD6]">{item.a}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. FINAL CTA & QUIET FOOTER */}
      <section className="border-t border-[#A9B78D]/15 bg-[#0D1F18] text-[#F4F7F4]">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-xl">
              <h2 className="font-display text-3xl font-semibold text-[#F4F7F4] text-balance">
                Ready to circulate materials, rescue food, or recover cooking oil?
              </h2>
              <p className="mt-2 text-sm text-[#D2DDD6]">
                Sign in directly with Google or try our AI Material Scanner in seconds.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('marketplace')}
                className="rounded-lg bg-[#2B7A58] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#348F68] cursor-pointer"
              >
                Open Marketplace
              </button>
              <button
                type="button"
                onClick={() => onNavigate('oil-recovery')}
                className="rounded-lg border border-[#A9B78D]/35 bg-[#111C17] px-5 py-2.5 text-sm font-semibold text-[#F4F7F4] hover:bg-[#172620] cursor-pointer"
              >
                Oil Recovery
              </button>
              <button
                type="button"
                onClick={() => onNavigate('food-rescue')}
                className="rounded-lg border border-[#A9B78D]/35 bg-[#111C17] px-5 py-2.5 text-sm font-semibold text-[#F4F7F4] hover:bg-[#172620] cursor-pointer"
              >
                Open Food Rescue
              </button>
            </div>
          </div>
        </div>
        <footer className="border-t border-[#A9B78D]/15 bg-[#07110D]">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-4 py-6 text-xs text-[#C8D6CD] sm:flex-row sm:items-center sm:px-6 lg:px-8">
            <div>
              <span className="font-display text-sm font-semibold text-[#F4F7F4]">VERDORA</span> · A
              Better Life for Every Resource.
            </div>
            <div className="flex flex-wrap gap-5">
              <button type="button" onClick={() => onNavigate('marketplace')} className="hover:text-[#F4F7F4] cursor-pointer">
                Marketplace
              </button>
              <button type="button" onClick={() => onNavigate('oil-recovery')} className="hover:text-[#F4F7F4] cursor-pointer">
                Oil Recovery
              </button>
              <button type="button" onClick={() => onNavigate('food-rescue')} className="hover:text-[#F4F7F4] cursor-pointer">
                Food Rescue
              </button>
              <button type="button" onClick={() => onNavigate('ai-lab')} className="hover:text-[#F4F7F4] cursor-pointer">
                AI Assistant
              </button>
              <button type="button" onClick={() => onNavigate('impact')} className="hover:text-[#F4F7F4] cursor-pointer">
                Impact Methodology
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
