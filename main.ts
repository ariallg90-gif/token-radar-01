// token-radar-01 driver (Node 22, standard library only).
//
// Reads the sealed snapshot, scores it with lib/model.ts, and lays out the
// entry an evaluator reads: board.json, the dashboard's data.js, the
// dashboard and screenshots copied under /output, and dossier.json built by
// the vendored make.fun library — the dossier is written last, because the
// scorer rebuilds it from the same /output and compares bytes.
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR standing in for /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  boardToDataScript,
  parseSnapshot,
  scoreBoard,
  validateBoard,
} from './lib/model.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Flags of the shape --name value or --name=value, read in one pass. */
const flags = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i]!;
  if (!token.startsWith('--')) continue;
  const eq = token.indexOf('=');
  if (eq >= 0) {
    flags.set(token.slice(2, eq), token.slice(eq + 1));
  } else if (i + 1 < process.argv.length) {
    flags.set(token.slice(2), process.argv[++i]!);
  }
}
const flag = (name: string, fallback: string): string =>
  flags.get(name) ?? fallback;

const inArg = flag('input', '/input');
const snapPath = inArg.endsWith('.json') ? inArg : join(inArg, 'snapshot.json');
if (!existsSync(snapPath)) {
  process.stderr.write(
    `radar: no snapshot at ${snapPath} — pass --input <snapshot.json|directory>\n`,
  );
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(snapPath, 'utf8'));
const rows = scoreBoard(snap);
const problem = validateBoard(rows, snap);
if (problem !== null) {
  process.stderr.write(`radar: board refused: ${problem}\n`);
  process.exit(1);
}

/** Mirror a directory tree into `to`, skipping dot-names, returning files. */
function mirrorTree(from: string, to: string, prefix = ''): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const done: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      done.push(...mirrorTree(src, dst, `${prefix}${name}/`));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, dst);
      done.push(`${prefix}${name}`);
    }
  }
  return done;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(outDir, 'data.js'), boardToDataScript(rows, snap));

const dashFiles = mirrorTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = mirrorTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(
    `radar: screenshots/ holds ${shots.length} image(s); hand in 3 — board, detail, filtered\n`,
  );
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`radar: screenshots/${name} is not a plain file name\n`);
    process.exit(1);
  }
}

// The dossier closes the entry: it is built from this exact /output.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_CAP,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const onList = rows.filter((r) => r.on_watchlist).length;
process.stdout.write(
  `radar: ${snap.protocols.length} protocols read, ${onList} watchlist rows, ${rows.length} rows ranked\n` +
    `radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `dashboard (${dashFiles.length} files), screenshots (${shots.length}) and dossier.json\n`,
);
