// token-radar-01 driver.
//
// One run takes the sealed snapshot, scores it with the model in lib/model.ts, and lays the result on
// disk in the shape the scorer reads: board.json (the ranked rows), data.js (the same radar as
// window.RADAR for the offline dashboard), <out>/dashboard/ and <out>/screenshots/ (copied byte for
// byte from this repository), and dossier.json (the cover sheet, from vendor/makefun-board.ts).
//
// The page it ships is deliberately dumb: three static files under dashboard/ that read ../data.js and
// touch nothing. Everything numeric lives in the snapshot, so a second run writes identical bytes.
//
// Usage from the repository root, with MAKEFUN_OUTPUT_DIR standing in for the sealed /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** Where this file sits, so dashboard/ and screenshots/ resolve next to it, not next to cwd. */
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps. text_max_bytes shapes the dossier text; the rest only refuse oversized inputs. */
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
} as const;

/** A screenshot file name the scorer will accept: 1 to 128 of [A-Za-z0-9._-], not starting with a dot. */
const LEGAL_IMAGE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** How many screenshots the hand-in owes: the board, a detail view and a filtered view. */
const SHOTS_REQUIRED = 3;

/**
 * The value of `--flag <value>` or `--flag=<value>` in argv, else `fallback`.
 * A trailing `--flag` with nothing after it counts as absent, so it never eats the next flag.
 */
function flag(argv: readonly string[], name: string, fallback: string): string {
  const spaced = argv.indexOf(`--${name}`);
  if (spaced >= 0 && spaced + 1 < argv.length) return argv[spaced + 1] as string;
  const joined = argv.find((token) => token.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Where the snapshot lives: a .json path, or a directory holding snapshot.json. */
function snapshotPath(given: string): string {
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

/** The out directory: --output, else MAKEFUN_OUTPUT_DIR, else the sealed /output. */
function outDir(argv: readonly string[]): string {
  return flag(argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/** A fatal message on stderr, then exit with a code the harness reads. */
function die(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Copy every plain file of `from` into `to` (one level, dot-names skipped); return the names copied. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const entry of readdirSync(from)) {
    if (entry.startsWith('.')) continue;
    const source = join(from, entry);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, entry));
    names.push(entry);
  }
  return names;
}

/** The input path back as given on the command line, for error messages a human can act on. */
const inputArg = flag(process.argv, 'input', '/input');
const inputPath = snapshotPath(inputArg);
if (!existsSync(inputPath)) {
  die(`no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outputDir = outDir(process.argv);

// --- score the snapshot ------------------------------------------------------

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const refused = boardIssue(board, snapshot);
if (refused !== null) die(`the model wrote a board the gate refuses: ${refused}`, 1);

// --- write the artefacts -----------------------------------------------------

mkdirSync(outputDir, { recursive: true });
const boardFile = join(outputDir, 'board.json');
const dataFile = join(outputDir, 'data.js');
writeFileSync(boardFile, `${JSON.stringify({ rows: board })}\n`);
writeFileSync(dataFile, dataScript(radar));

copyTree(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
const shots = copyTree(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));

if (shots.length < SHOTS_REQUIRED) {
  die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in ${SHOTS_REQUIRED}, the board, a detail view and a filtered view`, 1);
}
for (const name of shots) {
  if (!LEGAL_IMAGE.test(name)) {
    die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

// dossier.json is last: the scorer rebuilds it from this same directory and compares the bytes.
const dossierFile = join(outputDir, 'dossier.json');
writeFileSync(dossierFile, buildDossier(resolve(outputDir), DOSSIER_CAPS));

// --- report ------------------------------------------------------------------

const lines = [
  `${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`,
  `wrote ${boardFile}, ${dataFile}, ${join(outputDir, 'dashboard')}, ` +
    `${join(outputDir, 'screenshots')} (${shots.length} image${shots.length === 1 ? '' : 's'}) and ${dossierFile}`,
];
for (const line of lines) process.stdout.write(`token radar: ${line}\n`);
