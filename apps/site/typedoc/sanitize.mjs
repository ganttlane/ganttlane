// Takes private references out of the text of the generated API pages.
//
// The TSDoc of the source cites internal design notes that are not published: requirement ids
// (`FR-TX-4`), decision records (`ADR-015`), sections of local documents (`docs/api.md` §3), plan
// steps and phase names (`P1`). On the public site they are noise at best, so the pages are
// cleaned after TypeDoc has written them. The cleaning removes what is only a reference, and
// rewrites the few phase names into plain words; it does not rewrite prose. The better fix is in
// the source comments, and when they are clean this file can go (the plugin logs what is left
// over, and nothing is left over then).

/** One reference: a requirement id, a decision record, a local document, a plan step. */
const REFERENCE = String.raw`(?:N?FR-[A-Z0-9]+-(?:\d+|\*)|ADR-\d+|\x60docs/[^\x60]+\x60(?:\s*§\s*[\w.]+)?|(?:plan )?steps? \d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?|Q\d+)`;
/** References joined by commas, `and` or an ellipsis: `FR-SNAP-2 … FR-SNAP-8`, `FR-A-1, ADR-2`. */
const REFERENCES = String.raw`${REFERENCE}(?:\s*(?:,|…|\.\.\.|and)\s*${REFERENCE})*`;

const RULES = [
  // Sentences that name a document as their subject or object.
  [
    /\ba value `docs\/api\.md` §3 lists for a later release/g,
    'a value reserved for a later release',
  ],
  [/\b(every method|the methods) of `docs\/api\.md` §6/g, '$1 of the chart'],
  [/\bN?FR-[A-Z0-9]+-\d+'s\b/g, 'the'],
  [/\bfollow N?FR-[A-Z0-9]+-\d+/g, 'follow the presets of the scale'],
  // `(FR-TX-4)`, `(`docs/api.md` §3)`, `(ADR-015, FR-SNAP-13)`, `(plan step 3.7)`: a parenthesis
  // that holds nothing else goes, with the space before it.
  [new RegExp(String.raw`[ \t]*\(${REFERENCES}\)`, 'g'), ''],
  // `(Command pattern, `docs/architecture.md` §10)`, `(`docs/api.md` §3, `dates` and `scheduling`)`:
  // the reference goes out of a parenthesis that says more.
  [new RegExp(String.raw`\((?=[^)]*${REFERENCE})([^)]*?)(?:,\s*|\s+)${REFERENCES}\)`, 'g'), '($1)'],
  [new RegExp(String.raw`\(${REFERENCES},\s*`, 'g'), '('],
  // `(`docs/api.md` §3 `editing`)`: the reference leads a parenthesis that says more.
  [new RegExp(String.raw`\(${REFERENCES}[:,]?[ \t]+(?=\S)`, 'g'), '('],
  // A section sign whose document is gone: `(§7a)`, `(§8: a sticky header ...)`.
  [/[ \t]*\(§[\w.]+\)/g, ''],
  [/\(§[\w.]+[:,][ \t]*/g, '('],
  // The fork's own bug ids.
  [/[ \t]*\(fork bugs D\d+(?:[ \t]*\/[ \t]*D\d+)*\)/g, ''],
  // `(FR-ROW-5), taken from ...`: a bare reference followed by punctuation.
  [new RegExp(String.raw`[ \t]*${REFERENCES}(?=[,:;.)])`, 'g'), ''],
  // What a removed reference leaves behind: `(redo:)`, `(; the change`, a line that begins with
  // the punctuation that followed it.
  [/,[ \t]*;/g, ';'],
  [/[:;,][ \t]*\)/g, ')'],
  [/\([ \t]*[:;,][ \t]*/g, '('],
  [/[ \t]*\n[ \t]*([;,.:])(?=[ \t\n])/g, '$1'],
  // Phase names: reserved options and limits.
  [/\b([Rr]eserved) for P1\b/g, '$1 for a later release'],
  [/\bis a P1\b/g, 'is a planned'],
  [/\bis P1\b/g, 'is planned'],
  [/\(P1\)/g, '(planned)'],
  [/\(P1,/g, '(planned,'],
  [/\b([Ii])n P0\b/g, '$1n this version'],
];

/** What is left that looks like a private reference, to be fixed in the source. */
const LEFTOVER = new RegExp(
  String.raw`N?FR-[A-Z0-9]+-(?:\d+|\*)|ADR-\d+|docs/[a-z]+(?:/[\w.-]+)*\.md|\bplan steps?\b|\bP[0-2]\b|\bQ\d+\b`,
  'g',
);

/**
 * Cleans the Markdown of an API page, outside its fenced code blocks.
 *
 * @param {string} markdown - The page.
 * @returns {{ text: string, leftovers: string[] }} The cleaned page, and what still looks like a private reference.
 */
export function sanitize(markdown) {
  const parts = markdown.split(/(^```[\s\S]*?^```$)/m);
  const leftovers = [];
  const text = parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      let out = part;
      for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
      for (const match of out.matchAll(LEFTOVER)) leftovers.push(match[0]);
      return out;
    })
    .join('');
  return { text, leftovers };
}
