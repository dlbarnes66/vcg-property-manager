import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { fmtLocal } from "./dates";

/** Standard PDF fonts are Latin-1 only; drop anything they can't draw. */
const clean = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7e\xa0-\xff]/g, "");

export type CertSigner = {
  name: string; role: string; email: string | null; method: string; signatureType: string | null; signatureText: string | null;
  signatureImage: string | null; consentAt: Date | null; signedAt: Date | null; ip: string | null; userAgent: string | null;
};
export type CertEvent = { at: Date; type: string; who: string | null; ip: string | null; detail: string | null };

/**
 * The finished signed PDF: the original pages (unchanged, with a small "signed electronically"
 * stamp in the margin) followed by a signature certificate and audit trail.
 */
export async function buildSignedPdf(o: {
  original: Uint8Array; requestId: string; title: string; originalHash: string; sentBy: string | null; sentAt: Date; completedAt: Date;
  signers: CertSigner[]; events: CertEvent[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(o.original);
  const [helv, bold, script] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold), pdf.embedFont(StandardFonts.TimesRomanItalic)]);
  const short = o.requestId.slice(-8).toUpperCase();
  const gray = rgb(0.4, 0.4, 0.45);
  const navy = rgb(0.075, 0.16, 0.29);

  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    const stamp = `Signed electronically - ID ${short} - see the signature certificate at the end`;
    page.drawText(stamp, { x: width - 36 - helv.widthOfTextAtSize(stamp, 7), y: 20, size: 7, font: helv, color: gray });
  }

  const W = 612;
  const H = 792;
  const M = 54;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const need = (h: number) => {
    if (y - h < M) newPage();
  };
  const text = (s: string, x: number, size: number, font: PDFFont = helv, color = rgb(0.07, 0.07, 0.1)) => page.drawText(clean(s), { x, y, size, font, color });
  const wrap = (s: string, size: number, maxW: number, font: PDFFont = helv) => {
    const words = clean(s).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const when = (d: Date | null) => (d ? `${fmtLocal(d, true)} (${d.toISOString().replace(".000", "")})` : "-");

  text("Signature Certificate", M, 18, bold, navy);
  y -= 24;
  for (const [k, v] of [
    ["Document", o.title], ["Request ID", o.requestId], ["Sent by", o.sentBy ?? "-"], ["Sent", when(o.sentAt)], ["Completed", when(o.completedAt)],
    ["Original SHA-256", o.originalHash],
  ] as const) {
    text(k, M, 8.5, bold, gray);
    const lines = wrap(v, 9, W - M * 2 - 110);
    lines.forEach((l, i) => {
      if (i) y -= 12;
      text(l, M + 110, 9);
    });
    y -= 14;
  }
  y -= 6;
  for (const l of wrap("Each person below agreed to do business electronically and signed this document electronically. The SHA-256 fingerprint identifies the exact document (all pages before this certificate) that was presented and signed.", 8.5, W - M * 2)) {
    text(l, M, 8.5, helv, gray);
    y -= 12;
  }
  y -= 10;

  for (const s of o.signers) {
    const boxH = 118;
    need(boxH + 10);
    const top = y;
    page.drawRectangle({ x: M, y: top - boxH, width: W - M * 2, height: boxH, borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 0.75 });
    // signature
    const sigX = M + 12;
    const sigY = top - 62;
    if (s.signatureType === "drawn" && s.signatureImage?.startsWith("data:image/png;base64,")) {
      try {
        const png = await pdf.embedPng(Buffer.from(s.signatureImage.split(",")[1], "base64"));
        const scale = Math.min(200 / png.width, 46 / png.height);
        page.drawImage(png, { x: sigX, y: sigY, width: png.width * scale, height: png.height * scale });
      } catch {
        page.drawText(clean(s.signatureText ?? s.name), { x: sigX, y: sigY + 12, size: 22, font: script });
      }
    } else page.drawText(clean(s.signatureText ?? s.name), { x: sigX, y: sigY + 12, size: 22, font: script, color: rgb(0.05, 0.1, 0.3) });
    page.drawLine({ start: { x: sigX, y: sigY - 4 }, end: { x: sigX + 210, y: sigY - 4 }, thickness: 0.5, color: gray });
    y = sigY - 16;
    text(`${s.name} (${s.role})`, sigX, 9.5, bold);
    y -= 12;
    text(s.email ?? "", sigX, 8, helv, gray);
    // details column
    const dx = M + 250;
    y = top - 16;
    for (const [k, v] of [
      ["Signed", when(s.signedAt)], ["Consent to e-sign", when(s.consentAt)], ["Method", s.method], ["Signature", s.signatureType === "drawn" ? "Drawn" : "Typed"],
      ["IP address", s.ip ?? "-"], ["Device", s.userAgent ?? "-"],
    ] as const) {
      text(k, dx, 7.5, bold, gray);
      const room = W - M - 10 - (dx + 82);
      let val = clean(v);
      while (val.length > 1 && helv.widthOfTextAtSize(val, 7.5) > room) val = val.slice(0, -2);
      text(val === clean(v) ? val : `${val}...`, dx + 82, 7.5);
      y -= 14;
    }
    y = top - boxH - 12;
  }

  need(40);
  y -= 6;
  text("Audit trail", M, 12, bold, navy);
  y -= 18;
  for (const e of o.events) {
    need(14);
    const line = `${fmtLocal(e.at, true)}   ${e.type.replace(/_/g, " ")}${e.who ? ` - ${e.who}` : ""}${e.ip ? ` - IP ${e.ip}` : ""}${e.detail ? ` - ${e.detail}` : ""}`;
    for (const l of wrap(line, 8, W - M * 2)) {
      need(12);
      text(l, M, 8);
      y -= 11;
    }
  }
  return pdf.save();
}

export async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}
