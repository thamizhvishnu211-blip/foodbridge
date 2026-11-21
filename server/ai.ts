import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface MaterialScanResponse {
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

export interface FoodScanResponse {
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

export interface LiveMaterialContextItem {
  id: string;
  title: string;
  category: string;
  quantity: number;
  unit: string;
  condition: string;
  location: string;
  indicativePrice: number | null;
  reuseApplications: string[];
}

export interface LiveFoodContextItem {
  id: string;
  title: string;
  category: string;
  remainingPortions: number;
  portions: number;
  location: string;
  pickupDeadline: string;
  storageInfo: string;
  allergens: string;
  dietaryInfo: string;
}

export interface LiveMarketplaceContext {
  activeMaterials: LiveMaterialContextItem[];
  activeFoodDonations: LiveFoodContextItem[];
}

export interface ResourceGuideResponse {
  mode: 'live-gemini' | 'demo-fallback';
  isDemoFallback: boolean;
  summary: string;
  steps: string[];
  safetyOrQualityNote: string;
  matchedIds: string[];
}

const VALID_MATERIAL_CATEGORIES = [
  'Metal', 'Aluminium', 'Steel', 'Copper', 'Plastic', 'Paper', 'Cardboard',
  'Wood', 'Glass', 'Textile', 'Rubber', 'Construction materials',
  'Electronic components', 'Organic materials', 'Other reusable materials',
];

const VALID_FOOD_CATEGORIES = [
  'Cooked food',
  'Bakery items',
  'Fresh produce',
  'Packaged groceries',
  'Dry rations',
  'Beverages',
  'Prepared meals',
  'Other surplus food',
];

const MATERIAL_DISCLAIMER =
  'AI-generated material identification is an estimate. Verify material composition, condition, and INR pricing directly before reuse or pickup.';

const FOOD_DISCLAIMER =
  'AI-generated food draft is a listing helper only and NEVER certifies food safety. Donors must verify preparation time, storage temperature, allergens, and freshness personally.';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 450 * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

function buildFallbackMaterialScan(contextText: string, mimeType: string | null): MaterialScanResponse {
  const lower = contextText.toLowerCase();
  let predictedMaterial = 'Reusable Timber / Pallets';
  let suggestedCategory = 'Wood';
  let reuseApplications = [
    'Modular workshop shelving or storage racks',
    'Raised community garden beds',
    'Upcycled furniture frames and acoustic slat panels',
  ];

  if (lower.includes('alum') || lower.includes('metal') || lower.includes('sheet')) {
    predictedMaterial = 'Brushed Aluminium Offcuts';
    suggestedCategory = 'Aluminium';
    reuseApplications = [
      'Laser-cut mounting brackets and enclosures',
      'Signage plates and architectural trim',
      'Small-batch prototype fabrication',
    ];
  } else if (lower.includes('fabric') || lower.includes('textile') || lower.includes('cotton') || lower.includes('linen')) {
    predictedMaterial = 'Natural Woven Textile Remnants';
    suggestedCategory = 'Textile';
    reuseApplications = [
      'Reusable tote bags and utility aprons',
      'Acoustic studio panels or upholstery',
      'Vocational tailoring practice bolts',
    ];
  } else if (lower.includes('plastic') || lower.includes('hdpe') || lower.includes('pet')) {
    predictedMaterial = 'Sorted Rigid Polymer / HDPE';
    suggestedCategory = 'Plastic';
    reuseApplications = [
      'Thermoformed trays and outdoor planters',
      'Workshop storage bins',
      'Clean pelletized regrind feedstock',
    ];
  } else if (lower.includes('cardboard') || lower.includes('box') || lower.includes('paper')) {
    predictedMaterial = 'Corrugated Cardboard & Kraft Stock';
    suggestedCategory = 'Cardboard';
    reuseApplications = [
      'Secondary e-commerce shipping cartons',
      'Protective layer pads for warehouse pallets',
      'Shredded void-fill packaging',
    ];
  } else if (lower.includes('chair') || lower.includes('table') || lower.includes('furniture') || lower.includes('desk')) {
    predictedMaterial = 'Reusable Timber & Office Furniture';
    suggestedCategory = 'Wood';
    reuseApplications = [
      'Direct workshop or community study furniture reuse',
      'Refurbished office or school desks',
      'Solid timber parts for carpentry repairs',
    ];
  } else if (lower.includes('copper') || lower.includes('wire') || lower.includes('cable')) {
    predictedMaterial = 'Clean Copper Offcuts & Wiring';
    suggestedCategory = 'Copper';
    reuseApplications = [
      'Electrical busbars and grounding assemblies',
      'Artisan craft and sculpture metalwork',
      'Authorized metal reprocessing feedstock',
    ];
  }

  return {
    mode: 'demo-fallback',
    isDemoFallback: true,
    predictedMaterial,
    suggestedCategory,
    visibleCondition: 'Good (Offline Estimate — Physical Inspection Recommended)',
    confidenceLabel: 'Offline Draft Mode (GEMINI_API_KEY not configured)',
    confidenceScore: null,
    observations: [
      mimeType
        ? `Analyzed uploaded ${mimeType.replace('image/', '').toUpperCase()} image via offline fallback.`
        : 'Generated draft from your written object/material description via offline fallback.',
      contextText ? `Incorporated context: "${contextText.slice(0, 120)}"` : 'No additional material notes provided.',
      'Physical inspection for structural integrity, moisture, or surface coatings is advised prior to listing.',
    ],
    reuseApplications,
    qualityChecklist: [
      'Verify exact dimensions, count, thickness, or weight in kg before publishing',
      'State any indicative price in Indian Rupees (₹ INR) or mark ₹0 for Free Pickup',
      'Inspect edges, fasteners, or surface coatings and photograph blemishes clearly',
    ],
    suggestedTitle: `${predictedMaterial} — Clean Surplus Batch`,
    suggestedDescription:
      `Estimated ${predictedMaterial.toLowerCase()} suitable for secondary manufacturing, makerspace fabrication, or local reuse.${contextText ? ` Notes: ${contextText}` : ''}`,
    disclaimer: MATERIAL_DISCLAIMER,
  };
}

export async function analyzeMaterialImage(
  base64Data: string | null,
  mimeType: string | null,
  contextText: string
): Promise<MaterialScanResponse> {
  const ai = getGeminiClient();
  if (!ai) {
    return buildFallbackMaterialScan(contextText, mimeType);
  }

  const prompt = [
    'Analyze the uploaded material/object photo and/or text notes for VERDORA, a circular-economy marketplace in India (currency INR / ₹).',
    `Allowed categories (pick the single best match): ${VALID_MATERIAL_CATEGORIES.join(', ')}.`,
    contextText ? `User-provided context: ${contextText}` : 'No extra text context provided.',
    'Rules:',
    '- Be honest and conservative. Never claim laboratory certification or exact alloy/chemical grade from a photo alone.',
    '- Provide practical reuse applications and a concrete quality-check checklist for a buyer in India.',
    '- confidenceScore must be an integer 0-100 reflecting visual certainty.',
  ].join('\n');

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  if (base64Data && mimeType) {
    parts.push({ inlineData: { mimeType, data: base64Data } });
  }
  parts.push({ text: prompt });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            predictedMaterial: { type: Type.STRING },
            suggestedCategory: { type: Type.STRING },
            visibleCondition: { type: Type.STRING },
            confidenceScore: { type: Type.INTEGER },
            observations: { type: Type.ARRAY, items: { type: Type.STRING } },
            reuseApplications: { type: Type.ARRAY, items: { type: Type.STRING } },
            qualityChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedTitle: { type: Type.STRING },
            suggestedDescription: { type: Type.STRING },
          },
          required: [
            'predictedMaterial',
            'suggestedCategory',
            'visibleCondition',
            'confidenceScore',
            'observations',
            'reuseApplications',
            'qualityChecklist',
            'suggestedTitle',
            'suggestedDescription',
          ],
        },
      },
    })
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Model returned an empty analysis response.');
  }

  const parsed = JSON.parse(rawText) as Omit<
    MaterialScanResponse,
    'mode' | 'isDemoFallback' | 'confidenceLabel' | 'disclaimer'
  >;

  const normalizedCategory = VALID_MATERIAL_CATEGORIES.includes(parsed.suggestedCategory)
    ? parsed.suggestedCategory
    : 'Other reusable materials';

  const score = Math.max(10, Math.min(98, Number(parsed.confidenceScore) || 72));

  return {
    mode: 'live-gemini',
    isDemoFallback: false,
    predictedMaterial: parsed.predictedMaterial,
    suggestedCategory: normalizedCategory,
    visibleCondition: parsed.visibleCondition,
    confidenceLabel: `${score}% model estimate`,
    confidenceScore: score,
    observations: parsed.observations.slice(0, 5),
    reuseApplications: parsed.reuseApplications.slice(0, 5),
    qualityChecklist: parsed.qualityChecklist.slice(0, 5),
    suggestedTitle: parsed.suggestedTitle,
    suggestedDescription: parsed.suggestedDescription,
    disclaimer: MATERIAL_DISCLAIMER,
  };
}

function buildFallbackFoodScan(contextText: string, mimeType: string | null): FoodScanResponse {
  const lower = contextText.toLowerCase();
  let predictedFood = 'Fresh Prepared Surplus Meals';
  let suggestedCategory = 'Prepared meals';
  let estimatedQuantity = 10;
  let estimatedUnit = 'kg';
  let estimatedPortions = 25;
  let storageAdvice = 'Held in clean insulated/hot-case containers or refrigerated at 4°C';
  let packagingAdvice = 'Sealed food-grade stainless steel or leak-proof containers';
  let potentialAllergens = 'Verify exact ingredients (check for gluten, dairy, nuts, or sesame)';
  let dietaryTags = 'Vegetarian';

  if (lower.includes('bread') || lower.includes('bakery') || lower.includes('loaf') || lower.includes('bun') || lower.includes('cake') || lower.includes('pastry')) {
    predictedFood = 'Fresh Bakery Surplus & Loaves';
    suggestedCategory = 'Bakery items';
    estimatedQuantity = 8;
    estimatedUnit = 'kg';
    estimatedPortions = 30;
    storageAdvice = 'Stored at cool ambient temperature in covered food-grade racks';
    packagingAdvice = 'Clean perforated food crates or kraft bakery bags';
    potentialAllergens = 'Gluten, Wheat, possible Dairy/Sesame';
    dietaryTags = 'Vegetarian';
  } else if (lower.includes('fruit') || lower.includes('veg') || lower.includes('produce') || lower.includes('tomato') || lower.includes('banana') || lower.includes('apple')) {
    predictedFood = 'Surplus Fresh Fruits & Vegetables';
    suggestedCategory = 'Fresh produce';
    estimatedQuantity = 15;
    estimatedUnit = 'kg';
    estimatedPortions = 40;
    storageAdvice = 'Kept dry in ventilated cool crate away from direct sunlight';
    packagingAdvice = 'Breathable ventilated produce crates';
    potentialAllergens = 'None known';
    dietaryTags = 'Vegan, Vegetarian, Gluten-Free';
  } else if (lower.includes('rice') || lower.includes('biryani') || lower.includes('roti') || lower.includes('dal') || lower.includes('curry') || lower.includes('meal') || lower.includes('chapati')) {
    predictedFood = 'Surplus Cooked Rice, Dal & Meal Trays';
    suggestedCategory = 'Cooked food';
    estimatedQuantity = 12;
    estimatedUnit = 'kg';
    estimatedPortions = 30;
    storageAdvice = 'Hot-held above 60°C or rapidly chilled below 5°C in covered vessels';
    packagingAdvice = 'Sealed food-grade gastronorm trays or tiffin containers';
    potentialAllergens = 'Verify dairy/ghee, cashews, peanuts, or wheat gluten';
    dietaryTags = lower.includes('chicken') || lower.includes('mutton') || lower.includes('egg') || lower.includes('fish')
      ? 'Non-Vegetarian'
      : 'Vegetarian';
  } else if (lower.includes('dal') || lower.includes('grain') || lower.includes('atta') || lower.includes('flour') || lower.includes('ration') || lower.includes('dry')) {
    predictedFood = 'Unopened Dry Rations & Grains';
    suggestedCategory = 'Dry rations';
    estimatedQuantity = 20;
    estimatedUnit = 'kg';
    estimatedPortions = 60;
    storageAdvice = 'Sealed dry pantry storage off the floor';
    packagingAdvice = 'Factory-sealed sacks or airtight food-grade bins';
    potentialAllergens = 'Check label (Wheat/Gluten or Nuts if applicable)';
    dietaryTags = 'Vegetarian, Vegan';
  }

  return {
    mode: 'demo-fallback',
    isDemoFallback: true,
    predictedFood,
    suggestedCategory,
    estimatedQuantity,
    estimatedUnit,
    estimatedPortions,
    storageAdvice,
    packagingAdvice,
    potentialAllergens,
    dietaryTags,
    confidenceLabel: 'Offline Draft Mode (GEMINI_API_KEY not configured)',
    confidenceScore: null,
    observations: [
      mimeType
        ? `Generated Food Rescue draft from uploaded ${mimeType.replace('image/', '').toUpperCase()} photo via offline fallback.`
        : 'Generated Food Rescue draft from your description via offline fallback.',
      contextText ? `Incorporated details: "${contextText.slice(0, 120)}"` : 'No extra food notes provided.',
      'Confirm actual portions, preparation timestamp, and safe pickup window before publishing.',
    ],
    handlingChecklist: [
      'Confirm exact preparation date/time and realistic pickup deadline',
      'Disclose storage temperature (hot-held above 60°C, chilled 4°C, or ambient)',
      'State all known allergens (dairy/ghee, nuts, gluten, soy, sesame) honestly',
      'Pack in sealed food-grade containers ready for community pickup',
    ],
    suggestedTitle: `${predictedFood} (${estimatedPortions} Portions)`,
    suggestedDescription:
      `Surplus ${predictedFood.toLowerCase()} available for immediate community rescue pickup.${contextText ? ` Donor notes: ${contextText}` : ''}`,
    disclaimer: FOOD_DISCLAIMER,
  };
}

export async function analyzeFoodDonation(
  base64Data: string | null,
  mimeType: string | null,
  contextText: string
): Promise<FoodScanResponse> {
  const ai = getGeminiClient();
  if (!ai) {
    return buildFallbackFoodScan(contextText, mimeType);
  }

  const prompt = [
    'Analyze the uploaded food photo and/or description to help a donor create a Food Rescue donation listing on VERDORA India.',
    `Allowed food categories (pick the single best match): ${VALID_FOOD_CATEGORIES.join(', ')}.`,
    contextText ? `Donor notes/context: ${contextText}` : 'No extra notes provided.',
    'Rules:',
    '- NEVER claim or certify that food is safe to eat or fit for consumption — you are strictly drafting a structured listing helper.',
    '- Provide practical conservative estimates for estimatedQuantity (number), estimatedUnit (e.g., kg, trays, loaves, packs), and estimatedPortions (whole integer).',
    '- Suggest clear storageAdvice, packagingAdvice, potentialAllergens to verify, dietaryTags, and a concrete handlingChecklist.',
    '- confidenceScore must be an integer 0-100 reflecting visual/contextual certainty.',
  ].join('\n');

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  if (base64Data && mimeType) {
    parts.push({ inlineData: { mimeType, data: base64Data } });
  }
  parts.push({ text: prompt });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            predictedFood: { type: Type.STRING },
            suggestedCategory: { type: Type.STRING },
            estimatedQuantity: { type: Type.NUMBER },
            estimatedUnit: { type: Type.STRING },
            estimatedPortions: { type: Type.INTEGER },
            storageAdvice: { type: Type.STRING },
            packagingAdvice: { type: Type.STRING },
            potentialAllergens: { type: Type.STRING },
            dietaryTags: { type: Type.STRING },
            confidenceScore: { type: Type.INTEGER },
            observations: { type: Type.ARRAY, items: { type: Type.STRING } },
            handlingChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedTitle: { type: Type.STRING },
            suggestedDescription: { type: Type.STRING },
          },
          required: [
            'predictedFood',
            'suggestedCategory',
            'estimatedQuantity',
            'estimatedUnit',
            'estimatedPortions',
            'storageAdvice',
            'packagingAdvice',
            'potentialAllergens',
            'dietaryTags',
            'confidenceScore',
            'observations',
            'handlingChecklist',
            'suggestedTitle',
            'suggestedDescription',
          ],
        },
      },
    })
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Model returned an empty food analysis response.');
  }

  const parsed = JSON.parse(rawText) as Omit<
    FoodScanResponse,
    'mode' | 'isDemoFallback' | 'confidenceLabel' | 'disclaimer'
  >;

  const normalizedCategory = VALID_FOOD_CATEGORIES.includes(parsed.suggestedCategory)
    ? parsed.suggestedCategory
    : 'Other surplus food';

  const score = Math.max(10, Math.min(98, Number(parsed.confidenceScore) || 74));

  return {
    mode: 'live-gemini',
    isDemoFallback: false,
    predictedFood: parsed.predictedFood,
    suggestedCategory: normalizedCategory,
    estimatedQuantity: Math.max(0.5, Number(parsed.estimatedQuantity) || 5),
    estimatedUnit: parsed.estimatedUnit?.trim() || 'kg',
    estimatedPortions: Math.max(1, Math.round(Number(parsed.estimatedPortions) || 15)),
    storageAdvice: parsed.storageAdvice,
    packagingAdvice: parsed.packagingAdvice,
    potentialAllergens: parsed.potentialAllergens,
    dietaryTags: parsed.dietaryTags,
    confidenceLabel: `${score}% model estimate`,
    confidenceScore: score,
    observations: parsed.observations.slice(0, 5),
    handlingChecklist: parsed.handlingChecklist.slice(0, 5),
    suggestedTitle: parsed.suggestedTitle,
    suggestedDescription: parsed.suggestedDescription,
    disclaimer: FOOD_DISCLAIMER,
  };
}

function formatLiveInventorySummary(ctx: LiveMarketplaceContext): string {
  const matLines =
    ctx.activeMaterials.length === 0
      ? '  - None currently active in Material Marketplace.'
      : ctx.activeMaterials.slice(0, 25).map(
          (m) =>
            `  - [${m.id}] "${m.title}" | Category: ${m.category} | Qty: ${m.quantity} ${m.unit} | Condition: ${m.condition} | Location: ${m.location} | Price: ${m.indicativePrice === null ? 'On inquiry' : m.indicativePrice === 0 ? 'Free Pickup' : `₹${m.indicativePrice} INR`}`
        ).join('\n');

  const foodLines =
    ctx.activeFoodDonations.length === 0
      ? '  - None currently active in Food Rescue.'
      : ctx.activeFoodDonations.slice(0, 25).map(
          (d) =>
            `  - [${d.id}] "${d.title}" | Category: ${d.category} | Remaining Portions: ${d.remainingPortions}/${d.portions} | Location: ${d.location} | Deadline: ${d.pickupDeadline} | Storage: ${d.storageInfo || 'Not specified'} | Allergens: ${d.allergens || 'Check with donor'} | Dietary: ${d.dietaryInfo || 'Unspecified'}`
        ).join('\n');

  return `ACTIVE MATERIAL MARKETPLACE LISTINGS:\n${matLines}\n\nACTIVE FOOD RESCUE DONATIONS:\n${foodLines}`;
}

export async function guideResourceSeeker(params: {
  kind: 'food' | 'material';
  query: string;
  location?: string;
  quantityOrPortions?: number;
  liveContext: LiveMarketplaceContext;
}): Promise<ResourceGuideResponse> {
  const { kind, query, location, quantityOrPortions, liveContext } = params;
  const validIds = new Set(
    kind === 'food'
      ? liveContext.activeFoodDonations.map((d) => d.id)
      : liveContext.activeMaterials.map((m) => m.id)
  );

  const ai = getGeminiClient();
  if (!ai) {
    return buildFallbackGuide(params, validIds);
  }

  const inventoryText = formatLiveInventorySummary(liveContext);
  const prompt = [
    `User is seeking ${kind === 'food' ? 'SURPLUS FOOD on VERDORA Food Rescue' : 'a REUSABLE OBJECT OR MATERIAL on VERDORA Marketplace'} in India (INR ₹).`,
    `User request: "${query}"`,
    location ? `Preferred location: ${location}` : '',
    quantityOrPortions ? `Target ${kind === 'food' ? 'portions' : 'quantity'}: ${quantityOrPortions}` : '',
    '',
    'Live database inventory (ONLY reference listings/donations below — NEVER invent or fabricate any listing or fake customer):',
    inventoryText,
    '',
    'Instructions:',
    '- If real matching items exist above, include their exact IDs in matchedIds (maximum 4), summarize why they fit, and give 3-5 clear step-by-step actions (inspect details, submit request, coordinate on WhatsApp, confirm handover).',
    '- If NO active items match right now, return matchedIds: [], clearly explain that no live listings match yet, and guide the user on broadening filters or creating a listing if they have surplus.',
    kind === 'food'
      ? '- Include a clear safety reminder to inspect storage temperature, preparation time, allergens, and pickup deadline before collection (never certify safety).'
      : '- Include a clear quality reminder to verify dimensions, condition, and ₹ INR pricing directly before transport.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            steps: { type: Type.ARRAY, items: { type: Type.STRING } },
            safetyOrQualityNote: { type: Type.STRING },
            matchedIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['summary', 'steps', 'safetyOrQualityNote', 'matchedIds'],
        },
      },
    })
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Model returned an empty guide response.');
  }

  const parsed = JSON.parse(rawText) as {
    summary: string;
    steps: string[];
    safetyOrQualityNote: string;
    matchedIds: string[];
  };

  return {
    mode: 'live-gemini',
    isDemoFallback: false,
    summary: parsed.summary,
    steps: parsed.steps.slice(0, 6),
    safetyOrQualityNote: parsed.safetyOrQualityNote,
    matchedIds: (parsed.matchedIds || []).filter((id) => validIds.has(id)).slice(0, 4),
  };
}

function buildFallbackGuide(
  params: {
    kind: 'food' | 'material';
    query: string;
    location?: string;
    quantityOrPortions?: number;
    liveContext: LiveMarketplaceContext;
  },
  validIds: Set<string>
): ResourceGuideResponse {
  const { kind, query, location, liveContext } = params;
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const loc = (location || '').trim().toLowerCase();

  if (kind === 'food') {
    const matches = liveContext.activeFoodDonations
      .filter((d) => {
        const hay = `${d.title} ${d.category} ${d.dietaryInfo} ${d.location}`.toLowerCase();
        const kwOk = tokens.length === 0 || tokens.some((t) => hay.includes(t));
        const locOk = !loc || d.location.toLowerCase().includes(loc);
        return kwOk || locOk;
      })
      .slice(0, 4);

    if (matches.length === 0) {
      return {
        mode: 'demo-fallback',
        isDemoFallback: true,
        summary:
          'No active Food Rescue donations currently match your request in the live database. Try clearing the city filter, checking All Food Categories, or checking back soon as verified kitchens post fresh batches.',
        steps: [
          'Open the Food Rescue tab and set Category to "All Food Categories" to view every live batch.',
          'Sign in with Google so you can request portions immediately when a nearby kitchen publishes surplus food.',
          'If your organization also has surplus food to share, switch to the AI Scanner ("Surplus Food Donation") to create a Food Rescue listing in seconds.',
        ],
        safetyOrQualityNote:
          'Food Rescue coordinates direct collection only. Always verify preparation time, storage condition, allergens, and pickup deadline with the donor.',
        matchedIds: [],
      };
    }

    return {
      mode: 'demo-fallback',
      isDemoFallback: true,
      summary: `Found ${matches.length} active Food Rescue ${matches.length === 1 ? 'donation' : 'donations'} in the live database: ${matches.map((m) => `"${m.title}" (${m.remainingPortions} portions in ${m.location})`).join('; ')}.`,
      steps: [
        'Click "Inspect Food & Request" on a recommended donation below to review preparation time, storage temperature, and known allergens.',
        'Enter the number of portions your community kitchen or household can collect before the pickup deadline and submit your request.',
        'Once the donor accepts and reserves your portions, use WhatsApp in Workspace to coordinate pickup arrival.',
        'Confirm completion in Workspace after handover so the rescued portions are recorded in the VERDORA Impact Ledger.',
      ],
      safetyOrQualityNote:
        'VERDORA does not certify food safety. Always inspect temperature, packaging integrity, and allergen disclosures upon collection.',
      matchedIds: matches.map((m) => m.id).filter((id) => validIds.has(id)),
    };
  }

  const matMatches = liveContext.activeMaterials
    .filter((m) => {
      const hay = `${m.title} ${m.category} ${m.location} ${m.reuseApplications.join(' ')}`.toLowerCase();
      const kwOk = tokens.length === 0 || tokens.some((t) => hay.includes(t));
      const locOk = !loc || m.location.toLowerCase().includes(loc);
      return kwOk || locOk;
    })
    .slice(0, 4);

  if (matMatches.length === 0) {
    return {
      mode: 'demo-fallback',
      isDemoFallback: true,
      summary:
        'No active reusable objects or material listings currently match your search in the live database. Try broadening your category or location filter.',
      steps: [
        'Open the Market tab with Category set to "All" to browse every active reusable material or object.',
        'Check AI Material Scanner if you have surplus objects or scrap yourself and want to publish a ₹ INR listing.',
      ],
      safetyOrQualityNote:
        'VERDORA uses zero online checkout. Indicative prices are listed in ₹ INR and settled or arranged directly between participants.',
      matchedIds: [],
    };
  }

  return {
    mode: 'demo-fallback',
    isDemoFallback: true,
    summary: `Found ${matMatches.length} active reusable ${matMatches.length === 1 ? 'listing' : 'listings'}: ${matMatches.map((m) => `"${m.title}" (${m.quantity} ${m.unit} in ${m.location}, ${m.indicativePrice === null ? 'Price on inquiry' : m.indicativePrice === 0 ? 'Free Pickup' : `₹${m.indicativePrice}`})`).join('; ')}.`,
    steps: [
      'Click "Open Listing & Request" on a matching item below to inspect full dimensions, condition, and pickup notes.',
      'Submit your requested quantity and intended reuse application (or message the supplier directly via WhatsApp).',
      'Coordinate loading/transport schedule in Workspace; settle any agreed ₹ INR amount directly on handover (no online checkout).',
      'Click "Confirm Completed Handover" in Workspace once collected to log verified material recovery.',
    ],
    safetyOrQualityNote:
      'Inspect physical dimensions, coatings, and condition on pickup before finalizing your ₹ INR arrangement.',
    matchedIds: matMatches.map((m) => m.id).filter((id) => validIds.has(id)),
  };
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export async function askEcoAssistant(
  message: string,
  history: AssistantTurn[],
  liveContext?: LiveMarketplaceContext
): Promise<{ reply: string; mode: 'live-gemini' | 'demo-fallback'; isDemoFallback: boolean }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      mode: 'demo-fallback',
      isDemoFallback: true,
      reply: buildFallbackAssistantReply(message, liveContext),
    };
  }

  const liveInventoryText = liveContext
    ? `\n\nLIVE DATABASE INVENTORY (Reference ONLY real items below when guiding seekers; never fabricate items):\n${formatLiveInventorySummary(liveContext)}`
    : '';

  const systemInstruction = `You are the VERDORA Eco AI Assistant ("A Better Life for Every Resource"), operating for India (all currency is Indian Rupees ₹ / INR, never USD/$).
Help users with BOTH offering and finding resources:
1. Creating listings for BOTH reusable objects/materials (Marketplace) AND surplus food donations (Food Rescue — direct users to AI Lab -> Scanner -> Surplus Food Donation or Food Rescue -> Donate Food).
2. Guiding anyone who WANTS FOOD: inspect the live Food Rescue inventory below, recommend real matching donations with portions, location, deadline, storage & allergens, and walk them through requesting & WhatsApp pickup. NEVER certify food as safe to eat.
3. Guiding anyone who WANTS AN OBJECT OR MATERIAL: inspect the live Material Marketplace inventory below, recommend real matching listings with quantity, condition, location & ₹ INR indicative price, and walk them through requesting & direct handover.
4. Explaining VERDORA's transparent impact methodology (only completed handovers count, zero online checkout, direct WhatsApp coordination).
If no active listings or food donations in the live database match what the seeker asks for, honestly tell them none are listed right now rather than inventing fake items.
Keep answers concise, structured, practical, and under 240 words.${liveInventoryText}`;

  const conversationTranscript = history
    .slice(-8)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n');

  const fullPrompt = conversationTranscript
    ? `${conversationTranscript}\nUser: ${message}`
    : message;

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: fullPrompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })
  );

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Assistant returned an empty response.');
  }

  return {
    mode: 'live-gemini',
    isDemoFallback: false,
    reply: text,
  };
}

function buildFallbackAssistantReply(message: string, liveContext?: LiveMarketplaceContext): string {
  const q = message.toLowerCase();
  const wantsFood =
    (q.includes('want') || q.includes('need') || q.includes('looking') || q.includes('find') || q.includes('guide') || q.includes('get')) &&
    (q.includes('food') || q.includes('meal') || q.includes('bread') || q.includes('bakery') || q.includes('rice') || q.includes('produce'));
  const wantsObject =
    (q.includes('want') || q.includes('need') || q.includes('looking') || q.includes('find') || q.includes('guide') || q.includes('get')) &&
    (q.includes('object') || q.includes('material') || q.includes('wood') || q.includes('pallet') || q.includes('alum') || q.includes('metal') || q.includes('table') || q.includes('chair') || q.includes('textile') || q.includes('plastic'));

  if (wantsFood) {
    const activeFood = liveContext?.activeFoodDonations ?? [];
    if (activeFood.length > 0) {
      const top = activeFood.slice(0, 3);
      return [
        `Active Food Rescue options available right now (${activeFood.length} live):`,
        ...top.map(
          (d) => `• "${d.title}" — ${d.remainingPortions} portions left in ${d.location} (Storage: ${d.storageInfo || 'Check listing'}; Allergens: ${d.allergens || 'Check with donor'})`
        ),
        'How to get it: Open the Food Rescue tab (or AI Smart Matching -> Find Surplus Food), inspect the safety & deadline details, submit a request for the portions you need, and coordinate pickup directly via WhatsApp.',
      ].join('\n\n');
    }
    return [
      'No active surplus food donations are currently posted in the live database.',
      'You can check the Food Rescue tab periodically or use AI Smart Matching -> Find Surplus Food to filter by city and food category as soon as donors publish new batches.',
    ].join('\n\n');
  }

  if (wantsObject) {
    const activeMats = liveContext?.activeMaterials ?? [];
    if (activeMats.length > 0) {
      const top = activeMats.slice(0, 3);
      return [
        `Active reusable materials & objects available right now (${activeMats.length} live):`,
        ...top.map(
          (m) =>
            `• "${m.title}" — ${m.quantity} ${m.unit} (${m.condition}) in ${m.location} · ${m.indicativePrice === null ? 'Price on inquiry' : m.indicativePrice === 0 ? 'Free Pickup' : `₹${m.indicativePrice} INR`}`
        ),
        'How to get it: Open the Market tab (or AI Smart Matching -> Find Reusable Object), click "View Details", submit your quantity & reuse request, and coordinate pickup + ₹ INR handover directly via WhatsApp.',
      ].join('\n\n');
    }
    return [
      'No active reusable objects or material listings are currently posted in the live database.',
      'Check the Market tab or Smart Matching soon — or if you have surplus materials to list, use AI Lab -> Resource & Food Scanner to draft a ₹ INR listing.',
    ].join('\n\n');
  }

  if (q.includes('pallet') || q.includes('wood')) {
    return [
      'Clean heat-treated (HT) wooden pallets can be reused for warehouse shelving, raised garden planters, modular workshop benches, or retail display risers.',
      'Before listing on VERDORA Market: check for the "HT" stamp, count whole vs. split slats, note pallet dimensions, set an indicative price in ₹ INR (or ₹0 for Free Pickup), and specify loading bay access.',
    ].join('\n\n');
  }
  if (q.includes('food') || q.includes('donate') || q.includes('rescue')) {
    return [
      'To create a surplus food donation with AI: go to AI Lab -> Resource & Food Scanner, switch to "Surplus Food Donation", upload a photo or describe your food, and click "Create Food Donation Listing" to pre-fill the Food Rescue form.',
      'Always include exact portions, preparation time, storage temperature, known allergens, and pickup deadline. VERDORA coordinates handovers via request approval and WhatsApp — it does not certify food safety.',
    ].join('\n\n');
  }
  if (q.includes('impact') || q.includes('calculate') || q.includes('co2')) {
    return [
      'VERDORA calculates impact strictly from completed handover records (never pending or cancelled requests). Each handover has a unique ledger lock so it cannot be counted twice.',
      'Units that cannot reliably convert to mass (such as pallets or crates) are tracked separately from kilogram totals, and impact totals reflect strictly completed handovers from real registered accounts.',
    ].join('\n\n');
  }
  if (q.includes('alum') || q.includes('metal') || q.includes('list') || q.includes('object')) {
    return [
      'To list a reusable object or material with AI: go to AI Lab -> Resource & Food Scanner, select "Reusable Object / Material", upload a photo or describe the item, and click "Create Material Listing" to open a prefilled draft with ₹ INR pricing.',
    ].join('\n\n');
  }
  return [
    'I can help you: (1) verify and publish Material, Food Donation, or Used Oil listings with Verdora AI, (2) guide you to real active Food Rescue donations or reusable objects in ₹ INR, or (3) explain Food Rescue disclosures and Impact rules. Tell me whether you want to verify a new listing or find food or an object!',
  ].join('\n\n');
}

export type VerificationStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'HIGH_RISK';
export type VerificationCheckOutcome = 'pass' | 'warning' | 'fail';

export interface VerificationCheckItem {
  id: string;
  label: string;
  outcome: VerificationCheckOutcome;
  detail: string;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  location: string;
  reason: string;
  similarityScore: number;
}

export interface ListingVerificationInput {
  listingType: 'material' | 'food' | 'oil';
  title: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  condition?: string;
  location: string;
  indicativePrice?: number | null;
  portions?: number;
  preparedAt?: string | null;
  pickupDeadline?: string;
  storageInfo?: string;
  packagingInfo?: string;
  allergens?: string;
  oilType?: string;
  qualityGrade?: string;
  containerType?: string;
  filtrationStatus?: string;
  pickupWindow?: string;
  sellerName: string;
  sellerOrganization: string;
  sellerVerified: boolean;
  evidenceNotes: string;
  primaryImage: { base64Data: string; mimeType: string } | null;
  evidenceImage: { base64Data: string; mimeType: string } | null;
  duplicateMatches: DuplicateCandidate[];
  heuristicFlags: Array<{ severity: 'warning' | 'high'; code: string; message: string }>;
}

export interface ListingVerificationAssessment {
  mode: 'live-gemini' | 'rule-engine';
  status: VerificationStatus;
  riskScore: number;
  summary: string;
  reasons: string[];
  actionRequired: string | null;
  checks: VerificationCheckItem[];
  disclaimer: string;
}

const VERIFICATION_DISCLAIMER =
  'Verdora AI checks for common authenticity, duplicate, pricing, and quality indicators to protect the community, but AI review cannot guarantee that any listing is genuine. Always inspect items and confirm details directly before handover.';

function buildRuleBasedVerification(input: ListingVerificationInput): ListingVerificationAssessment {
  const highFlags = input.heuristicFlags.filter((f) => f.severity === 'high');
  const warningFlags = input.heuristicFlags.filter((f) => f.severity === 'warning');

  const duplicateCheck: VerificationCheckItem =
    input.duplicateMatches.length > 0
      ? {
          id: 'duplicates',
          label: 'Duplicate Listing Check',
          outcome: input.duplicateMatches.some((d) => d.similarityScore >= 85) ? 'fail' : 'warning',
          detail: `Found ${input.duplicateMatches.length} closely matching existing listing(s) (${input.duplicateMatches[0].reason}).`,
        }
      : {
          id: 'duplicates',
          label: 'Duplicate Listing Check',
          outcome: 'pass',
          detail: 'No duplicate active listings or reused listing photos were found.',
        };

  const imageFlag = input.heuristicFlags.find((f) => f.code === 'missing_image' || f.code === 'tiny_image');
  const imageCheck: VerificationCheckItem = imageFlag
    ? {
        id: 'image',
        label: 'Photo & Visual Evidence',
        outcome: imageFlag.severity === 'high' ? 'fail' : 'warning',
        detail: imageFlag.message,
      }
    : {
        id: 'image',
        label: 'Photo & Visual Evidence',
        outcome: 'pass',
        detail: 'Listing photograph provided and passed format and size verification.',
      };

  const priceFlag = input.heuristicFlags.find((f) => f.code === 'unrealistic_price');
  const priceCheck: VerificationCheckItem = priceFlag
    ? {
        id: 'pricing',
        label: 'Pricing & Quantity Consistency',
        outcome: priceFlag.severity === 'high' ? 'fail' : 'warning',
        detail: priceFlag.message,
      }
    : {
        id: 'pricing',
        label: 'Pricing & Quantity Consistency',
        outcome: 'pass',
        detail: 'Quantity and indicative value appear reasonable for circular reuse.',
      };

  const descFlag = input.heuristicFlags.find(
    (f) => f.code === 'misleading_text' || f.code === 'off_platform_payment' || f.code === 'thin_description'
  );
  const descCheck: VerificationCheckItem = descFlag
    ? {
        id: 'description',
        label: 'Description & Policy Screening',
        outcome: descFlag.severity === 'high' ? 'fail' : 'warning',
        detail: descFlag.message,
      }
    : {
        id: 'description',
        label: 'Description & Policy Screening',
        outcome: 'pass',
        detail: 'Description is specific, consistent with the selected category, and free of prohibited solicitation.',
      };

  const evidenceFlag = input.heuristicFlags.find((f) => f.code === 'needs_evidence' || f.code === 'missing_food_safety');
  const evidenceCheck: VerificationCheckItem = evidenceFlag
    ? {
        id: 'evidence',
        label: 'Source & Supporting Evidence',
        outcome: evidenceFlag.severity === 'high' ? 'fail' : 'warning',
        detail: evidenceFlag.message,
      }
    : {
        id: 'evidence',
        label: 'Source & Supporting Evidence',
        outcome: 'pass',
        detail: input.evidenceNotes || input.evidenceImage
          ? 'Supporting source details and evidence were provided.'
          : 'Seller profile and listing details are consistent for standard community pickup.',
      };

  const checks = [descCheck, duplicateCheck, imageCheck, priceCheck, evidenceCheck];
  const riskScore = Math.min(100, highFlags.length * 40 + warningFlags.length * 20);

  if (highFlags.length > 0) {
    return {
      mode: 'rule-engine',
      status: 'HIGH_RISK',
      riskScore: Math.max(70, riskScore),
      summary:
        'Publishing is blocked because significant risk or authenticity concerns were detected in this submission.',
      reasons: highFlags.map((f) => f.message).concat(warningFlags.map((f) => f.message)).slice(0, 6),
      actionRequired:
        'Please resolve the flagged issues above (such as removing duplicate posts, correcting unrealistic pricing, or clarifying misleading claims) and run verification again.',
      checks,
      disclaimer: VERIFICATION_DISCLAIMER,
    };
  }

  if (warningFlags.length > 0) {
    return {
      mode: 'rule-engine',
      status: 'NEEDS_REVIEW',
      riskScore: Math.max(35, Math.min(69, riskScore)),
      summary:
        'Some details in your listing need extra confirmation before it can go live on Verdora.',
      reasons: warningFlags.map((f) => f.message).slice(0, 6),
      actionRequired:
        'Add clearer product details or upload supporting evidence (such as a fresh item photo, batch note, or kitchen/workshop source confirmation), then re-verify or submit for human review.',
      checks,
      disclaimer: VERIFICATION_DISCLAIMER,
    };
  }

  return {
    mode: 'rule-engine',
    status: 'VERIFIED',
    riskScore: Math.min(20, riskScore),
    summary:
      'No significant suspicious indicators were detected. Your listing meets Verdora authenticity checks and is ready to publish.',
    reasons: [
      'Title, category, quantity, and description are consistent.',
      'No duplicate active listing was detected in the Verdora database.',
      'No unrealistic pricing or prohibited solicitation patterns were found.',
    ],
    actionRequired: null,
    checks,
    disclaimer: VERIFICATION_DISCLAIMER,
  };
}

export async function verifyListingWithAI(
  input: ListingVerificationInput
): Promise<ListingVerificationAssessment> {
  const baseline = buildRuleBasedVerification(input);
  const ai = getGeminiClient();
  if (!ai) {
    return baseline;
  }

  const structuredDetails = [
    `Listing Type: ${input.listingType.toUpperCase()}`,
    `Title: ${input.title}`,
    `Category: ${input.category}`,
    `Description: ${input.description}`,
    `Quantity: ${input.quantity} ${input.unit}`,
    input.condition ? `Condition: ${input.condition}` : '',
    `Location: ${input.location}`,
    input.listingType === 'material'
      ? `Indicative Price (INR): ${input.indicativePrice === null || input.indicativePrice === undefined ? 'Negotiable / On inquiry' : input.indicativePrice === 0 ? 'Free Pickup (₹0)' : `₹${input.indicativePrice}`}`
      : '',
    input.listingType === 'food'
      ? `Portions: ${input.portions ?? 'N/A'} | Prepared: ${input.preparedAt || 'Not stated'} | Pickup Deadline: ${input.pickupDeadline || 'Not stated'} | Storage: ${input.storageInfo || 'Not stated'} | Packaging: ${input.packagingInfo || 'Not stated'} | Allergens: ${input.allergens || 'Not stated'}`
      : '',
    input.listingType === 'oil'
      ? `Oil Type: ${input.oilType || ''} | Quality: ${input.qualityGrade || ''} | Container: ${input.containerType || ''} | Filtration: ${input.filtrationStatus || ''} | Pickup Window: ${input.pickupWindow || ''}`
      : '',
    `Seller/Source: ${input.sellerName}${input.sellerOrganization ? ` (${input.sellerOrganization})` : ''} | Verified Organization: ${input.sellerVerified ? 'Yes' : 'No'}`,
    `Supporting Evidence Notes: ${input.evidenceNotes || 'None provided'}`,
    `Primary Image Provided: ${input.primaryImage ? 'Yes (attached first)' : 'No'}`,
    `Supporting Evidence Image Provided: ${input.evidenceImage ? 'Yes (attached second)' : 'No'}`,
    input.duplicateMatches.length > 0
      ? `Database Duplicate Matches Detected: ${input.duplicateMatches.map((d) => `"${d.title}" in ${d.location} (${d.reason}, ${d.similarityScore}% match)`).join('; ')}`
      : 'Database Duplicate Matches Detected: None',
    input.heuristicFlags.length > 0
      ? `Pre-screening Signals: ${input.heuristicFlags.map((f) => `[${f.severity.toUpperCase()}] ${f.message}`).join('; ')}`
      : 'Pre-screening Signals: None',
  ]
    .filter(Boolean)
    .join('\n');

  const systemInstruction = [
    'You are the Verdora Listing Authenticity Reviewer for India (currency ₹ INR).',
    'Evaluate the proposed listing carefully for: misleading descriptions, duplicate listings, photo-to-text mismatch or suspicious images, inconsistent details, unrealistic INR pricing, missing supporting evidence for high-value/bulk claims, and policy violations (such as advance-payment demands or deceptive offers).',
    'Classify into exactly one status:',
    '- VERIFIED: Clear, consistent, realistic listing with no significant risk indicators.',
    '- NEEDS_REVIEW: Minor ambiguities, missing photo/supporting evidence for a high-value or sensitive batch, or moderate similarity that warrants human review or extra proof.',
    '- HIGH_RISK: Clear duplicate, photo strongly contradicts description, deceptive/unrealistic pricing or advance-payment solicitation, or major inconsistency.',
    'Write calm, respectful, plain-English explanations understandable to everyday users (no technical jargon or internal prompt references).',
    'Never claim a listing is guaranteed genuine — only state whether suspicious indicators were detected.',
  ].join('\n');

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  if (input.primaryImage) {
    parts.push({ inlineData: { mimeType: input.primaryImage.mimeType, data: input.primaryImage.base64Data } });
  }
  if (input.evidenceImage) {
    parts.push({ inlineData: { mimeType: input.evidenceImage.mimeType, data: input.evidenceImage.base64Data } });
  }
  parts.push({
    text: `Please evaluate this proposed Verdora listing and return the structured authenticity report:\n\n${structuredDetails}`,
  });

  try {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING, enum: ['VERIFIED', 'NEEDS_REVIEW', 'HIGH_RISK'] },
              riskScore: { type: Type.INTEGER },
              summary: { type: Type.STRING },
              reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
              actionRequired: { type: Type.STRING },
              checks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    label: { type: Type.STRING },
                    outcome: { type: Type.STRING, enum: ['pass', 'warning', 'fail'] },
                    detail: { type: Type.STRING },
                  },
                  required: ['id', 'label', 'outcome', 'detail'],
                },
              },
            },
            required: ['status', 'riskScore', 'summary', 'reasons', 'checks'],
          },
        },
      })
    );

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return baseline;
    }

    const parsed = JSON.parse(rawText) as {
      status: VerificationStatus;
      riskScore: number;
      summary: string;
      reasons: string[];
      actionRequired?: string;
      checks: VerificationCheckItem[];
    };

    // Never downgrade a hard server-side HIGH_RISK signal (e.g., exact duplicate or policy violation)
    let finalStatus: VerificationStatus = parsed.status;
    if (baseline.status === 'HIGH_RISK') {
      finalStatus = 'HIGH_RISK';
    } else if (baseline.status === 'NEEDS_REVIEW' && finalStatus === 'VERIFIED') {
      finalStatus = 'NEEDS_REVIEW';
    }

    const combinedReasons = Array.from(
      new Set([
        ...parsed.reasons.map((r) => String(r).trim()).filter(Boolean),
        ...(baseline.status !== 'VERIFIED' ? baseline.reasons : []),
      ])
    ).slice(0, 6);

    const safeChecks =
      Array.isArray(parsed.checks) && parsed.checks.length >= 3
        ? parsed.checks.slice(0, 6)
        : baseline.checks;

    return {
      mode: 'live-gemini',
      status: finalStatus,
      riskScore: Math.max(
        baseline.status === 'HIGH_RISK' ? 75 : baseline.status === 'NEEDS_REVIEW' ? 40 : 0,
        Math.min(100, Number(parsed.riskScore) || baseline.riskScore)
      ),
      summary:
        finalStatus === baseline.status || parsed.status === finalStatus
          ? parsed.summary
          : baseline.summary,
      reasons: combinedReasons.length > 0 ? combinedReasons : baseline.reasons,
      actionRequired:
        finalStatus === 'VERIFIED'
          ? null
          : parsed.actionRequired?.trim() || baseline.actionRequired,
      checks: safeChecks,
      disclaimer: VERIFICATION_DISCLAIMER,
    };
  } catch {
    return baseline;
  }
}
