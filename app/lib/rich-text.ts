/**
 * The small amount of HTML a consultation note is allowed to be.
 *
 * The note fields used to hold plain text and the API still types them as
 * strings, so both shapes exist in the record for good: notes written before
 * the editor arrived are plain, notes written since are HTML. Everything that
 * reads a note goes through here rather than assuming one or the other —
 * {@link toEditorHtml} on the way into the editor, {@link sanitizeRichText} on
 * the way onto the page, {@link richTextToPlain} whenever something wants the
 * words without the markup (search seeds, previews, emptiness checks).
 *
 * The sanitiser exists because the read view sets `innerHTML`. Our own editor
 * cannot produce anything dangerous, but the string arrives over the wire and
 * whatever wrote it is not this browser's problem to trust.
 */

/** Everything the editor can produce. Nothing here carries a URL or a handler. */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "h3",
  "h4",
  "blockquote",
  "code",
  "pre",
  "hr",
]);

/** Elements whose *content* has to go with them, not just their tags. */
const DANGEROUS_BLOCKS = /<(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const ANY_TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;

/** Tags that mark a break between blocks when flattening back to text. */
const BLOCK_BREAK = /<\/(p|div|li|h[1-6]|blockquote|pre)\s*>|<br\s*\/?>|<hr\s*\/?>/gi;

/**
 * Strips everything but the handful of tags above, and **all** attributes.
 *
 * Dropping attributes wholesale rather than filtering them is the point: with
 * no `href`, `src`, `style` or `on*` surviving, there is no allowlist to get
 * subtly wrong later. Nothing the editor writes needs one.
 */
export function sanitizeRichText(html: string): string {
  return html
    .replace(DANGEROUS_BLOCKS, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(ANY_TAG, (tag, rawName: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return "";
      return tag.startsWith("</") ? `</${name}>` : `<${name}>`;
    });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A blank line starts a paragraph; a single newline is a line break. */
export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  if (paragraphs.length === 0) return "";

  return paragraphs
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Whether a stored value was written by the editor rather than typed plain. */
export function isRichText(value: string): boolean {
  return /<\/?(p|br|ul|ol|li|h[1-6]|strong|em|b|i|u|s|blockquote|pre|code|hr|div|span)\b[^>]*>/i.test(
    value,
  );
}

/**
 * What the editor should open with.
 *
 * Plain text is promoted to paragraphs so an old note keeps its shape instead
 * of collapsing into one run-on block the first time someone amends it.
 */
export function toEditorHtml(value: string | undefined | null): string {
  if (!value) return "";
  return isRichText(value) ? sanitizeRichText(value) : plainTextToHtml(value);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** The words, without the markup. For search seeds, previews and counting. */
export function richTextToPlain(value: string | undefined | null): string {
  if (!value) return "";

  return value
    .replace(DANGEROUS_BLOCKS, "")
    .replace(BLOCK_BREAK, "\n")
    .replace(ANY_TAG, "")
    .replace(/&[a-zA-Z#0-9]+;/g, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * True when a field holds nothing a clinician wrote.
 *
 * An emptied editor still posts `<p></p>`, which is not the empty string — so
 * every "did they write anything" check has to ask this, not `.trim()`.
 */
export function isRichTextEmpty(value: string | undefined | null): boolean {
  return richTextToPlain(value) === "";
}
