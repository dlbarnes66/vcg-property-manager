import PDFDocument from "pdfkit";
import { colMax, fmtCell, isNumeric, type ReportData, type ReportTable } from "./report-kit";
import { fmtDate, todayUTC } from "./utils";

const NAVY = "#13294b";
const GOLD = "#c99a2e";
const INK = "#0f1b2d";
const MUTED = "#5b6676";
const LINE = "#e3e6eb";
const PAPER = "#f6f7f9";
const RED = "#b91c1c";
const AMBER = "#b45309";
const GREEN = "#047857";

/** The built-in PDF fonts only cover Western characters; drop emoji and anything else they can't draw. */
const clean = (s: string) => s.replace(/[←-⇿⌀-⯿\u{1F000}-\u{1FFFF}️‍]/gu, "").replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff–—‘’“”•…€™·]/g, "").trim();

export async function reportToPdf(r: ReportData, opts: { orgName?: string } = {}): Promise<Buffer> {
  const wide = r.tables.some((t) => t.columns.length > 8);
  const doc = new PDFDocument({
    size: "LETTER", layout: wide ? "landscape" : "portrait", margins: { top: 40, bottom: 48, left: 40, right: 40 }, bufferPages: true,
    info: { Title: `${r.title} — ${r.period}`, Author: opts.orgName ?? "VCG Property Manager", Creator: "VCG Property Manager" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => {
    doc.on("end", () => res(Buffer.concat(chunks)));
    doc.on("error", rej);
  });

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  let y = doc.page.margins.top;
  const need = (h: number) => {
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      return true;
    }
    return false;
  };
  const fit = (s: string, width: number) => {
    let t = clean(s);
    if (doc.widthOfString(t) <= width) return t;
    while (t.length > 1 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
    return `${t}…`;
  };

  /* Header */
  doc.font("Helvetica-Bold").fontSize(8).fillColor(GOLD).text(clean((opts.orgName ?? "VCG Property Manager").toUpperCase()), L, y, { characterSpacing: 1.2 });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Prepared ${fmtDate(todayUTC())}`, L, y, { width: W, align: "right" });
  y += 14;
  doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text(clean(r.title), L, y, { width: W });
  y = doc.y + 2;
  doc.font("Helvetica").fontSize(10.5).fillColor(MUTED).text(clean(r.period), L, y, { width: W });
  y = doc.y + 8;
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1.5).strokeColor(NAVY).stroke();
  y += 14;

  /* Manager's note */
  if (r.memo) {
    doc.font("Helvetica").fontSize(9.5);
    const h = doc.heightOfString(clean(r.memo), { width: W - 24 }) + 30;
    need(h);
    doc.rect(L, y, W, h).fill(PAPER);
    doc.rect(L, y, 3, h).fill(GOLD);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("FROM THE MANAGER", L + 14, y + 9, { characterSpacing: 0.8 });
    doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(clean(r.memo), L + 14, y + 22, { width: W - 24 });
    y += h + 14;
  }

  /* KPIs */
  if (r.kpis.length) {
    const perRow = r.kpis.length === 6 || r.kpis.length === 3 ? 3 : Math.min(4, r.kpis.length);
    const gap = 8;
    const bw = (W - gap * (perRow - 1)) / perRow;
    const bh = 52;
    r.kpis.forEach((k, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) y += bh + gap;
      if (col === 0) need(bh);
      const x = L + col * (bw + gap);
      doc.roundedRect(x, y, bw, bh, 4).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(fit(k.label, bw - 16), x + 8, y + 8, { lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(15).fillColor(k.tone === "bad" ? RED : k.tone === "good" ? GREEN : INK).text(fit(k.value, bw - 16), x + 8, y + 19, { lineBreak: false });
      if (k.sub) doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(fit(k.sub, bw - 16), x + 8, y + 38, { lineBreak: false });
    });
    y += bh + 18;
  }

  /* Tables */
  for (const t of r.tables) drawTable(t);

  /* Notes */
  if (r.notes?.length) {
    doc.font("Helvetica").fontSize(7.5);
    const text = r.notes.map(clean).join("\n");
    need(doc.heightOfString(text, { width: W }) + 10);
    y += 4;
    doc.fillColor(MUTED);
    for (const n of r.notes) {
      doc.text(`•  ${clean(n)}`, L, y, { width: W });
      y = doc.y + 2;
    }
  }

  /* Footer with page numbers */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing inside the bottom margin would otherwise start a new page
    const fy = doc.page.height - 30;
    doc.font("Helvetica").fontSize(7).fillColor(MUTED);
    doc.text(clean(`${r.title} · ${r.period}`), L, fy, { width: W * 0.7, lineBreak: false, height: 10 });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, L, fy, { width: W, align: "right", lineBreak: false, height: 10 });
  }
  doc.end();
  return done;

  function drawTable(t: ReportTable) {
    const fs = t.columns.length > 10 ? 7 : 8;
    const rowH = fs + 9;
    const weights = t.columns.map((c) => c.w ?? (c.fmt === "bar" ? 1.6 : isNumeric(c.fmt) ? 1.1 : 1.4));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * W);
    const xs = widths.map((_, i) => L + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const pad = 4;
    const maxes = Object.fromEntries(t.columns.filter((c) => c.fmt === "bar").map((c) => [c.key, colMax(t.rows, c.key)]));
    const right = (c: (typeof t.columns)[number]) => isNumeric(c.fmt);

    const cellText = (row: (typeof t.rows)[number], c: (typeof t.columns)[number]) => (row._kind === "total" && row[c.key] == null ? "" : clean(fmtCell(c.fmt, row[c.key])));
    const textH = (text: string, i: number, maxLines: number) =>
      Math.min(doc.heightOfString(text || " ", { width: widths[i] - pad * 2 }), doc.currentLineHeight(true) * maxLines);
    const header = () => {
      doc.font("Helvetica-Bold").fontSize(fs - 0.5);
      const h = Math.max(rowH + 2, ...t.columns.map((c, i) => textH(clean(c.label), i, 2) + 9));
      doc.rect(L, y, W, h).fill(NAVY);
      doc.fillColor("#ffffff");
      t.columns.forEach((c, i) => doc.text(clean(c.label), xs[i] + pad, y + 5, { width: widths[i] - pad * 2, height: h - 6, ellipsis: true, align: right(c) ? "right" : "left" }));
      y += h;
    };
    if (t.title) {
      need(18 + rowH * 3);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(clean(t.title), L, y);
      y = doc.y + 4;
    } else need(rowH * 3);
    header();

    if (!t.rows.length) {
      doc.font("Helvetica-Oblique").fontSize(fs).fillColor(MUTED).text(clean(t.empty ?? "Nothing to show."), L + pad, y + 5);
      y += rowH + 14;
      return;
    }
    t.rows.forEach((row, ri) => {
      const isTotal = row._kind === "total";
      doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(fs);
      // Text columns wrap (up to 3 lines); numbers stay on one line.
      const h = Math.max(rowH, ...t.columns.map((c, i) => (c.fmt === "bar" || isNumeric(c.fmt) ? 0 : textH(cellText(row, c), i, 3) + 9)));
      if (need(h)) {
        header();
        doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(fs);
      }
      if (isTotal) doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.8).strokeColor(INK).stroke();
      else if (ri % 2 === 1) doc.rect(L, y, W, h).fill(PAPER);
      if (row._tone && !isTotal) doc.rect(L, y + 2, 2, h - 4).fill(row._tone === "bad" ? RED : row._tone === "warn" ? AMBER : GREEN);
      t.columns.forEach((c, i) => {
        const v = row[c.key];
        if (c.fmt === "bar") {
          if (typeof v === "number" && v > 0) {
            const bw = Math.max(1, ((widths[i] - pad * 2) * v) / maxes[c.key]);
            doc.rect(xs[i] + pad, y + rowH / 2 - 3, Math.min(bw, widths[i] - pad * 2), 6).fill(NAVY);
          }
          return;
        }
        const neg = typeof v === "number" && v < 0 && c.fmt === "money";
        doc.fillColor(neg ? RED : INK);
        if (isNumeric(c.fmt)) doc.text(fit(cellText(row, c), widths[i] - pad * 2), xs[i] + pad, y + 4.5, { width: widths[i] - pad * 2, align: "right", lineBreak: false });
        else doc.text(cellText(row, c), xs[i] + pad, y + 4.5, { width: widths[i] - pad * 2, height: h - 6, ellipsis: true });
      });
      y += h;
    });
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 6;
    if (t.note) {
      doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED).text(clean(t.note), L, y, { width: W });
      y = doc.y;
    }
    y += 14;
  }
}
