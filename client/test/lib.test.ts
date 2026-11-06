import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidElement, type ReactElement } from "react";
import { EMPTY_FORM, firstError, parseSkills, stepError } from "../src/lib/agentForm";
import { shortAddress, sumHbar } from "../src/lib/format";
import { parseMarkdown, renderInline } from "../src/lib/markdown";
import { parseRoute } from "../src/lib/router";

describe("Create Agent form rules", () => {
  const good = { name: "Market Scout", description: "Finds prices.", category: "research", skills: ["pricing"], price: "0.05" };

  it("accepts a good form", () => {
    assert.equal(firstError(good), null);
  });

  it("blocks an empty name and 9 skills with clear messages (PHASES.md B7 test 4)", () => {
    assert.equal(stepError("name", { ...good, name: "" }), "The name must be at least 3 characters.");
    const nine = parseSkills("a, b, c, d, e, f, g, h, i");
    assert.equal(nine.length, 9);
    assert.equal(stepError("skills", { ...good, skills: nine }), "Use at most 6 skills.");
    assert.equal(stepError("review", { ...good, name: "" }), "The name must be at least 3 characters.");
  });

  it("checks description, category, skills and price like the server does", () => {
    assert.match(stepError("description", { ...good, description: "x".repeat(281) }) ?? "", /280/);
    assert.equal(stepError("category", { ...good, category: "hacking" }), "Choose a category.");
    assert.match(stepError("skills", { ...good, skills: ["Pricing", "pricing"] }) ?? "", /only once/);
    assert.match(stepError("skills", { ...good, skills: ["x".repeat(25)] }) ?? "", /24/);
    for (const bad of ["", "0", "abc", "1.123456789", "-1", "1001"]) {
      assert.ok(stepError("price", { ...good, price: bad }), `price ${JSON.stringify(bad)} should be refused`);
    }
    assert.equal(stepError("price", { ...good, price: "0.00000001" }), null);
    assert.ok(firstError(EMPTY_FORM));
  });
});

describe("Markdown rendering", () => {
  it("parses headings, lists, tables and paragraphs", () => {
    const blocks = parseMarkdown("# Title\n\nSome **bold** text\ncontinues.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["heading", "paragraph", "list", "table"],
    );
    const table = blocks[3];
    if (table?.type !== "table") throw new Error("expected a table");
    assert.deepEqual(table.header, ["A", "B"]);
    assert.deepEqual(table.rows, [["1", "2"]]);
  });

  it("never turns model output into HTML or script links", () => {
    const nodes = renderInline('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://example.com)');
    // Raw HTML stays a plain string; it is rendered as text, not markup.
    assert.equal(typeof nodes[0], "string");
    assert.match(nodes[0] as string, /<img/);
    const links = nodes.filter((n): n is ReactElement<{ href?: string }> => isValidElement(n) && n.type === "a");
    assert.deepEqual(
      links.map((l) => l.props.href),
      ["https://example.com"],
    );
    assert.ok(nodes.includes("click"), "a javascript: link is shown as its text only");
  });
});

describe("format and routes", () => {
  it("shortens addresses and sums HBAR exactly", () => {
    assert.equal(shortAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234...5678");
    assert.equal(sumHbar(["0.05", "0.03", "0.02", "0.01"]), "0.11");
    assert.equal(sumHbar(["0.1", "0.2"]), "0.3");
  });

  it("parses hash routes", () => {
    assert.deepEqual(parseRoute(""), { page: "home" });
    assert.deepEqual(parseRoute("#/marketplace"), { page: "marketplace" });
    assert.deepEqual(parseRoute("#/tasks/new"), { page: "new-task" });
    assert.deepEqual(parseRoute("#/tasks/3f1c9a52-0000-4000-8000-000000000001"), {
      page: "task",
      id: "3f1c9a52-0000-4000-8000-000000000001",
    });
    assert.deepEqual(parseRoute("#/tasks/../../etc"), { page: "not-found" });
  });
});
