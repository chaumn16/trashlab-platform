const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
export const c = C;

export function table(rows, columns) {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((r) => stripAnsi(String(col.get(r))).length))
  );
  const line = (cells) =>
    cells.map((cell, i) => pad(cell, widths[i])).join("  ").replace(/\s+$/, "");

  console.log(C.dim(line(columns.map((c) => c.header))));
  for (const r of rows) console.log(line(columns.map((col) => String(col.get(r)))));
}

function pad(s, w) {
  return s + " ".repeat(Math.max(0, w - stripAnsi(s).length));
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function step(n, total, msg) {
  console.log(`${C.dim(`[${n}/${total}]`)} ${msg}`);
}

export function health(h) {
  return h === "green" ? C.green("● green") : h === "stale" ? C.yellow("● stale") : C.red("● " + h);
}
