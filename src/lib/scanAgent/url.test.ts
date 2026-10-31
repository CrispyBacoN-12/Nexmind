import { test } from "node:test";
import assert from "node:assert/strict";
import { safeHttpUrl } from "./url";

test("http and https become links", () => {
  assert.equal(safeHttpUrl("https://finnhub.io/x?a=1"), "https://finnhub.io/x?a=1");
  assert.equal(safeHttpUrl("http://example.com/a"), "http://example.com/a");
});

test("every other scheme, relative or broken URL is not a link", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "file:///etc/passwd",
    "ftp://example.com",
    "//example.com/x",
    "/relative/path",
    "not a url",
    "",
  ]) {
    assert.equal(safeHttpUrl(bad), null, bad);
  }
});
