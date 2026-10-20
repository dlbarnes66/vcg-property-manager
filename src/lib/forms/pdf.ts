import PDFDocument from "pdfkit";
import { inlineRuns, parseMarkdown } from "./markdown";

/** The built-in PDF fonts only cover Western characters. */
const clean = (s: string) =>
  s.replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, "").replace(/☐|□/g, "[ ]").replace(/☑|☒|✓|✔/g, "[x]").replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff–—‘’“”•…€™·§¶]/g, "");

/** Renders a form's Markdown as a clean, printable letter-size PDF. */
export async function formToPdf(title: string, markdown: string, footer?: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 64, bottom: 64, left: 66, right: 66 }, bufferPages: true, info: { Title: clean(title), Creator: "VCG Property Manager" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => {
    doc.on("end", () => res(Buffer.concat(chunks)));
    doc.on("error", rej);
  });
  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const BODY = 10.5;

  /** Writes text with **bold** runs, wrapping within [x, x+width]. */
  const rich = (s: string, x: number, width: number, size = BODY, opts: PDFKit.Mixins.TextOptions = {}) => {
    const runs = inlineRuns(clean(s));
    if (!runs.length) return;
    doc.fontSize(size);
    runs.forEach((r, i) => {
      doc.font(r.bold ? "Times-Bold" : "Times-Roman");
      const last = i === runs.length - 1;
      if (i === 0) doc.text(r.text, x, doc.y, { width, continued: !last, lineGap: 2, ...opts });
      else doc.text(r.text, { continued: !last, lineGap: 2, ...opts });
    });
  };

  doc.fillColor("#111111");
  for (const b of parseMarkdown(markdown)) {
    if (b.t === "h") {
      const size = b.level === 1 ? 16 : b.level === 2 ? 12 : 11;
      ensure(size * 3);
      doc.moveDown(b.level === 1 ? 0 : 0.6);
      doc.font("Times-Bold").fontSize(size).text(clean(b.text), L, doc.y, { width: W, align: b.level === 1 ? "center" : "left" });
      doc.moveDown(b.level === 1 ? 0.8 : 0.3);
    } else if (b.t === "p") {
      ensure(BODY * 2.4);
      rich(b.text, L, W);
      doc.moveDown(/_{6,}/.test(b.text) ? 1.1 : 0.55); // room to sign on fill-in lines
    } else if (b.t === "list") {
      b.items.forEach((item, i) => {
        ensure(BODY * 2.4);
        const y = doc.y;
        const marker = b.ordered ? `${i + 1}.` : "•";
        doc.font("Times-Roman").fontSize(BODY).text(marker, L + 6, y, { width: 18, lineBreak: false });
        doc.y = y;
        rich(item, L + 24, W - 24);
        doc.moveDown(0.2);
      });
      doc.moveDown(0.4);
    } else if (b.t === "hr") {
      ensure(16);
      doc.moveDown(0.3);
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.5).strokeColor("#999999").stroke();
      doc.moveDown(0.6);
    } else if (b.t === "table") {
      const n = b.header.length;
      const lens = b.header.map((h, k) => Math.max(h.length, ...b.rows.map((r) => (r[k] ?? "").length)));
      const weights = lens.map((x) => Math.min(40, Math.max(6, x)));
      const tot = weights.reduce((a, c) => a + c, 0);
      const widths = weights.map((w) => (w / tot) * W);
      const pad = 4;
      const size = n > 4 ? 8.5 : 9.5;
      const rowOut = (cellsIn: string[], head: boolean) => {
        doc.font(head ? "Times-Bold" : "Times-Roman").fontSize(size);
        const texts = cellsIn.map((c) => clean(c).replace(/\*\*/g, ""));
        const h = Math.max(size + 9, ...texts.map((t, k) => doc.heightOfString(t || " ", { width: widths[k] - pad * 2 }) + 8));
        if (doc.y + h > bottom()) {
          doc.addPage();
          if (!head) rowOut(b.header, true);
        }
        const y = doc.y;
        let x = L;
        if (head) doc.rect(L, y, W, h).fill("#eeeeee");
        doc.fillColor("#111111");
        texts.forEach((t, k) => {
          doc.rect(x, y, widths[k], h).lineWidth(0.5).strokeColor("#888888").stroke();
          doc.font(head ? "Times-Bold" : "Times-Roman").fontSize(size).text(t, x + pad, y + 4, { width: widths[k] - pad * 2 });
          x += widths[k];
        });
        doc.x = L;
        doc.y = y + h;
      };
      ensure(40);
      rowOut(b.header, true);
      for (const r of b.rows) rowOut(r, false);
      doc.moveDown(0.8);
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 40;
    doc.font("Times-Roman").fontSize(8).fillColor("#666666");
    doc.text(clean(footer ?? title), L, fy, { width: W * 0.6, lineBreak: false, height: 10 });
    doc.text(`Page ${i - range.start + 1} of ${range.count}${range.count > 1 ? "    Initials: ______" : ""}`, L, fy, { width: W, align: "right", lineBreak: false, height: 10 });
  }
  doc.end();
  return done;
}
