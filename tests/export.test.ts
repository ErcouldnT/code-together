import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toHtml, toLines, toMarkdown } from "../src/export.ts";

/**
 * Export is the one place where being subtly wrong is invisible: the file
 * downloads, it opens, and only the formatting is missing. So the cases here
 * are the ones a delta gets wrong if you read it as a list of paragraphs
 * rather than as a run of text whose line breaks carry the block formatting.
 */
describe("delta to lines", () => {
  it("takes a line's block format from the newline that ends it", () => {
    // The attribute arrives *after* the text it applies to. Reading it the
    // other way round loses every heading in the document.
    const lines = toLines([
      { insert: "Title" },
      { insert: "\n", attributes: { header: 1 } },
      { insert: "Body" },
      { insert: "\n" },
    ]);

    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0]?.block, { header: 1 });
    assert.equal(lines[0]?.segments[0]?.text, "Title");
    assert.deepEqual(lines[1]?.block, {});
  });

  it("splits one insert that spans several lines", () => {
    const lines = toLines([{ insert: "one\ntwo\nthree\n" }]);
    assert.deepEqual(lines.map((l) => l.segments[0]?.text), ["one", "two", "three"]);
  });

  it("keeps an empty line rather than dropping it", () => {
    const lines = toLines([{ insert: "a\n\nb\n" }]);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[1]?.segments, []);
  });
});

describe("HTML export", () => {
  it("renders headings, marks and paragraphs", () => {
    const html = toHtml([
      { insert: "Heading" },
      { insert: "\n", attributes: { header: 2 } },
      { insert: "plain " },
      { insert: "bold", attributes: { bold: true } },
      { insert: " and " },
      { insert: "italic", attributes: { italic: true } },
      { insert: "\n" },
    ]);
    assert.equal(
      html,
      "<h2>Heading</h2>\n<p>plain <strong>bold</strong> and <em>italic</em></p>",
    );
  });

  it("groups consecutive list items into one list", () => {
    const html = toHtml([
      { insert: "one" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "two" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "after" },
      { insert: "\n" },
    ]);
    assert.equal(html, "<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<p>after</p>");
  });

  it("does not let an ordered list swallow a bulleted one at the same depth", () => {
    const html = toHtml([
      { insert: "a" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "b" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);
    assert.equal(html, "<ol>\n<li>a</li>\n</ol>\n<ul>\n<li>b</li>\n</ul>");
  });

  it("nests an indented item and closes it again", () => {
    const html = toHtml([
      { insert: "top" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "nested" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
      { insert: "back" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);
    assert.equal(
      html,
      "<ul>\n<li>top</li>\n<ul>\n<li>nested</li>\n</ul>\n<li>back</li>\n</ul>",
    );
  });

  it("escapes text and refuses an address that is not a link", () => {
    const html = toHtml([
      { insert: "<script>alert(1)</script>" },
      { insert: "click", attributes: { link: "javascript:alert(1)" } },
      { insert: "ok", attributes: { link: "https://example.com" } },
      { insert: "\n" },
    ]);
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("javascript:"));
    assert.ok(html.includes('<a href="https://example.com"'));
  });

  it("refuses anything but a plain value inside a style attribute", () => {
    const html = toHtml([
      { insert: "x", attributes: { color: "url(javascript:alert(1))" } },
      { insert: "y", attributes: { color: "#ff0000" } },
      { insert: "\n" },
    ]);
    assert.ok(!html.includes("url("));
    assert.ok(html.includes("color:inherit"));
    assert.ok(html.includes("color:#ff0000"));
  });

  it("keeps our own pictures and drops the ones we would not serve", () => {
    const html = toHtml([
      { insert: { image: `/uploads/${"a".repeat(64)}.png` } },
      { insert: { image: "data:image/png;base64,AAAA" } },
      { insert: "\n" },
    ]);
    assert.ok(html.includes(`<img src="/uploads/${"a".repeat(64)}.png">`));
    assert.ok(!html.includes("data:"));
  });
});

describe("Markdown export", () => {
  it("renders the ordinary blocks", () => {
    const md = toMarkdown([
      { insert: "Title" },
      { insert: "\n", attributes: { header: 1 } },
      { insert: "some " },
      { insert: "bold", attributes: { bold: true } },
      { insert: "\n" },
      { insert: "quoted" },
      { insert: "\n", attributes: { blockquote: true } },
      { insert: "one" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "two" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);
    assert.equal(md, "# Title\nsome **bold**\n> quoted\n- one\n1. two\n");
  });

  it("fences a code block once, not once per line", () => {
    const md = toMarkdown([
      { insert: "const a = 1;" },
      { insert: "\n", attributes: { "code-block": true } },
      { insert: "const b = 2;" },
      { insert: "\n", attributes: { "code-block": true } },
      { insert: "after" },
      { insert: "\n" },
    ]);
    assert.equal(md, "```\nconst a = 1;\nconst b = 2;\n```\nafter\n");
  });

  it("does not format inside a code block", () => {
    const md = toMarkdown([
      { insert: "*not bold*", attributes: { bold: true } },
      { insert: "\n", attributes: { "code-block": true } },
    ]);
    assert.equal(md, "```\n*not bold*\n```\n");
  });

  it("escapes characters that would otherwise start a construct", () => {
    const md = toMarkdown([
      { insert: "# not a heading" },
      { insert: "\n" },
      { insert: "a * b _ c" },
      { insert: "\n" },
    ]);
    assert.equal(md, "\\# not a heading\na \\* b \\_ c\n");
  });

  it("writes links and pictures, and drops unsafe addresses", () => {
    const md = toMarkdown([
      { insert: "site", attributes: { link: "https://example.com" } },
      { insert: "bad", attributes: { link: "javascript:alert(1)" } },
      { insert: { image: `/uploads/${"b".repeat(64)}.webp` } },
      { insert: "\n" },
    ]);
    assert.equal(md, `[site](https://example.com)bad![](/uploads/${"b".repeat(64)}.webp)\n`);
  });
});
