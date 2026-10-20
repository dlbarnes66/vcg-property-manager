// Browser-safe (used by the message composer).
/** Rough SMS segment count (GSM-7: 160/153 chars; anything else: 70/67). */
export function smsSegments(body: string) {
  const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/.test(body);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  const len = [...body].length;
  return len <= single ? 1 : Math.ceil(len / multi);
}
