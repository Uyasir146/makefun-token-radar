// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// radar-2: peer-multiple model that calibrates itself from the snapshot's own live-token protocols.
// Every pre-token protocol gets a peer multiple from its category, category family or the global median,
// damped growth, maturity sigmoid, chain reach, and a launch score from four derived components.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Category families for peer-multiple fallback. */
export const CATEGORY_FAMILIES: Record<string, string> = {
  'Lending': 'lending',
  'CDP': 'lending',
  'Uncollateralized Lending': 'lending',
  'Dexs': 'trading',
  'DEX Aggregator': 'trading',
  'Perps': 'trading',
  'Derivatives': 'trading',
  'Yield': 'yield',
  'Yield Aggregator': 'yield',
  'Onchain Capital Allocator': 'yield',
  'Risk Curators': 'yield',
  'RWA': 'rwa',
  'Basis Trading': 'rwa',
  'Treasury': 'rwa',
  'Bridge': 'bridge',
  'Cross Chain Bridge': 'bridge',
  'Canonical Bridge': 'bridge',
  'Liquid Staking': 'staking',
  'Liquid Restaking': 'staking',
  'Restaked BTC': 'staking',
  'Staking Pool': 'staking',
};

/** Peer-multiple ratio bounds: ratios outside [0.02, 20] are outliers. */
const PEER_RATIO_MIN = 0.02;
const PEER_RATIO_MAX = 20;

/** Minimum peer count for category or family to use its own median. */
const MIN_PEER_COUNT = 5;

const DAY_MS = 86_400_000;

/** Categories that exclude protocols as subjects (wrapped/bridged/CEX products). */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange prefixes that exclude protocols as subjects. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Protocols set aside (not subjects): wrapped/bridged/staked/CEX products. */
export interface SetAsideProtocol {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** One row of board.json: the ranked board's row with radar-2 fields. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  peer_multiple: number;
  peer_basis: 'category' | 'family' | 'global';
  peer_count: number;
  peer_p25: number;
  peer_p75: number;
  growth_mult: number;
  growth_pct: number;
  growth_unknown: boolean;
  maturity_mult: number;
  chain_mult: number;
  launch_score: number;
  launch_age_percentile: number;
  launch_tvl_percentile: number;
  launch_growth_percentile: number;
  category_precedent: number;
  model: {
    peer_multiple: number;
    growth_mult: number;
    maturity_mult: number;
    chain_mult: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  on_watchlist: boolean;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  peer_multiple: number;
  peer_basis: 'category' | 'family' | 'global';
  peer_count: number;
  peer_p25: number;
  peer_p75: number;
  growth_mult: number;
  growth_pct: number;
  growth_unknown: boolean;
  maturity_mult: number;
  chain_mult: number;
  launch_score: number;
  launch_age_percentile: number;
  launch_tvl_percentile: number;
  launch_growth_percentile: number;
  category_precedent: number;
  model: {
    peer_multiple: number;
    peer_basis: 'category' | 'family' | 'global';
    peer_count: number;
    peer_p25: number;
    peer_p75: number;
    growth_mult: number;
    maturity_mult: number;
    chain_mult: number;
    base_multiple: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  on_watchlist: boolean;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Peer multiple evidence for one category. */
export interface CompEntry {
  category: string;
  /** Which pool the stats come from: the category's own comps, its family's, or all live comps. */
  basis: 'category' | 'family' | 'global';
  count: number;
  median: number;
  p25: number;
  p75: number;
  examples: Array<{
    name: string;
    tvl_usd: number;
    mcap_usd: number;
    multiple: number;
  }>;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideProtocol[];
  comps: CompEntry[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Word boundary regex for wrapped/staked/staking detection. */
const WRAPPED_STAKED = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is a SUBJECT: passes the exclusion rule (not a wrapped/bridged/staked/CEX product). */
export function isSubject(p: SnapshotProtocol): { subject: boolean; reason: string | null } {
  // Excluded categories
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return { subject: false, reason: `${p.category} category` };
  }
  
  // Version marker
  if (VERSIONED.test(p.name)) {
    return { subject: false, reason: 'version marker' };
  }
  
  // Wrapped/staked/staking in name
  if (WRAPPED_STAKED.test(p.name)) {
    return { subject: false, reason: 'wrapped/staked product' };
  }
  
  // Exchange prefix
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) {
      return { subject: false, reason: 'exchange product' };
    }
  }
  
  return { subject: true, reason: null };
}

/** Median of a sorted array of numbers. */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** p25, median, p75 of a sorted array. */
function percentiles(sorted: number[]): { p25: number; median: number; p75: number } {
  if (sorted.length === 0) return { p25: 0, median: 0, p75: 0 };
  const p25Idx = Math.floor(sorted.length * 0.25);
  const p75Idx = Math.floor(sorted.length * 0.75);
  return {
    p25: sorted[p25Idx]!,
    median: median(sorted),
    p75: sorted[p75Idx]!,
  };
}

/** tanh approximation. */
function tanh(x: number): number {
  if (x > 10) return 1;
  if (x < -10) return -1;
  const e2x = Math.exp(2 * x);
  return (e2x - 1) / (e2x + 1);
}

/** sigmoid function. */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Peer multiples: category -> ratios, family -> ratios, global ratios. */
interface PeerMultiples {
  byCategory: Map<string, number[]>;
  byFamily: Map<string, number[]>;
  global: number[];
  globalMedian: number;
}

/** Compute peer multiples from all live-token protocols. */
function computePeerMultiples(protocols: SnapshotProtocol[]): PeerMultiples {
  const byCategory = new Map<string, number[]>();
  const byFamily = new Map<string, number[]>();
  const global: number[] = [];

  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < PEER_RATIO_MIN || ratio > PEER_RATIO_MAX) continue;

    global.push(ratio);

    if (p.category !== null) {
      if (!byCategory.has(p.category)) byCategory.set(p.category, []);
      byCategory.get(p.category)!.push(ratio);

      const family = CATEGORY_FAMILIES[p.category] ?? p.category;
      if (!byFamily.has(family)) byFamily.set(family, []);
      byFamily.get(family)!.push(ratio);
    }
  }

  global.sort((a, b) => a - b);
  for (const ratios of byCategory.values()) ratios.sort((a, b) => a - b);
  for (const ratios of byFamily.values()) ratios.sort((a, b) => a - b);

  const globalMedian = median(global);
  return { byCategory, byFamily, global, globalMedian };
}

/** Get peer multiple for a pre-token protocol. */
function getPeerMultiple(
  category: string | null,
  peerData: PeerMultiples,
): { multiple: number; basis: 'category' | 'family' | 'global'; count: number; p25: number; p75: number } {
  if (category !== null) {
    const catRatios = peerData.byCategory.get(category);
    if (catRatios !== undefined && catRatios.length >= MIN_PEER_COUNT) {
      const stats = percentiles(catRatios);
      return { multiple: stats.median, basis: 'category', count: catRatios.length, p25: stats.p25, p75: stats.p75 };
    }

    const family = CATEGORY_FAMILIES[category] ?? category;
    const famRatios = peerData.byFamily.get(family);
    if (famRatios !== undefined && famRatios.length >= MIN_PEER_COUNT) {
      const stats = percentiles(famRatios);
      return { multiple: stats.median, basis: 'family', count: famRatios.length, p25: stats.p25, p75: stats.p75 };
    }
  }

  const stats = percentiles(peerData.global);
  return { multiple: peerData.globalMedian, basis: 'global', count: peerData.global.length, p25: stats.p25, p75: stats.p75 };
}

/** Build comps entries for all categories that appear on the board. */
function buildComps(boardCategories: string[], protocols: SnapshotProtocol[]): CompEntry[] {
  const peerData = computePeerMultiples(protocols);
  // The live comps the model could use: the same validity test as computePeerMultiples.
  const live = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ p, ratio: p.mcap_usd! / p.tvl_usd }))
    .filter((x) => x.ratio >= PEER_RATIO_MIN && x.ratio <= PEER_RATIO_MAX)
    .sort((a, b) => a.ratio - b.ratio || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const familyOf = (c: string | null): string | null => (c === null ? null : (CATEGORY_FAMILIES[c] ?? c));

  const comps: CompEntry[] = [];
  for (const category of [...boardCategories].sort()) {
    // The stats are exactly the ones getPeerMultiple hands every row of this category.
    const used = getPeerMultiple(category, peerData);
    const pool =
      used.basis === 'category'
        ? live.filter((x) => x.p.category === category)
        : used.basis === 'family'
          ? live.filter((x) => familyOf(x.p.category) === familyOf(category))
          : live;
    // Up to 6 examples spread evenly across the sorted multiples, low to high.
    const n = Math.min(6, pool.length);
    const examples = [];
    for (let i = 0; i < n; i++) {
      const x = pool[n === 1 ? 0 : Math.round((i * (pool.length - 1)) / (n - 1))]!;
      examples.push({ name: x.p.name, tvl_usd: Math.round(x.p.tvl_usd), mcap_usd: Math.round(x.p.mcap_usd!), multiple: round4(x.ratio) });
    }
    comps.push({
      category,
      basis: used.basis,
      count: used.count,
      median: round4(used.multiple),
      p25: round4(used.p25),
      p75: round4(used.p75),
      examples,
    });
  }
  return comps;
}

/** Growth multiplier: damped so +400% week cannot 4x value. */
function growthMultiplier(change7d: number | null): { mult: number; pct: number; unknown: boolean } {
  if (change7d === null) return { mult: 1.0, pct: 0, unknown: true };
  const clampedPct = Math.min(120, Math.max(-60, change7d));
  const mult = 1 + 0.35 * tanh(clampedPct / 25);
  return { mult, pct: clampedPct, unknown: false };
}

/** Maturity multiplier: sigmoid based on age in days. */
function maturityMultiplier(ageDays: number | null): number {
  const age = ageDays ?? 365;
  return 0.72 + 0.48 * sigmoid((age - 540) / 210);
}

/** Chain reach multiplier. */
function chainMultiplier(chainCount: number): number {
  return 1 + 0.03 * Math.min(chainCount - 1, 6);
}

/** Convert value to percentile rank (0-100) within sorted array. */
function percentileRank(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 50;
  let count = 0;
  for (const v of sortedValues) {
    if (v < value) count++;
  }
  return (count / sortedValues.length) * 100;
}

/** Category precedent: share of category's SUBJECT protocols that have tokens. */
function categoryPrecedent(category: string | null, protocols: SnapshotProtocol[]): number {
  if (category === null) return 0.5;
  // Only consider protocols that pass the subject rule
  const inCategory = protocols.filter((p) => p.category === category && isSubject(p).subject);
  if (inCategory.length === 0) return 0.5;
  const withToken = inCategory.filter((p) => !isPreToken(p)).length;
  return withToken / inCategory.length;
}

/** Launch likelihood score (0-100) from four components. */
function launchScore(
  agePercentile: number,
  tvlPercentile: number,
  growthPercentile: number,
  precedent: number,
): number {
  const weighted = 0.35 * agePercentile + 0.30 * tvlPercentile + 0.20 * growthPercentile + 0.15 * (precedent * 100);
  return Math.round(Math.min(100, Math.max(0, weighted)));
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; setAside: SetAsideProtocol[] } {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  const setAside: SetAsideProtocol[] = [];
  
  // The watchlist is the floor: every slug must appear (they pass the rule by construction).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  
  // All rankable pre-token protocols that pass the subject rule.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue; // Watchlist already added
    if (!isRankable(p)) continue;
    
    const subjectCheck = isSubject(p);
    if (subjectCheck.subject) {
      chosen.set(p.slug, p);
    } else {
      // Set aside with reason
      setAside.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        reason: subjectCheck.reason!,
      });
    }
  }

  // Compute peer multiples from all live-token protocols.
  const peerData = computePeerMultiples(snapshot.protocols);

  // Collect all ages, TVLs, growths for percentile calculations over SUBJECT set only.
  const allAges: number[] = [];
  const allTvls: number[] = [];
  const allGrowths: number[] = [];

  for (const p of chosen.values()) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) allAges.push(age);
    allTvls.push(p.tvl_usd);
    if (p.change_7d !== null) allGrowths.push(p.change_7d);
  }

  allAges.sort((a, b) => a - b);
  allTvls.sort((a, b) => a - b);
  allGrowths.sort((a, b) => a - b);

  // Score each protocol.
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const peer = getPeerMultiple(p.category, peerData);
    const growth = growthMultiplier(p.change_7d);
    const maturity = maturityMultiplier(age);
    const chain = chainMultiplier(p.chains.length);
    
    const impliedBase = Math.max(1, Math.round(p.tvl_usd * peer.multiple * growth.mult * maturity * chain));
    const impliedLow = Math.max(1, Math.round(p.tvl_usd * peer.p25 * growth.mult * maturity * chain));
    const impliedHigh = Math.max(1, Math.round(p.tvl_usd * peer.p75 * growth.mult * maturity * chain));

    const agePerc = percentileRank(age ?? 365, allAges);
    const tvlPerc = percentileRank(p.tvl_usd, allTvls);
    const growthPerc = percentileRank(p.change_7d ?? 0, allGrowths);
    const precedent = categoryPrecedent(p.category, snapshot.protocols);
    const score = launchScore(agePerc, tvlPerc, growthPerc, precedent);

    return { p, age, peer, growth, maturity, chain, impliedBase, impliedLow, impliedHigh, agePerc, tvlPerc, growthPerc, precedent, score };
  });

  scored.sort((a, b) => b.impliedBase - a.impliedBase || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.impliedBase,
    implied_low_usd: s.impliedLow,
    implied_high_usd: s.impliedHigh,
    peer_multiple: round4(s.peer.multiple),
    peer_basis: s.peer.basis,
    peer_count: s.peer.count,
    peer_p25: round4(s.peer.p25),
    peer_p75: round4(s.peer.p75),
    growth_mult: round4(s.growth.mult),
    growth_pct: s.growth.pct,
    growth_unknown: s.growth.unknown,
    maturity_mult: round4(s.maturity),
    chain_mult: round4(s.chain),
    launch_score: s.score,
    launch_age_percentile: Math.round(s.agePerc),
    launch_tvl_percentile: Math.round(s.tvlPerc),
    launch_growth_percentile: Math.round(s.growthPerc),
    category_precedent: round4(s.precedent),
    model: {
      base_multiple: round4(s.peer.multiple),
      growth_pct: s.growth.pct,
      growth_multiplier: round4(s.growth.mult),
      maturity_multiplier: round4(s.maturity),
      age_days: s.age,
    },
    farm_steps: farmPlan({ p: s.p, age: s.age, impliedValue: s.impliedBase }),
  }));
  
  return { board, setAside };
}

/** TVL tier for budgeting farm plans. */
function tvlTier(tvl: number): '< $25M' | '$25-100M' | '$100-500M' | '> $500M' {
  if (tvl < 25_000_000) return '< $25M';
  if (tvl < 100_000_000) return '$25-100M';
  if (tvl < 500_000_000) return '$100-500M';
  return '> $500M';
}

/** Capital amount for a position, based on TVL tier. */
function capitalAmount(tier: '< $25M' | '$25-100M' | '$100-500M' | '> $500M'): number {
  if (tier === '< $25M') return 100;
  if (tier === '$25-100M') return 250;
  if (tier === '$100-500M') return 500;
  return 1000;
}

/** Points-per-dollar rough estimate based on TVL tier. */
function pointsPerDollar(tier: '< $25M' | '$25-100M' | '$100-500M' | '> $500M'): number {
  if (tier === '< $25M') return 0.002;
  if (tier === '$25-100M') return 0.0008;
  if (tier === '$100-500M') return 0.0003;
  return 0.0001;
}

/** Holding period in weeks based on age. */
function holdingWeeks(ageDays: number | null): number {
  if (ageDays === null) return 12;
  if (ageDays < 180) return 16;
  if (ageDays < 365) return 14;
  return 12;
}

/** Category-specific action description. */
function categoryAction(category: string | null, capital: number, protocolName: string): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) {
    return `Supply ${capital} USDC to ${protocolName} as collateral and borrow ${Math.floor(capital * 0.4)} USDC against it, keeping the health factor above 1.8; a weekly borrow-and-repay round costs about $0.35 of gas`;
  }
  if (c.includes('dex') || c.includes('perp') || c.includes('deriv')) {
    return `Provide ${capital} USDC of liquidity to ${protocolName}'s main pool, or if a perp DEX, deposit as margin and open a small hedge position; weekly rebalancing costs about $0.50 of gas`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('allocat')) {
    return `Deposit ${capital} USDC into ${protocolName}'s highest-TVL vault and keep the receipt tokens; weekly check-ins cost about $0.25 of gas`;
  }
  if (c.includes('bridge')) {
    return `Bridge ${capital} USDC through ${protocolName} to its primary destination chain and use the bridged funds in a partner protocol; weekly activity costs about $0.40 of gas`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake ${capital} worth of the chain's native asset through ${protocolName} and hold the liquid staking receipt; weekly restaking operations cost about $0.60 of gas`;
  }
  if (c.includes('rwa') || c.includes('treasury')) {
    return `Mint or deposit ${capital} USDC to acquire ${protocolName}'s yield-bearing RWA token and hold it; weekly claims cost about $0.30 of gas`;
  }
  if (c.includes('prediction') || c.includes('betting')) {
    return `Fund ${capital} USDC and place balanced positions across multiple markets on ${protocolName}; weekly trades cost about $0.45 of gas`;
  }
  return `Deposit ${capital} USDC into ${protocolName} and maintain an active position; weekly qualifying actions cost about $0.40 of gas`;
}

/** Chain names for multi-chain bridging step. */
function chainList(chains: string[]): string {
  if (chains.length === 0) return 'the main chain';
  if (chains.length === 1) return chains[0]!;
  if (chains.length === 2) return `${chains[0]} and ${chains[1]}`;
  return `${chains[0]}, ${chains[1]} and ${chains.length - 2} other chain${chains.length - 2 === 1 ? '' : 's'}`;
}

/** Generate farm plan: 3-12 steps, each 20-600 chars, derived from row data. */
export function farmPlan(ctx: { p: SnapshotProtocol; age: number | null; impliedValue: number }): string[] {
  const tier = tvlTier(ctx.p.tvl_usd);
  const capital = capitalAmount(tier);
  const weeks = holdingWeeks(ctx.age);
  const ppd = pointsPerDollar(tier);
  const chainNames = chainList(ctx.p.chains.slice(0, 3));
  const action = categoryAction(ctx.p.category, capital, ctx.p.name);

  const steps: string[] = [];

  // Step 1: Funding and bridging
  if (ctx.p.chains.length > 1) {
    const bridgeFee = Math.max(1, Math.round(ctx.p.chains.length * 0.6 * 100) / 100);
    steps.push(
      `Bridge ${Math.floor(capital * 0.4)}-${Math.floor(capital * 0.6)} USDC to ${chainNames}, in separate wallets funded from a CEX withdrawal, never wallet-to-wallet: about $${bridgeFee} in bridge fees and ${4 + ctx.p.chains.length * 2} minutes.`,
    );
  } else {
    steps.push(
      `Fund a fresh wallet with ${capital} USDC via direct CEX withdrawal to ${chainNames}, keeping the wallet unlinked to other positions: about $0.50 of withdrawal fee and 6 minutes.`,
    );
  }

  // Step 2: Core action
  steps.push(`${action} and ${Math.floor(weeks / 4) + 4} minutes per interaction.`);

  // Step 3: Cadence
  const gasCostWeekly = tier === '< $25M' ? 0.3 : tier === '$25-100M' ? 0.4 : tier === '$100-500M' ? 0.5 : 0.7;
  steps.push(
    `Hold the position for ${weeks} weeks, making one qualifying action each week such as a deposit, a borrow, a swap or a vote; total gas over the period is approximately $${Math.round(gasCostWeekly * weeks * 100) / 100}.`,
  );

  // Step 4: Sybil hygiene
  steps.push(
    `Maintain strict sybil hygiene: use separate wallets for each protocol, vary deposit amounts by 15-30%, stagger transactions by at least 2 hours, and never reuse the same funding path twice.`,
  );

  // Step 5: Expected value - CORRECTED ARITHMETIC
  const yourShare = capital / ctx.p.tvl_usd; // fraction, not percentage
  const assumedAirdropShare = 0.005; // 0.5%
  const airdropPot = ctx.impliedValue * assumedAirdropShare;
  const expectedValue = yourShare * airdropPot;
  
  // Format share with readable precision (no wall of zeros)
  const shareStr = yourShare >= 0.0001 
    ? (yourShare * 100).toPrecision(2) + '%' 
    : (yourShare * 100).toPrecision(1) + '%';
  
  const evRounded = expectedValue >= 1 ? Math.round(expectedValue) : Math.round(expectedValue * 100) / 100;
  steps.push(
    `At this TVL your share of the pool is roughly ${shareStr} per $${capital}, and a ${(assumedAirdropShare * 100).toFixed(1)}% airdrop of a $${(ctx.impliedValue / 1e6).toFixed(1)}M launch would be worth about $${evRounded} to you; this value is the entry's claim, never a promise.`,
  );

  // Step 6: Cost/benefit - with honest assessment
  const totalGas = gasCostWeekly * weeks + (ctx.p.chains.length > 1 ? 1 : 0.5);
  const capitalTied = capital;
  const totalCost = totalGas + capitalTied * 0.02; // gas + 2% opportunity cost
  const costRounded = Math.round(totalCost * 100) / 100;
  
  if (expectedValue < totalCost) {
    steps.push(
      `Total cost: $${Math.round(totalGas * 100) / 100} in gas plus $${capitalTied} tied up for ${weeks} weeks. The expected value, about $${evRounded}, is below the ~$${costRounded} of gas and opportunity cost: farm this one for the record, not for the yield.`,
    );
  } else {
    const returnMultiple = (expectedValue / totalCost).toFixed(1);
    steps.push(
      `Total cost: $${Math.round(totalGas * 100) / 100} in gas plus $${capitalTied} tied up for ${weeks} weeks. Expected value $${evRounded} versus cost $${costRounded} (gas + 2% opportunity cost) gives a ${returnMultiple}x return if the launch happens.`,
    );
  }

  // Optional step 7: Category-specific note
  if (ctx.p.category && ['Lending', 'CDP', 'Uncollateralized Lending'].includes(ctx.p.category)) {
    steps.push(
      `For lending protocols, prioritize safe assets like USDC or USDT, avoid volatile collateral, and monitor health factors daily; liquidation risk is real and loses both capital and airdrop eligibility.`,
    );
  } else if (ctx.p.category && ['Dexs', 'DEX Aggregator'].includes(ctx.p.category)) {
    steps.push(
      `For DEXs, choose stable pairs like USDC/USDT to minimize impermanent loss, or if providing single-sided liquidity, monitor pool balance shifts and rebalance weekly to maintain your position's share.`,
    );
  } else if (ctx.p.chains.length >= 3) {
    steps.push(
      `Multi-chain protocols reward cross-chain activity: after establishing the main position, execute at least one bridging or cross-chain swap per month to maximize points across all ${ctx.p.chains.length} chains.`,
    );
  }

  // Optional step 8: Monitoring
  if (ctx.age !== null && ctx.age > 500) {
    steps.push(
      `This protocol has run for ${Math.floor(ctx.age / 30)} months with no token: a launch is likelier than average. Monitor its official channels weekly and watch for points dashboard launches, which typically precede a token by 8-16 weeks.`,
    );
  }

  // Ensure we have 3-12 steps
  while (steps.length < 3) {
    steps.push(
      `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; scam sites are common and never ask for a claim fee.`,
    );
  }
  if (steps.length > 12) {
    steps.splice(12);
  }

  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      on_watchlist: snapshot.watchlist.includes(p.slug),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's complete form for data.js (includes farm_steps and model). */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    on_watchlist: onWatchlist,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    peer_multiple: row.peer_multiple,
    peer_basis: row.peer_basis,
    peer_count: row.peer_count,
    peer_p25: row.peer_p25,
    peer_p75: row.peer_p75,
    growth_mult: row.growth_mult,
    growth_pct: row.growth_pct,
    growth_unknown: row.growth_unknown,
    maturity_mult: row.maturity_mult,
    chain_mult: row.chain_mult,
    launch_score: row.launch_score,
    launch_age_percentile: row.launch_age_percentile,
    launch_tvl_percentile: row.launch_tvl_percentile,
    launch_growth_percentile: row.launch_growth_percentile,
    category_precedent: row.category_precedent,
    model: {
      peer_multiple: row.peer_multiple,
      peer_basis: row.peer_basis,
      peer_count: row.peer_count,
      peer_p25: row.peer_p25,
      peer_p75: row.peer_p75,
      growth_mult: row.growth_mult,
      maturity_mult: row.maturity_mult,
      chain_mult: row.chain_mult,
      base_multiple: row.peer_multiple,
    },
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, setAside } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const onWatchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    rows: board.map((row) => radarRow(row, onWatchlist.has(row.slug))),
    live,
    set_aside: setAside,
    comps: buildComps(
      [...new Set(board.map((r) => r.category).filter((c): c is string => c !== null))],
      snapshot.protocols,
    ),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
