import { describe, expect, it } from "vitest";

import {
  isRichText,
  isRichTextEmpty,
  plainTextToHtml,
  richTextToPlain,
  sanitizeRichText,
  toEditorHtml,
} from "./rich-text";

describe("sanitizeRichText", () => {
  it("keeps the tags a note is written in", () => {
    const html = "<p>Fever <strong>3 days</strong></p><ul><li>Chills</li></ul>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("drops every attribute, including the harmless-looking ones", () => {
    expect(sanitizeRichText('<p class="x" onclick="steal()">Seen</p>')).toBe("<p>Seen</p>");
  });

  it("removes a script and what it was going to run", () => {
    expect(sanitizeRichText("<p>Note</p><script>alert(1)</script>")).toBe("<p>Note</p>");
  });

  it("removes tags that carry a URL", () => {
    expect(sanitizeRichText('<p>See <a href="http://x">this</a></p><img src="x">')).toBe(
      "<p>See this</p>",
    );
  });
});

describe("plainTextToHtml", () => {
  it("makes a paragraph of each block and a break of each line", () => {
    expect(plainTextToHtml("One\ntwo\n\nThree")).toBe("<p>One<br>two</p><p>Three</p>");
  });

  it("escapes text that would otherwise read as markup", () => {
    expect(plainTextToHtml("BP <90 & falling")).toBe("<p>BP &lt;90 &amp; falling</p>");
  });
});

describe("toEditorHtml", () => {
  it("promotes a note written before the editor existed", () => {
    expect(toEditorHtml("Cough\n\nNo fever")).toBe("<p>Cough</p><p>No fever</p>");
  });

  it("leaves a note the editor wrote alone", () => {
    expect(toEditorHtml("<p>Cough</p>")).toBe("<p>Cough</p>");
  });

  it("has nothing to show for an absent field", () => {
    expect(toEditorHtml(undefined)).toBe("");
  });
});

describe("isRichText", () => {
  it("tells the two stored shapes apart", () => {
    expect(isRichText("<p>Cough</p>")).toBe(true);
    expect(isRichText("Cough < 3 days")).toBe(false);
  });
});

describe("richTextToPlain", () => {
  it("flattens markup to the words, with the blocks kept apart", () => {
    expect(richTextToPlain("<p>Malaria</p><ul><li>RDT positive</li><li>Treat</li></ul>")).toBe(
      "Malaria\nRDT positive\nTreat",
    );
  });

  it("decodes the entities the editor escapes", () => {
    expect(richTextToPlain("<p>BP &lt;90 &amp; falling</p>")).toBe("BP <90 & falling");
  });
});

describe("isRichTextEmpty", () => {
  it("sees an emptied editor for what it is", () => {
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<p><br></p>")).toBe(true);
    expect(isRichTextEmpty("   ")).toBe(true);
    expect(isRichTextEmpty(undefined)).toBe(true);
  });

  it("does not mistake a written note for one", () => {
    expect(isRichTextEmpty("<p>Fever</p>")).toBe(false);
  });
});
