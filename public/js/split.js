// Splits one block of LLM text into separate prompts. Shared by the Prompt batch node and the run engine.

export const SPLIT_MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'numbered', label: 'Numbered list' },
  { id: 'headings', label: 'Headings' },
  { id: 'blank', label: 'Blank lines' },
  { id: 'lines', label: 'One per line' },
  { id: 'custom', label: 'Custom separator' },
];

const NUMBERED = /^\s*(?:[*_#>\-]+\s*)?(?:prompt|shot|scene|option|variation|image|video|clip|frame)?\s*#?\s*(\d{1,3})\s*[.):\-–—]\s*(?:\*\*)?/i;
const HEADING = /^\s*#{1,6}\s+/;
const BULLET = /^\s*(?:[-*•]|\d+\.)\s+/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/;

const FILLER = /^(?:let me know|feel free|would you like|hope (?:this|these|that)|i hope|note:|these prompts|each (?:prompt|of these)|you can|if you(?:'d| would) like|happy to|want me to)/i;
function clean(s) {
  let t = s.trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');          // fenced code
  // A closing chat line after the last prompt ("Let me know if you want more.") is not a prompt.
  const paras = t.split(/\n\s*\n/);
  while (paras.length > 1 && paras[paras.length - 1].trim().length < 200 && FILLER.test(paras[paras.length - 1].trim())) paras.pop();
  t = paras.join('\n\n');
  t = t.replace(/^\*\*(.+?)\*\*:?\s*/, (m, a) => (t.length > a.length + 6 ? '' : a)); // bold label at the start
  t = t.replace(/^(?:prompt|shot|scene|option|variation)\s*#?\d*\s*[:\-–—]\s*/i, '');
  t = t.replace(/\*\*/g, '');                                            // stray bold markers
  t = t.replace(/^["“'`]+|["”'`]+$/g, '');
  return t.trim();
}
const dedupe = (items) => items.map(clean).filter((t) => t.length > 0);

export function splitPrompts(text, mode = 'auto', separator = '') {
  const src = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!src) return [];
  const lines = src.split('\n');

  const byNumbered = () => {
    const marks = lines.map((l, i) => (NUMBERED.test(l) ? i : -1)).filter((i) => i >= 0);
    if (marks.length < 2) return null;
    const out = [];
    for (let k = 0; k < marks.length; k++) {
      const chunk = lines.slice(marks[k], marks[k + 1] ?? lines.length);
      chunk[0] = chunk[0].replace(NUMBERED, '');
      out.push(chunk.join('\n'));
    }
    return dedupe(out);
  };
  const byHeadings = () => {
    const marks = lines.map((l, i) => (HEADING.test(l) ? i : -1)).filter((i) => i >= 0);
    if (marks.length < 2) return null;
    const out = [];
    for (let k = 0; k < marks.length; k++) {
      const chunk = lines.slice(marks[k], marks[k + 1] ?? lines.length);
      const title = chunk[0].replace(HEADING, '').trim();
      const body = chunk.slice(1).join('\n').trim();
      out.push(body || title);
    }
    return dedupe(out);
  };
  const byRules = () => {
    if (!lines.some((l) => RULE.test(l))) return null;
    const out = []; let cur = [];
    for (const l of lines) { if (RULE.test(l)) { out.push(cur.join('\n')); cur = []; } else cur.push(l); }
    out.push(cur.join('\n'));
    const items = dedupe(out);
    return items.length >= 2 ? items : null;
  };
  const byBullets = () => {
    const marks = lines.map((l, i) => (BULLET.test(l) ? i : -1)).filter((i) => i >= 0);
    if (marks.length < 2) return null;
    const out = [];
    for (let k = 0; k < marks.length; k++) {
      const chunk = lines.slice(marks[k], marks[k + 1] ?? lines.length);
      chunk[0] = chunk[0].replace(BULLET, '');
      out.push(chunk.join('\n'));
    }
    return dedupe(out);
  };
  const byBlank = () => { const items = dedupe(src.split(/\n\s*\n/)); return items.length >= 2 ? items : null; };
  const byLines = () => dedupe(lines);

  switch (mode) {
    case 'numbered': return byNumbered() || [clean(src)];
    case 'headings': return byHeadings() || [clean(src)];
    case 'blank': return byBlank() || [clean(src)];
    case 'lines': return byLines();
    case 'custom': return separator ? dedupe(src.split(separator)) : [clean(src)];
    default: return byNumbered() || byHeadings() || byRules() || byBullets() || byBlank() || [clean(src)];
  }
}
