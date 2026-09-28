const assert = require("node:assert/strict");
const test = require("node:test");
const { getGlossary } = require("../backend/glossary-service");
const GlossaryModel = require("../frontend/glossary-model");

const CHAPTER_COUNTS = [679, 548, 892, 588, 587, 838, 636, 705, 929, 612, 716, 1705];

function flattenGlossary(glossary) {
  return glossary.chapters.flatMap((chapter) => (
    chapter.entries.map((entry) => ({
      ...entry,
      chapter: chapter.number,
    }))
  ));
}

test("bundled glossary has every verified chapter and entry", () => {
  const glossary = getGlossary();

  assert.equal(glossary.chapters.length, 12);
  assert.equal(glossary.totalEntries, 9435);
  assert.deepEqual(
    glossary.chapters.map((chapter) => chapter.entries.length),
    CHAPTER_COUNTS,
  );

  for (const chapter of glossary.chapters) {
    const words = chapter.entries.map((entry) => entry.word);

    assert.equal(new Set(words).size, words.length);
    assert.ok(chapter.entries.every((entry) => !/[,;/]/.test(entry.meaning)));
  }
});

test("search accepts German and transliterated spellings", () => {
  const entries = flattenGlossary(getGlossary());
  const direct = GlossaryModel.filterEntries(entries, { query: "abhängen" });
  const transliterated = GlossaryModel.filterEntries(entries, { query: "abhaengen" });
  const english = GlossaryModel.filterEntries(entries, { query: "training" });

  assert.ok(direct.some((entry) => entry.word === "abhängen"));
  assert.ok(transliterated.some((entry) => entry.word === "abhängen"));
  assert.ok(english.some((entry) => entry.word === "ausbildung"));
});

test("chapter filtering and alphabetical sorting are stable", () => {
  const entries = flattenGlossary(getGlossary());
  const chapterThree = GlossaryModel.filterEntries(entries, { chapter: 3 });
  const collator = new Intl.Collator("de-DE", { sensitivity: "base" });

  assert.equal(chapterThree.length, 892);
  assert.ok(chapterThree.every((entry) => entry.chapter === 3));
  assert.ok(chapterThree.every((entry, index) => (
    index === 0 || collator.compare(chapterThree[index - 1].word, entry.word) <= 0
  )));
});

test("entries stay alphabetical regardless of the alphabet-order toggle", () => {
  const entries = flattenGlossary(getGlossary());
  const collator = new Intl.Collator("de-DE", { sensitivity: "base" });
  const first = GlossaryModel.filterEntries(entries, { chapter: 1 });
  const second = GlossaryModel.filterEntries(entries, { chapter: 1, sortOrder: "desc" });

  // sortOrder is no longer part of the model API: passing it must be ignored.
  assert.deepEqual(second.map((entry) => entry.word), first.map((entry) => entry.word));
  assert.ok(first.every((entry, index) => (
    index === 0 || collator.compare(first[index - 1].word, entry.word) <= 0
  )));
});

test("scoring ranks relevance tiers from exact matches down to contains hits", () => {
  const entry = { word: "abend", meaning: "evening" };

  assert.equal(GlossaryModel.calculateScore(entry, "abend"), 100);
  assert.equal(GlossaryModel.calculateScore(entry, "aben"), 80);
  assert.equal(GlossaryModel.calculateScore(entry, "eve"), 60);
  assert.equal(GlossaryModel.calculateScore(entry, "end"), 40);
  assert.equal(GlossaryModel.calculateScore(entry, "ning"), 20);
  assert.equal(GlossaryModel.calculateScore(entry, "zoo"), 0);
  assert.equal(GlossaryModel.calculateScore(entry, ""), 0);
});

test("relevance search puts German words before weaker substring hits", () => {
  const entries = flattenGlossary(getGlossary());
  const results = GlossaryModel.filterEntries(entries, { query: "era" });
  const startsWith = results.findIndex((entry) => entry.word.toLowerCase().startsWith("era"));
  const containsOnly = results.findIndex((entry) => (
    !entry.word.toLowerCase().startsWith("era") && entry.word.toLowerCase().includes("era")
  ));

  assert.ok(startsWith !== -1, "expected a German word starting with 'era'");
  assert.ok(containsOnly === -1 || startsWith < containsOnly, "starts-with must rank above contains");
  assert.ok(results.some((entry) => entry.meaning.toLowerCase().includes("operational")));

  // Every result must actually match, and scores must never increase down the list.
  const scores = results.map((entry) => GlossaryModel.calculateScore(entry, "era"));

  assert.ok(scores.every((score) => score > 0));
  assert.ok(scores.every((score, index) => index === 0 || scores[index - 1] >= score));
});

test("typo tolerance finds words with one mistyped letter", () => {
  const entries = flattenGlossary(getGlossary());
  const results = GlossaryModel.filterEntries(entries, { query: "abnd" });

  assert.ok(results.some((entry) => entry.word === "abend"));
  // The fuzzy hit must rank below real prefix matches of the same length.
  const fuzzyIndex = results.findIndex((entry) => entry.word === "abend");
  const strictIndex = results.findIndex((entry) => entry.word.toLowerCase().startsWith("abnd"));

  assert.ok(strictIndex === -1 || strictIndex < fuzzyIndex);

  // Short queries stay strict: "abm" must not drag in "abend".
  assert.ok(!GlossaryModel.filterEntries(entries, { query: "abm" }).some((entry) => entry.word === "abend"));
});

test("an empty query returns every entry sorted A-Z", () => {
  const entries = flattenGlossary(getGlossary());
  const collator = new Intl.Collator("de-DE", { sensitivity: "base" });
  const results = GlossaryModel.filterEntries(entries, { query: "   " });

  assert.equal(results.length, entries.length);
  assert.ok(results.every((entry, index) => (
    index === 0 || collator.compare(results[index - 1].word, entry.word) <= 0
  )));
});

test("match ranges cover every occurrence and map back through umlauts", () => {
  const ranges = (entry, property, query) => (
    GlossaryModel.findMatchRanges(entry, property, GlossaryModel.normalizeForSearch(query))
  );

  // Plain substring hits, including repeated occurrences.
  assert.deepEqual(ranges({ word: "erarbeiten", meaning: "" }, "word", "er"), [[0, 2]]);

  // "abhaengen" is eight result characters over seven source characters: the
  // highlight must cover the original "abhäng", not six letters of it.
  assert.deepEqual(ranges({ word: "abhängen", meaning: "" }, "word", "abhaenge"), [[0, 7]]);
  assert.deepEqual(ranges({ word: "abhängen", meaning: "" }, "word", "ab"), [[0, 2]]);

  // A fuzzy hit has no literal occurrence, so the attempted prefix is marked.
  assert.deepEqual(ranges({ word: "abend", meaning: "" }, "word", "abnd"), [[0, 4]]);

  // No match, no highlight.
  assert.deepEqual(ranges({ word: "abend", meaning: "" }, "word", "zoo"), []);
});

test("relevance search stays fast across the whole glossary", () => {
  const entries = flattenGlossary(getGlossary());
  const started = performance.now();

  GlossaryModel.filterEntries(entries, { query: "abnd" });
  GlossaryModel.filterEntries(entries, { query: "era" });
  GlossaryModel.filterEntries(entries, { query: "betrieb" });

  // Fuzzy scoring runs over all ~9400 entries on every debounced keystroke.
  assert.ok(performance.now() - started < 1500, "three searches should not take seconds");
});
