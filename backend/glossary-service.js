const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const SEED_FILE = path.join(__dirname, "data", "glossary.json");

const MAX_WORD_LENGTH = 80;
const MAX_MEANING_LENGTH = 160;

// The bundled seed data deliberately avoids this punctuation.
const FORBIDDEN_MEANING_CHARACTERS = /[,;/]/;

// A single shared collator keeps sorting identical to the bundled data.
const collator = new Intl.Collator("de-DE", { sensitivity: "base" });

function isSorted(entries) {
  return entries.every((entry, index) => (
    index === 0 || collator.compare(entries[index - 1].word, entry.word) <= 0
  ));
}

function validateGlossary(glossary) {
  if (!glossary || !Array.isArray(glossary.chapters)) {
    throw new Error("Glossary data does not contain chapters.");
  }

  const entries = [];

  for (const chapter of glossary.chapters) {
    if (!Number.isInteger(chapter.number) || !Array.isArray(chapter.entries)) {
      throw new Error("Glossary chapter data is invalid.");
    }

    if (!isSorted(chapter.entries)) {
      throw new Error(`Chapter ${chapter.number} is not alphabetically sorted.`);
    }

    const seenWords = new Set();

    for (const entry of chapter.entries) {
      if (!entry.word || !entry.meaning) {
        throw new Error(`Chapter ${chapter.number} contains an invalid glossary entry.`);
      }

      if (seenWords.has(entry.word)) {
        throw new Error(`Chapter ${chapter.number} contains a duplicate word.`);
      }

      seenWords.add(entry.word);
      entries.push(entry);
    }
  }

  if (glossary.chapters.length !== 12 || entries.length !== glossary.totalEntries) {
    throw new Error("Glossary totals do not match the bundled data.");
  }

  return glossary;
}

/**
 * Resolves the writable glossary file.
 *
 * The bundled seed file lives inside the app bundle, which is read-only when
 * packaged. User edits therefore go to the Electron user data directory, seeded
 * from the bundle on first run. Outside Electron (tests, scripts) the bundled
 * file is used directly.
 */
function getWriteFile() {
  if (!app || typeof app.getPath !== "function") {
    return SEED_FILE;
  }

  const userDataFile = path.join(app.getPath("userData"), "glossary.json");

  if (!fs.existsSync(userDataFile)) {
    fs.mkdirSync(path.dirname(userDataFile), { recursive: true });
    fs.copyFileSync(SEED_FILE, userDataFile);
  }

  return userDataFile;
}

function recomputeTotal(glossary) {
  glossary.totalEntries = glossary.chapters.reduce(
    (total, chapter) => total + chapter.entries.length,
    0,
  );

  return glossary;
}

function getGlossary() {
  return validateGlossary(JSON.parse(fs.readFileSync(getWriteFile(), "utf8")));
}

function writeGlossary(glossary) {
  const target = getWriteFile();
  const temporary = `${target}.tmp`;

  // Write to a sibling file first so a crash mid-write cannot truncate the data.
  fs.writeFileSync(temporary, `${JSON.stringify(glossary, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

/**
 * Splits a composite "<chapter>-<word>" id. Only the first hyphen is treated as
 * the separator because words themselves may contain hyphens (e.g. "e-mail").
 */
function parseEntryId(entryId) {
  const value = String(entryId ?? "");
  const separator = value.indexOf("-");

  if (separator === -1) {
    return null;
  }

  const chapter = Number(value.slice(0, separator));
  const word = value.slice(separator + 1);

  if (!Number.isInteger(chapter) || !word) {
    return null;
  }

  return { chapter, word };
}

function normalizeWord(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function addEntry(chapterNumber, word, meaning) {
  const glossary = getGlossary();
  const chapter = glossary.chapters.find((item) => item.number === Number(chapterNumber));

  if (!chapter) {
    throw new Error(`Chapter ${chapterNumber} does not exist.`);
  }

  const cleanWord = normalizeWord(word);
  const cleanMeaning = normalizeWord(meaning);

  if (!cleanWord || !cleanMeaning) {
    throw new Error("Word and meaning must not be empty.");
  }

  if (cleanWord.length > MAX_WORD_LENGTH || cleanMeaning.length > MAX_MEANING_LENGTH) {
    throw new Error("The word or meaning is too long.");
  }

  if (FORBIDDEN_MEANING_CHARACTERS.test(cleanMeaning)) {
    throw new Error("The meaning must not contain commas, semicolons or slashes.");
  }

  const lowered = cleanWord.toLocaleLowerCase("de-DE");
  const duplicate = glossary.chapters.some((item) => (
    item.entries.some((entry) => entry.word.toLocaleLowerCase("de-DE") === lowered)
  ));

  if (duplicate) {
    throw new Error(`"${cleanWord}" is already in the glossary.`);
  }

  chapter.entries.push({ word: cleanWord, meaning: cleanMeaning });
  chapter.entries.sort((left, right) => collator.compare(left.word, right.word));
  recomputeTotal(glossary);
  writeGlossary(glossary);

  return glossary;
}

/**
 * Replaces the meaning of an existing entry.
 *
 * The word and chapter are the entry's identity and cannot change here, so the
 * chapter's alphabetical order and the entry total are unaffected.
 */
function updateEntry(chapterNumber, word, newMeaning) {
  const glossary = getGlossary();
  const chapter = glossary.chapters.find((item) => item.number === Number(chapterNumber));

  if (!chapter) {
    throw new Error(`Chapter ${chapterNumber} does not exist.`);
  }

  const cleanWord = normalizeWord(word);
  const cleanMeaning = normalizeWord(newMeaning);

  if (!cleanWord || !cleanMeaning) {
    throw new Error("Word and meaning must not be empty.");
  }

  if (cleanMeaning.length > MAX_MEANING_LENGTH) {
    throw new Error("The meaning is too long.");
  }

  if (FORBIDDEN_MEANING_CHARACTERS.test(cleanMeaning)) {
    throw new Error("The meaning must not contain commas, semicolons or slashes.");
  }

  const entry = chapter.entries.find((item) => item.word === cleanWord);

  if (!entry) {
    throw new Error(`"${cleanWord}" was not found in chapter ${chapterNumber}.`);
  }

  entry.meaning = cleanMeaning;
  writeGlossary(glossary);

  return glossary;
}

function deleteEntries(entryIds) {
  const targets = (Array.isArray(entryIds) ? entryIds : [entryIds])
    .map(parseEntryId)
    .filter(Boolean);

  if (!targets.length) {
    throw new Error("No valid entries were selected for deletion.");
  }

  const glossary = getGlossary();
  let removed = 0;

  for (const target of targets) {
    const chapter = glossary.chapters.find((item) => item.number === target.chapter);

    if (!chapter) {
      continue;
    }

    const index = chapter.entries.findIndex((entry) => entry.word === target.word);

    if (index === -1) {
      continue;
    }

    chapter.entries.splice(index, 1);
    removed += 1;
  }

  if (!removed) {
    throw new Error("The selected entries were not found.");
  }

  recomputeTotal(glossary);
  writeGlossary(glossary);

  return glossary;
}

module.exports = {
  addEntry,
  deleteEntries,
  getGlossary,
  updateEntry,
  validateGlossary,
};
