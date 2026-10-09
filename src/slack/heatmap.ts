import { Resvg } from "@resvg/resvg-js";

export type HeatmapDay = { day: string; count: number };

export type HeatmapOptions = {
  title?: string;
  /** Number of days the graph should span (aligned to whole weeks). */
  days?: number;
  total?: number;
};

// GitHub's contribution color ramp (level 0..4).
const LEVEL_COLORS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const BG = "#ffffff";
const TEXT_MUTED = "#57606a";
const TEXT_STRONG = "#24292f";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP; // 14
const RADIUS = 2;
const LEFT_GUTTER = 30; // room for weekday labels
const TOP_HEADER = 52; // title + subtitle
const MONTH_LABEL_H = 15;
const LEGEND_H = 22;
const PAD = 16;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_LABELS: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toUtcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function levelForCount(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 0) return 1;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** Builds a GitHub-contributions-style calendar heatmap as an SVG string. */
export function buildEmailHeatmapSvg(data: HeatmapDay[], opts: HeatmapOptions = {}): string {
  const span = Math.max(1, opts.days ?? 371);
  const title = opts.title ?? "Email activity";

  const counts = new Map<string, number>();
  for (const d of data) counts.set(d.day, (counts.get(d.day) ?? 0) + d.count);

  const end = toUtcDayStart(new Date());
  const rawStart = new Date(end.getTime() - (span - 1) * DAY_MS);
  // Align the grid start to the Sunday on/before the first day.
  const start = new Date(rawStart.getTime() - rawStart.getUTCDay() * DAY_MS);

  type Cell = { col: number; row: number; ymd: string; count: number };
  const cells: Cell[] = [];
  let maxCount = 0;
  let total = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const col = Math.floor((t - start.getTime()) / DAY_MS / 7);
    const row = d.getUTCDay();
    const ymd = formatYmd(d);
    const count = counts.get(ymd) ?? 0;
    if (count > maxCount) maxCount = count;
    total += count;
    cells.push({ col, row, ymd, count });
  }
  const numWeeks = cells.length ? cells[cells.length - 1]!.col + 1 : 1;

  const gridX = PAD + LEFT_GUTTER;
  const gridY = PAD + TOP_HEADER + MONTH_LABEL_H;
  const gridW = numWeeks * STEP - GAP;
  const width = gridX + gridW + PAD;
  const height = gridY + 7 * STEP - GAP + LEGEND_H + PAD;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="${BG}"/>`);

  // Header
  const totalCount = opts.total ?? total;
  const firstDay = cells.length ? cells[0]!.ymd : formatYmd(start);
  const lastDay = cells.length ? cells[cells.length - 1]!.ymd : formatYmd(end);
  const subtitle = `${totalCount} email${totalCount === 1 ? "" : "s"} · ${firstDay} to ${lastDay}`;
  parts.push(
    `<text x="${PAD}" y="${PAD + 18}" font-size="16" font-weight="600" fill="${TEXT_STRONG}">${escapeXml(
      title,
    )}</text>`,
  );
  parts.push(
    `<text x="${PAD}" y="${PAD + 38}" font-size="12" fill="${TEXT_MUTED}">${escapeXml(subtitle)}</text>`,
  );

  // Month labels across the top of the grid.
  let lastMonth = -1;
  for (let col = 0; col < numWeeks; col++) {
    const colStart = new Date(start.getTime() + col * 7 * DAY_MS);
    const month = colStart.getUTCMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      const x = gridX + col * STEP;
      parts.push(
        `<text x="${x}" y="${PAD + TOP_HEADER + 10}" font-size="10" fill="${TEXT_MUTED}">${MONTH_NAMES[month]}</text>`,
      );
    }
  }

  // Weekday labels (Mon / Wed / Fri).
  for (const rowStr of Object.keys(WEEKDAY_LABELS)) {
    const row = Number(rowStr);
    const y = gridY + row * STEP + CELL - 1;
    parts.push(
      `<text x="${PAD}" y="${y}" font-size="9" fill="${TEXT_MUTED}">${WEEKDAY_LABELS[row]}</text>`,
    );
  }

  // Day cells.
  for (const c of cells) {
    const x = gridX + c.col * STEP;
    const y = gridY + c.row * STEP;
    const fill = LEVEL_COLORS[levelForCount(c.count, maxCount)];
    parts.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="${RADIUS}" ry="${RADIUS}" fill="${fill}"/>`,
    );
  }

  // Legend (bottom-right): "Less [][][][][] More".
  const legendY = gridY + 7 * STEP - GAP + 15;
  const legendSquares = LEVEL_COLORS.length;
  const legendWidth = 30 /* "More" */ + legendSquares * STEP + 30 /* "Less" */;
  let lx = width - PAD - legendWidth;
  parts.push(
    `<text x="${lx}" y="${legendY + CELL - 2}" font-size="10" fill="${TEXT_MUTED}">Less</text>`,
  );
  lx += 26;
  for (let i = 0; i < legendSquares; i++) {
    parts.push(
      `<rect x="${lx + i * STEP}" y="${legendY}" width="${CELL}" height="${CELL}" rx="${RADIUS}" ry="${RADIUS}" fill="${LEVEL_COLORS[i]}"/>`,
    );
  }
  lx += legendSquares * STEP + 4;
  parts.push(
    `<text x="${lx}" y="${legendY + CELL - 2}" font-size="10" fill="${TEXT_MUTED}">More</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("");
}

/** Renders the email heatmap to a PNG Buffer (2x scaled for crispness). */
export function renderEmailHeatmapPng(data: HeatmapDay[], opts: HeatmapOptions = {}): Buffer {
  const svg = buildEmailHeatmapSvg(data, opts);
  const widthMatch = svg.match(/width="(\d+)"/);
  const baseWidth = widthMatch ? Number(widthMatch[1]) : 800;
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: baseWidth * 2 } });
  return resvg.render().asPng();
}
