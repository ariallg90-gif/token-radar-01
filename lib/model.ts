// Radar core for token-radar-01.
//
// A frozen DefiLlama snapshot goes in, a ranked board of launch candidates
// comes out. The scoring below reads only the snapshot's own numbers — TVL,
// its seven-day move, how long the protocol has been tracked, how many chains
// it runs on, and whether it already records a token. No protocol is named
// anywhere in this file, so the same code ranks a snapshot taken next year.
//
// The value model ("triple lens"):
//   size     — the protocol's TVL, in dollars, is the base of the claim.
//   momentum — the seven-day TVL change, clamped, lifts or trims the base.
//   seasoning— days on DefiLlama's books, capped, rewards staying power.
//   reach    — each extra chain adds a little; a one-chain protocol is fine,
//              a ten-chain one is harder to ignore.
//   token    — a protocol that is not a launch candidate (it already records
//              a token, or it is an exchange, a bridge, a wrapped or staked
//              product, or a version-marked copy) has its implied value cut
//              to a sliver, so it sinks below the pre-token field while
//              staying on the board.
//
// The board holds every watchlist protocol plus the strongest 200 others,
// 240 rows in all, sorted by implied value, ranks 1..N, values forced
// strictly decreasing so the order is a real ranking.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapFile {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export interface ValueParts {
  size: number;
  momentum: number;
  seasoning: number;
  reach: number;
  token: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  has_token: boolean;
  on_watchlist: boolean;
  value_parts: ValueParts;
  thesis: string;
}

const BOARD_TARGET = 240;
const OTHER_TARGET = 200;
const LIVE_TOKEN_CUT = 0.0005;
const DAY_MS = 86_400_000;

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Whole days between two YYYY-MM-DD dates, both read as UTC. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

/** FNV-1a, 32-bit: picks template variants deterministically per slug. */
function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hasToken(p: SnapProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

// The watchlist's own rule, as a factor: a protocol is a launch candidate
// only when it records no token and is not a wrapped, staked or bridged
// product of a token that already trades, nor an exchange, a bridge, or a
// version-marked copy. Anything else is a live asset or a non-launch, so its
// implied value is cut to a sliver and it sinks below the real candidates.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function candidateReason(p: SnapProtocol): string | null {
  if (hasToken(p)) return 'it already records a token';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return `its category is ${p.category}`;
  }
  if (VERSION_MARKER.test(p.name)) return 'its name carries a version marker';
  if (WRAPPED_WORD.test(p.name)) return 'its name marks a wrapped or staked product';
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return 'its name begins with an exchange’s name';
  }
  return null;
}

function isLaunchCandidate(p: SnapProtocol): boolean {
  return candidateReason(p) === null;
}

function ageOf(p: SnapProtocol, asOf: string): number | null {
  return p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
}

/** The five lenses, each a plain factor, and the implied value they give. */
function valueLenses(p: SnapProtocol, asOf: string): { parts: ValueParts; implied: number } {
  const age = ageOf(p, asOf);
  const seasonedDays = age === null ? 120 : age;
  const momentum =
    p.change_7d === null ? 1 : 1 + clampNum(p.change_7d, -30, 80) / 100;
  const parts: ValueParts = {
    size: p.tvl_usd,
    momentum: Math.round(momentum * 1000) / 1000,
    seasoning: Math.round((1 + Math.min(seasonedDays, 1460) / 2920) * 1000) / 1000,
    reach: Math.round((1 + 0.07 * Math.min(p.chains.length, 10)) * 1000) / 1000,
    token: isLaunchCandidate(p) ? 1 : LIVE_TOKEN_CUT,
  };
  const implied = Math.max(
    1,
    Math.round(
      parts.size * parts.momentum * parts.seasoning * parts.reach * parts.token,
    ),
  );
  return { parts, implied };
}

function moneyShort(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd}`;
}

function changeWords(change: number | null): string {
  if (change === null) return 'with no seven-day move reported';
  const sign = change >= 0 ? 'up' : 'down';
  return `${sign} ${Math.abs(change).toFixed(1)}% over seven days`;
}

function ageWords(age: number | null): string {
  if (age === null) return 'an unreported track record';
  if (age < 90) return `only ${age} days on the books`;
  if (age < 365) return `${age} days on the books`;
  const years = (age / 365).toFixed(1);
  return `${years} years on the books`;
}

/** One plain sentence saying why this row sits where it sits. */
function thesisFor(p: SnapProtocol, implied: number, asOf: string): string {
  const reason = candidateReason(p);
  const tokenBit =
    reason === null
      ? 'It records no token yet, so it stays a launch candidate.'
      : `It is not a launch candidate — ${reason} — so its implied value is cut accordingly.`;
  const chainBit =
    p.chains.length === 0
      ? 'with no chain reported'
      : p.chains.length === 1
        ? `on ${p.chains[0]}`
        : `across ${p.chains.length} chains, led by ${p.chains[0]}`;
  return (
    `${p.name} holds ${moneyShort(p.tvl_usd)} of TVL ${chainBit}, ` +
    `${changeWords(p.change_7d)}, with ${ageWords(ageOf(p, asOf))}. ` +
    `${tokenBit} The lenses put its implied value near ${moneyShort(implied)}.`
  );
}

// ---------------------------------------------------------------------------
// Farm plans. Six steps per row, concrete, with costs and time in them. The
// wording is templated from the row's own facts (name, first chain, category,
// token status) and a per-slug variant pick, so two rows never read alike.
// ---------------------------------------------------------------------------

const SETUP_VARIANTS = [
  'Make a fresh wallet for {name} alone and fund it with about $25 of {chain} gas money; keep the seed offline and never reuse a wallet that holds long-term funds.',
  'Open a new wallet you use only for {name}, put roughly $25 of {chain} gas in it, and write the seed on paper; do not mix this wallet with your savings.',
  'Create a dedicated {name} wallet, load it with about $25 for gas on {chain}, and keep it separate from every wallet that holds funds you cannot lose.',
];

const FIRST_ACTION_PRE = [
  'Connect the wallet to the {name} app on {chain} and finish the first on-chain action it offers, such as a swap or a deposit of $10 to $50.',
  'Connect to {name} on {chain}, then do one real action with $10 to $50 — a swap, a deposit, or a stake — and save the transaction receipt.',
];

const FIRST_ACTION_LIVE = [
  'Connect your wallet to the {name} app on {chain} and read the current rates and fees before you deposit anything.',
  'Open {name} on {chain}, connect your wallet, and compare the live rates with one other protocol in the same category before moving funds.',
];

const CADENCE_PRE = [
  'Repeat one small action every week for at least four weeks so the activity reads as a real user, budgeting about $1 to $3 of gas per visit.',
  'Come back once a week for a month and do one more small action each time; a steady rhythm beats a single burst, and gas should stay near $1 to $3 a visit.',
];

const CADENCE_LIVE = [
  'Add or adjust the position once a week for a month, keeping each move small so gas stays under a few dollars per visit.',
  'Check the position weekly for a month and rebalance only when the move is worth more than the gas it costs, usually a few dollars.',
];

const WATCH_PRE = [
  'Check the {name} announcements once a week for quests, testnets or snapshot dates, and finish each quest once with the farming wallet only.',
  'Watch {name} for quests or a points program, join with the same wallet, and record your points balance each week; never buy points from anyone.',
];

const REVIEW_LIVE = [
  'Review the position once a month, harvest any rewards, and re-check the protocol’s TVL trend before adding more.',
  'Once a month, harvest rewards, compare the yield with the same category elsewhere, and move only if the gain beats the gas and bridge cost.',
];

const CLAIM_PRE = [
  'If a token is announced, claim through the app’s own claim page, verify the contract address twice, and never sign a transaction you cannot read.',
  'When a claim opens, use only the claim page the protocol itself links, double-check the contract address, and ignore links sent by strangers.',
];

const EXIT_LIVE = [
  'Decide in advance what you do if the token falls 20 percent from your entry — sell, hold or add — and write that rule down before you deposit.',
  'Set a stop rule before you deposit: the price at which you sell, and the size you never exceed, so a bad week cannot become a bad year.',
];

const CATEGORY_ACTION: Record<string, string[]> = {
  Dexs: [
    'Provide liquidity on {name} in a {chain} pool with $20 to $50 for at least two weeks, and keep the receipt tokens in the farming wallet.',
    'Swap $20 to $50 through {name} on {chain} once a week, using a different pair each time, and note the fee on every trade.',
  ],
  Lending: [
    'Lend $20 to $50 of a stable asset on {name} for two weeks, then borrow a small amount against it and repay it, so both sides of the market are used.',
    'Deposit $20 to $50 as collateral on {name}, borrow a few dollars against it, repay within a week, and record the interest you paid.',
  ],
  Yield: [
    'Deposit $20 to $50 into the {name} vault on {chain} and leave it compounding for a month; note the entry and exit fees first.',
    'Put $20 to $50 in a {name} vault on {chain}, check the yield weekly, and withdraw once to learn the exit cost before adding more.',
  ],
  RWA: [
    'Complete the {name} onboarding checks with the farming wallet, then hold a small position for a month and record every fee you pay.',
    'Finish onboarding for {name}, place a $20 to $50 position, and keep the paperwork and fee receipts in one folder.',
  ],
  Restaking: [
    'Restake a small amount through {name} on {chain}, then check the restaking rewards weekly and record the operator you chose.',
    'Restake $20 to $50 through {name} on {chain}, note the operator and the lock-up, and claim rewards once a month.',
  ],
  Bridge: [
    'Bridge $10 to $20 through {name} between {chain} and a second chain it supports, once a week, and keep the receipts.',
    'Move $10 to $20 across {name} from {chain} to another supported chain each week, and compare the fee with a direct bridge.',
  ],
  'Liquid Staking': [
    'Stake $20 to $50 through {name} on {chain}, hold the liquid token it returns, and use it once in a pool or vault before the month ends.',
    'Stake a small amount with {name} on {chain}, track the staking yield weekly, and test unstaking with a tiny amount first.',
  ],
  'Liquid Restaking': [
    'Restake $20 to $50 through {name} on {chain}, then track the restaking yield and the lock-up terms for a full month.',
    'Deposit $20 to $50 with {name} on {chain}, record the restaking points if any, and check the withdrawal window before adding more.',
  ],
};

const CATEGORY_FALLBACK = [
  'Use the core {name} feature on {chain} with $20 to $50 once a week for a month, and keep a note of each transaction’s cost.',
  'Try the main {name} action on {chain} with $20 to $50, repeat it weekly for a month, and write down what each visit cost in gas.',
];

function fill(template: string, p: SnapProtocol): string {
  return template
    .replaceAll('{name}', p.name)
    .replaceAll('{chain}', p.chains[0] ?? 'Ethereum');
}

function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length]!;
}

/** Six concrete steps for one row, all between 20 and 600 characters. */
function planFor(p: SnapProtocol, seed: number): string[] {
  const token = hasToken(p);
  const categoryPool =
    p.category !== null && CATEGORY_ACTION[p.category] !== undefined
      ? CATEGORY_ACTION[p.category]!
      : CATEGORY_FALLBACK;
  return [
    fill(pick(SETUP_VARIANTS, seed), p),
    fill(pick(token ? FIRST_ACTION_LIVE : FIRST_ACTION_PRE, seed + 1), p),
    fill(pick(categoryPool, seed + 2), p),
    fill(pick(token ? CADENCE_LIVE : CADENCE_PRE, seed + 3), p),
    fill(pick(token ? REVIEW_LIVE : WATCH_PRE, seed + 4), p),
    fill(pick(token ? EXIT_LIVE : CLAIM_PRE, seed + 5), p),
  ];
}

// ---------------------------------------------------------------------------
// Snapshot parsing, board building, data script, validation.
// ---------------------------------------------------------------------------

export function parseSnapshot(text: string): SnapFile {
  const raw = JSON.parse(text) as SnapFile;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot has no protocols or watchlist arrays');
  }
  return raw;
}

/** Score every protocol, keep the watchlist whole plus the best 200 others. */
export function scoreBoard(snap: SnapFile): BoardRow[] {
  const wanted = new Set(snap.watchlist);
  const scored = snap.protocols.map((p) => {
    const { parts, implied } = valueLenses(p, snap.as_of);
    return { p, parts, implied };
  });
  const byValue = [...scored].sort(
    (a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1),
  );
  const kept = new Map<string, (typeof scored)[number]>();
  for (const entry of scored) {
    if (wanted.has(entry.p.slug)) kept.set(entry.p.slug, entry);
  }
  for (const entry of byValue) {
    if (kept.size >= wanted.size + OTHER_TARGET) break;
    kept.set(entry.p.slug, entry);
  }
  const ordered = [...kept.values()].sort(
    (a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1),
  );
  // Force strictly decreasing values so the ranking is unambiguous.
  let ceiling = Number.POSITIVE_INFINITY;
  const rows: BoardRow[] = ordered.map((entry, index) => {
    const value = Math.min(entry.implied, ceiling - 1);
    ceiling = value;
    const p = entry.p;
    return {
      slug: p.slug,
      name: p.name,
      rank: index + 1,
      implied_value_usd: Math.max(1, value),
      farm_steps: planFor(p, slugHash(p.slug)),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageOf(p, snap.as_of),
      has_token: hasToken(p),
      on_watchlist: wanted.has(p.slug),
      value_parts: entry.parts,
      thesis: thesisFor(p, entry.implied, snap.as_of),
    };
  });
  return rows;
}

/** The dashboard's data file: one global, everything the page renders. */
export function boardToDataScript(rows: BoardRow[], snap: SnapFile): string {
  const payload = {
    asOf: snap.as_of,
    floorUsd: snap.floor_usd,
    rows,
    watchlistCount: snap.watchlist.length,
  };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}

/** The gate's shape, checked before anything is written. Null means fine. */
export function validateBoard(rows: BoardRow[], snap: SnapFile): string | null {
  if (rows.length < 100 || rows.length > 4000) {
    return `board holds ${rows.length} rows, outside 100 to 4000`;
  }
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.implied_value_usd > previous) {
      return `row ${r.rank} outranks row ${r.rank - 1}`;
    }
    previous = r.implied_value_usd;
    if (
      !Number.isSafeInteger(r.implied_value_usd) ||
      r.implied_value_usd <= 0 ||
      r.implied_value_usd > 100_000_000_000_000
    ) {
      return `row ${r.rank} has an impossible implied value`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.rank} has ${r.farm_steps.length} farm steps`;
    }
    for (const step of r.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${r.rank} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  for (const slug of snap.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}
