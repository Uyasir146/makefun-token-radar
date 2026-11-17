// radar-2: the valuation model that turns one protocol snapshot into one ranked board.
//
// Live-token protocols supply market-cap-to-TVL ratios. A pre-token protocol borrows the narrowest
// pool that holds enough of them (its category, then its category family, then the whole market) as
// a peer multiple. TVL times that multiple is bent by damped momentum, a maturity curve and chain
// reach; four percentile components roll up into a launch score.
//
// Every watchlist slug is guaranteed a row. Rankable pre-token protocols under the watchlist floor
// can join as early rows. Protocols that already trade stay out of the ranking and are displayed at
// their market values instead.

/** One protocol as the sealed input carries it. */
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

/** The snapshot document the driver reads. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Version label quoted by the dashboard and the rules. */
export const MODEL_VERSION = 'radar-2';

/** Size of the early radar: pre-token protocols admitted below the watchlist floor, by TVL. */
export const EARLY_ROWS = 160;

/** Size of the Live token view, by market cap. */
export const LIVE_ROWS = 24;

/** Category to family map used when a category's own peer pool is too thin. */
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

/** Ratios below or above these bounds are treated as outliers and ignored. */
const RATIO_FLOOR = 0.02;
const RATIO_CEILING = 20;

/** A category or family needs at least this many ratios before it is trusted. */
const QUORUM = 5;

/** Milliseconds in one day. */
const DAY_MS = 86_400_000;

/** Categories whose protocols are products, never subjects. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Name prefixes that mark a protocol as an exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A protocol held out of the ranking, with the rule that removed it. */
export interface SetAsideProtocol {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** A ranked row as board.json writes it, radar-2 fields included. */
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

/** The slimmer row shape the dashboard consumes. */
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

/** A protocol that already trades: shown at market value, never ranked. */
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

/** The peer evidence behind one category's multiple. */
export interface CompEntry {
  category: string;
  /** Pool the stats came from: the category itself, its family, or the whole market. */
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

/** Everything the dashboard renders. */
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

/** Raised when a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Whole days from `listedAt` to `asOf`, never negative; null when either date is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  return Math.max(0, Math.floor((start - listed) / DAY_MS));
}

/** A trailing release marker means the entry is a pool run by another protocol. */
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Wrapped, staked or staking in a name marks a derivative product. */
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when the entry records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the entry may enter the ranking: pre-token, not CEX, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSION_MARKER.test(p.name);
}

/** True when the entry is a subject rather than a wrapped/bridged/staked/exchange product. */
export function isSubject(p: SnapshotProtocol): { subject: boolean; reason: string | null } {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    return { subject: false, reason: `${p.category} category` };
  }
  if (VERSION_MARKER.test(p.name)) return { subject: false, reason: 'version marker' };
  if (DERIVATIVE_WORD.test(p.name)) return { subject: false, reason: 'wrapped/staked product' };
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return { subject: false, reason: 'exchange product' };
  }
  return { subject: true, reason: null };
}

/** Numeric ascending order, the only comparator the model sorts with. */
const ascending = (a: number, b: number): number => a - b;

/** Middle value of an already-sorted list; the mean of the two middles when the length is even. */
function middleOfSorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Quartile and middle of an already-sorted list, indexed by floor, not interpolated. */
function spreadOfSorted(sorted: number[]): { p25: number; median: number; p75: number } {
  if (sorted.length === 0) return { p25: 0, median: 0, p75: 0 };
  return {
    p25: sorted[Math.floor(sorted.length * 0.25)]!,
    median: middleOfSorted(sorted),
    p75: sorted[Math.floor(sorted.length * 0.75)]!,
  };
}

/** Hyperbolic tangent, with hard stops far outside the useful range. */
function tanhCurve(x: number): number {
  if (x > 10) return 1;
  if (x < -10) return -1;
  const e2x = Math.exp(2 * x);
  return (e2x - 1) / (e2x + 1);
}

/** Logistic curve, 0 to 1. */
function logisticCurve(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Round to four decimals, the board's display precision. */
const fourPlaces = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Ratios kept for each pool, all sorted before use. */
interface PeerStats {
  perCategory: Map<string, number[]>;
  perFamily: Map<string, number[]>;
  all: number[];
  allMedian: number;
}

/** Collect market-cap-to-TVL ratios from every protocol that already trades. */
function gatherPeerStats(protocols: SnapshotProtocol[]): PeerStats {
  const perCategory = new Map<string, number[]>();
  const perFamily = new Map<string, number[]>();
  const all: number[] = [];

  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < RATIO_FLOOR || ratio > RATIO_CEILING) continue;

    all.push(ratio);

    if (p.category !== null) {
      const own = perCategory.get(p.category);
      if (own === undefined) perCategory.set(p.category, [ratio]);
      else own.push(ratio);

      const family = CATEGORY_FAMILIES[p.category] ?? p.category;
      const kin = perFamily.get(family);
      if (kin === undefined) perFamily.set(family, [ratio]);
      else kin.push(ratio);
    }
  }

  all.sort(ascending);
  for (const ratios of perCategory.values()) ratios.sort(ascending);
  for (const ratios of perFamily.values()) ratios.sort(ascending);

  return { perCategory, perFamily, all, allMedian: middleOfSorted(all) };
}

/** Pick the narrowest pool with a quorum, then read its multiple and spread. */
function peerMultipleFor(
  category: string | null,
  stats: PeerStats,
): { multiple: number; basis: 'category' | 'family' | 'global'; count: number; p25: number; p75: number } {
  if (category !== null) {
    const own = stats.perCategory.get(category);
    if (own !== undefined && own.length >= QUORUM) {
      const spread = spreadOfSorted(own);
      return { multiple: spread.median, basis: 'category', count: own.length, p25: spread.p25, p75: spread.p75 };
    }

    const family = CATEGORY_FAMILIES[category] ?? category;
    const kin = stats.perFamily.get(family);
    if (kin !== undefined && kin.length >= QUORUM) {
      const spread = spreadOfSorted(kin);
      return { multiple: spread.median, basis: 'family', count: kin.length, p25: spread.p25, p75: spread.p75 };
    }
  }

  const spread = spreadOfSorted(stats.all);
  return { multiple: stats.allMedian, basis: 'global', count: stats.all.length, p25: spread.p25, p75: spread.p75 };
}

/** The comps panel: one entry per board category, with a few real examples. */
function peerEvidence(boardCategories: string[], protocols: SnapshotProtocol[]): CompEntry[] {
  const stats = gatherPeerStats(protocols);
  const live = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ p, ratio: p.mcap_usd! / p.tvl_usd }))
    .filter((x) => x.ratio >= RATIO_FLOOR && x.ratio <= RATIO_CEILING)
    .sort((a, b) => a.ratio - b.ratio || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const familyOf = (c: string | null): string | null => (c === null ? null : (CATEGORY_FAMILIES[c] ?? c));

  const entries: CompEntry[] = [];
  for (const category of [...boardCategories].sort()) {
    const used = peerMultipleFor(category, stats);
    const pool =
      used.basis === 'category'
        ? live.filter((x) => x.p.category === category)
        : used.basis === 'family'
          ? live.filter((x) => familyOf(x.p.category) === familyOf(category))
          : live;
    const wanted = Math.min(6, pool.length);
    const examples = [];
    for (let i = 0; i < wanted; i++) {
      const x = pool[wanted === 1 ? 0 : Math.round((i * (pool.length - 1)) / (wanted - 1))]!;
      examples.push({ name: x.p.name, tvl_usd: Math.round(x.p.tvl_usd), mcap_usd: Math.round(x.p.mcap_usd!), multiple: fourPlaces(x.ratio) });
    }
    entries.push({
      category,
      basis: used.basis,
      count: used.count,
      median: fourPlaces(used.multiple),
      p25: fourPlaces(used.p25),
      p75: fourPlaces(used.p75),
      examples,
    });
  }
  return entries;
}

/** Momentum, compressed so a +400% week cannot quadruple a valuation. */
function dampedGrowth(change7d: number | null): { mult: number; pct: number; unknown: boolean } {
  if (change7d === null) return { mult: 1.0, pct: 0, unknown: true };
  const clampedPct = Math.min(120, Math.max(-60, change7d));
  return { mult: 1 + 0.35 * tanhCurve(clampedPct / 25), pct: clampedPct, unknown: false };
}

/** Age in days through a logistic curve: young protocols stay discounted. */
function maturityCurve(ageDays: number | null): number {
  const age = ageDays ?? 365;
  return 0.72 + 0.48 * logisticCurve((age - 540) / 210);
}

/** Each extra chain adds a little reach, capped at six extra chains. */
function chainFactor(chainCount: number): number {
  return 1 + 0.03 * Math.min(chainCount - 1, 6);
}

/** Share of a sorted list strictly below `value`, as 0-100. */
function rankPercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 50;
  let below = 0;
  for (const v of sortedValues) {
    if (v < value) below++;
  }
  return (below / sortedValues.length) * 100;
}

/** Share of the category's subjects that already have a token. */
function tokenPrecedent(category: string | null, protocols: SnapshotProtocol[]): number {
  if (category === null) return 0.5;
  const inCategory = protocols.filter((p) => p.category === category && isSubject(p).subject);
  if (inCategory.length === 0) return 0.5;
  const withToken = inCategory.filter((p) => !isPreToken(p)).length;
  return withToken / inCategory.length;
}

/** Launch likelihood, 0-100, from four weighted percentile components. */
function launchLikelihood(
  agePercentile: number,
  tvlPercentile: number,
  growthPercentile: number,
  precedent: number,
): number {
  const weighted = 0.35 * agePercentile + 0.30 * tvlPercentile + 0.20 * growthPercentile + 0.15 * (precedent * 100);
  return Math.round(Math.min(100, Math.max(0, weighted)));
}

/** Protocol lookup by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** TVL times a multiple through all the dampers, floored at one dollar. */
function projectedValue(tvl: number, multiple: number, growth: number, maturity: number, reach: number): number {
  return Math.max(1, Math.round(tvl * multiple * growth * maturity * reach));
}

/** Rank the snapshot: watchlist first, then every other rankable pre-token subject. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; setAside: SetAsideProtocol[] } {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  const setAside: SetAsideProtocol[] = [];

  // The watchlist is the floor; every listed slug is admitted.
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }

  // Everything else that is rankable: subjects join the board, the rest are set aside with a reason.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (!isRankable(p)) continue;

    const verdict = isSubject(p);
    if (verdict.subject) {
      chosen.set(p.slug, p);
    } else {
      setAside.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        reason: verdict.reason!,
      });
    }
  }

  const peers = gatherPeerStats(snapshot.protocols);

  // Percentile reference lists, built from the subject set only.
  const ages: number[] = [];
  const tvls: number[] = [];
  const growths: number[] = [];

  for (const p of chosen.values()) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
    tvls.push(p.tvl_usd);
    if (p.change_7d !== null) growths.push(p.change_7d);
  }

  ages.sort(ascending);
  tvls.sort(ascending);
  growths.sort(ascending);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const peer = peerMultipleFor(p.category, peers);
    const growth = dampedGrowth(p.change_7d);
    const maturity = maturityCurve(age);
    const reach = chainFactor(p.chains.length);

    const impliedBase = projectedValue(p.tvl_usd, peer.multiple, growth.mult, maturity, reach);
    const impliedLow = projectedValue(p.tvl_usd, peer.p25, growth.mult, maturity, reach);
    const impliedHigh = projectedValue(p.tvl_usd, peer.p75, growth.mult, maturity, reach);

    const agePct = rankPercentile(age ?? 365, ages);
    const tvlPct = rankPercentile(p.tvl_usd, tvls);
    const growthPct = rankPercentile(p.change_7d ?? 0, growths);
    const precedent = tokenPrecedent(p.category, snapshot.protocols);
    const score = launchLikelihood(agePct, tvlPct, growthPct, precedent);

    return { p, age, peer, growth, maturity, reach, impliedBase, impliedLow, impliedHigh, agePct, tvlPct, growthPct, precedent, score };
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
    peer_multiple: fourPlaces(s.peer.multiple),
    peer_basis: s.peer.basis,
    peer_count: s.peer.count,
    peer_p25: fourPlaces(s.peer.p25),
    peer_p75: fourPlaces(s.peer.p75),
    growth_mult: fourPlaces(s.growth.mult),
    growth_pct: s.growth.pct,
    growth_unknown: s.growth.unknown,
    maturity_mult: fourPlaces(s.maturity),
    chain_mult: fourPlaces(s.reach),
    launch_score: s.score,
    launch_age_percentile: Math.round(s.agePct),
    launch_tvl_percentile: Math.round(s.tvlPct),
    launch_growth_percentile: Math.round(s.growthPct),
    category_precedent: fourPlaces(s.precedent),
    model: {
      base_multiple: fourPlaces(s.peer.multiple),
      growth_pct: s.growth.pct,
      growth_multiplier: fourPlaces(s.growth.mult),
      maturity_multiplier: fourPlaces(s.maturity),
      age_days: s.age,
    },
    farm_steps: farmPlan({ p: s.p, age: s.age, impliedValue: s.impliedBase }),
  }));

  return { board, setAside };
}

/** TVL bands that size a farm budget. */
type SizeBand = '< $25M' | '$25-100M' | '$100-500M' | '> $500M';

/** Which band a protocol's TVL falls in. */
function sizeBand(tvl: number): SizeBand {
  if (tvl < 25_000_000) return '< $25M';
  if (tvl < 100_000_000) return '$25-100M';
  if (tvl < 500_000_000) return '$100-500M';
  return '> $500M';
}

/** Capital committed for a band. */
function seedCapital(band: SizeBand): number {
  if (band === '< $25M') return 100;
  if (band === '$25-100M') return 250;
  if (band === '$100-500M') return 500;
  return 1000;
}

/** How long a position is held, in weeks, given protocol age. */
function weeksFor(ageDays: number | null): number {
  if (ageDays === null) return 12;
  if (ageDays < 180) return 16;
  if (ageDays < 365) return 14;
  return 12;
}

/** The category's qualifying move, written for a given capital and protocol. */
function playbook(category: string | null, capital: number, protocolName: string): string {
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

/** Human phrase for the first few chains of a protocol. */
function chainPhrase(chains: string[]): string {
  if (chains.length === 0) return 'the main chain';
  if (chains.length === 1) return chains[0]!;
  if (chains.length === 2) return `${chains[0]} and ${chains[1]}`;
  return `${chains[0]}, ${chains[1]} and ${chains.length - 2} other chain${chains.length - 2 === 1 ? '' : 's'}`;
}

/** Build a farm plan for one row: 3 to 12 steps, each 20-600 characters, all derived from the row. */
export function farmPlan(ctx: { p: SnapshotProtocol; age: number | null; impliedValue: number }): string[] {
  const band = sizeBand(ctx.p.tvl_usd);
  const capital = seedCapital(band);
  const weeks = weeksFor(ctx.age);
  const chainNames = chainPhrase(ctx.p.chains.slice(0, 3));
  const action = playbook(ctx.p.category, capital, ctx.p.name);

  const steps: string[] = [];

  // Funding: one chain is a direct withdrawal, several are a bridge.
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

  steps.push(`${action} and ${Math.floor(weeks / 4) + 4} minutes per interaction.`);

  const weeklyGas = band === '< $25M' ? 0.3 : band === '$25-100M' ? 0.4 : band === '$100-500M' ? 0.5 : 0.7;
  steps.push(
    `Hold the position for ${weeks} weeks, making one qualifying action each week such as a deposit, a borrow, a swap or a vote; total gas over the period is approximately $${Math.round(weeklyGas * weeks * 100) / 100}.`,
  );

  steps.push(
    `Maintain strict sybil hygiene: use separate wallets for each protocol, vary deposit amounts by 15-30%, stagger transactions by at least 2 hours, and never reuse the same funding path twice.`,
  );

  // Expected value: capital's slice of TVL times a small assumed airdrop of the implied launch.
  const share = capital / ctx.p.tvl_usd;
  const dropShare = 0.005;
  const dropPot = ctx.impliedValue * dropShare;
  const expected = share * dropPot;

  const shareStr = share >= 0.0001
    ? (share * 100).toPrecision(2) + '%'
    : (share * 100).toPrecision(1) + '%';

  const expectedRounded = expected >= 1 ? Math.round(expected) : Math.round(expected * 100) / 100;
  steps.push(
    `At this TVL your share of the pool is roughly ${shareStr} per $${capital}, and a ${(dropShare * 100).toFixed(1)}% airdrop of a $${(ctx.impliedValue / 1e6).toFixed(1)}M launch would be worth about $${expectedRounded} to you; this value is the entry's claim, never a promise.`,
  );

  // Cost side, with the honest verdict when expected value does not clear it.
  const totalGas = weeklyGas * weeks + (ctx.p.chains.length > 1 ? 1 : 0.5);
  const tied = capital;
  const totalCost = totalGas + tied * 0.02;
  const costRounded = Math.round(totalCost * 100) / 100;

  if (expected < totalCost) {
    steps.push(
      `Total cost: $${Math.round(totalGas * 100) / 100} in gas plus $${tied} tied up for ${weeks} weeks. The expected value, about $${expectedRounded}, is below the ~$${costRounded} of gas and opportunity cost: farm this one for the record, not for the yield.`,
    );
  } else {
    const returnMultiple = (expected / totalCost).toFixed(1);
    steps.push(
      `Total cost: $${Math.round(totalGas * 100) / 100} in gas plus $${tied} tied up for ${weeks} weeks. Expected value $${expectedRounded} versus cost $${costRounded} (gas + 2% opportunity cost) gives a ${returnMultiple}x return if the launch happens.`,
    );
  }

  // Optional category or reach note.
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

  // Optional note for a long-running protocol without a token.
  if (ctx.age !== null && ctx.age > 500) {
    steps.push(
      `This protocol has run for ${Math.floor(ctx.age / 30)} months with no token: a launch is likelier than average. Monitor its official channels weekly and watch for points dashboard launches, which typically precede a token by 8-16 weeks.`,
    );
  }

  // Keep the step count inside the gate's 3-12 window.
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

/** Live-token protocols by market cap, for the dashboard's Live token view. */
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

/** Expand a board row into the dashboard's full row shape. */
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

/** The whole dashboard payload, built from the snapshot. */
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
    comps: peerEvidence(
      [...new Set(board.map((r) => r.category).filter((c): c is string => c !== null))],
      snapshot.protocols,
    ),
  };
  return { board, radar };
}

/** Read one protocol entry, refusing anything the model could not score. */
function readProtocol(value: unknown, index: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
  }
  const p = value as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
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
}

/** Parse a snapshot's text, refusing anything that is not the shape the model scores. */
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
  const protocols = o.protocols.map((v, i) => readProtocol(v, i));
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Null when the board passes the gate, else the first rule it breaks. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort(ascending);
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

/** The dashboard's whole dataset as one offline script. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
