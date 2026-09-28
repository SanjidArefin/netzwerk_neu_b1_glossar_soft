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
      searchText: GlossaryModel.normalizeForSearch(`${entry.word} ${entry.meaning}`),
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
