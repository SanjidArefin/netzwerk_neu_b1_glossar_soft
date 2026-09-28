(function exposeGlossaryModel(globalScope) {
  const UMLAUT_EXPANSIONS = {
    "\u00e4": "ae",
    "\u00f6": "oe",
    "\u00fc": "ue",
    "\u00df": "ss",
  };

  // Lower-cases and expands umlauts one character at a time, remembering which
  // source character produced each result character. "abhängen" becomes
  // "abhaengen", and index 2 of the result maps back to index 1 of the source,
  // which is what lets the renderer highlight the right letters.
  function normalizeWithMap(value) {
    let text = "";
    const sources = [];

    for (let index = 0; index < value.length; index += 1) {
      const lower = value[index].toLocaleLowerCase("de-DE");
      const expanded = UMLAUT_EXPANSIONS[lower] || lower;

      for (let offset = 0; offset < expanded.length; offset += 1) {
        sources.push(index);
      }

      text += expanded;
    }

    return { text, sources };
  }

  function normalizeForSearch(value) {
    return normalizeWithMap(value).text;
  }

  // The word list is always alphabetical (A-Z). The alphabet-order toggle in the
  // right rail only reorders the letter buttons, never these entries.
  function sortEntries(entries) {
    return [...entries].sort(compareAlphabetically);
  }

  function compareAlphabetically(left, right) {
    return left.word.localeCompare(right.word, "de-DE", { sensitivity: "base" })
      || left.chapter - right.chapter;
  }

  // Bounded Levenshtein: stops as soon as a row proves the result can never
  // beat maxDistance, which keeps typo checks cheap across ~9000 entries.
  function levenshteinDistance(left, right, maxDistance) {
    if (left === right) {
      return 0;
    }

    if (Math.abs(left.length - right.length) > maxDistance) {
      return maxDistance + 1;
    }

    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

    for (let index = 1; index <= left.length; index += 1) {
      const current = [index];
      let rowMinimum = index;

      for (let other = 1; other <= right.length; other += 1) {
        const cost = left[index - 1] === right[other - 1] ? 0 : 1;

        current[other] = Math.min(
          current[other - 1] + 1,
          previous[other] + 1,
          previous[other - 1] + cost,
        );
        rowMinimum = Math.min(rowMinimum, current[other]);
      }

      if (rowMinimum > maxDistance) {
        return maxDistance + 1;
      }

      previous = current;
    }

    return previous[right.length];
  }

  // Shortest distance between the query and any leading slice of the field. A
  // typo anywhere in the typed text still lands on the word's prefix, so this
  // finds "abend" from "abnd" without scanning every substring of every entry.
  function prefixDistance(query, field, maxDistance) {
    let best = maxDistance + 1;

    for (
      let length = Math.max(1, query.length - maxDistance);
      length <= query.length + maxDistance;
      length += 1
    ) {
      best = Math.min(best, levenshteinDistance(query, field.slice(0, length), maxDistance));

      if (best === 0) {
        return 0;
      }
    }

    return best;
  }

  // Normalising a German word is not free, and the same entry is scored on
  // every keystroke, so the text plus its index map are memoised on the entry.
  // Entries are rebuilt whenever the glossary is (re)loaded, which resets the
  // cache. Non-enumerable so it never leaks into saved data.
  function normalizedField(entry, property) {
    const cacheKey = `_normalized${property[0].toUpperCase()}${property.slice(1)}`;

    if (!entry[cacheKey]) {
      Object.defineProperty(entry, cacheKey, {
        value: normalizeWithMap(entry[property]),
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }

    return entry[cacheKey];
  }

  // Relevance tiers. Higher wins; 0 means "not a match" and is filtered out.
  const SCORES = {
    exactWord: 100,
    wordStartsWith: 80,
    meaningStartsWith: 60,
    wordContains: 40,
    meaningContains: 20,
    // Fuzzy tiers sit just under their strict counterpart and lose 5 per typo,
    // so they can never tie with (or outrank) an exact substring hit.
    fuzzyWord: 75,
    fuzzyMeaning: 55,
  };

  function calculateScore(entry, normalizedQuery) {
    if (!normalizedQuery) {
      // Empty queries are handled by filterEntries (everything matches, sorted
      // A-Z), so nothing here should look like a scored match.
      return 0;
    }

    const word = normalizedField(entry, "word").text;
    const meaning = normalizedField(entry, "meaning").text;

    if (word === normalizedQuery) {
      return SCORES.exactWord;
    }

    if (word.startsWith(normalizedQuery)) {
      return SCORES.wordStartsWith;
    }

    if (meaning.startsWith(normalizedQuery)) {
      return SCORES.meaningStartsWith;
    }

    if (word.includes(normalizedQuery)) {
      return SCORES.wordContains;
    }

    if (meaning.includes(normalizedQuery)) {
      return SCORES.meaningContains;
    }

    // Typos only get a chance once every substring test has failed, and short
    // queries are far too ambiguous to fuzzy-match.
    if (normalizedQuery.length < 4) {
      return 0;
    }

    const maxTypos = normalizedQuery.length >= 7 ? 2 : 1;
    const wordDistance = prefixDistance(normalizedQuery, word, maxTypos);

    if (wordDistance <= maxTypos) {
      return SCORES.fuzzyWord - wordDistance * 5;
    }

    const meaningDistance = prefixDistance(normalizedQuery, meaning, maxTypos);

    if (meaningDistance <= maxTypos) {
      return SCORES.fuzzyMeaning - meaningDistance * 5;
    }

    return 0;
  }

  function filterEntries(entries, { chapter = "all", query = "" } = {}) {
    const normalizedQuery = normalizeForSearch(query.trim());
    const inChapter = entries.filter((entry) => chapter === "all" || entry.chapter === chapter);

    if (!normalizedQuery) {
      return sortEntries(inChapter);
    }

    return inChapter
      .map((entry) => ({ entry, score: calculateScore(entry, normalizedQuery) }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || compareAlphabetically(left.entry, right.entry))
      .map((match) => match.entry);
  }

  // Character ranges of `text` that the query matched, for highlighting. Exact
  // and substring hits highlight every occurrence; a fuzzy hit has no literal
  // occurrence, so the mismatched prefix is highlighted instead.
  function findMatchRanges(entry, property, normalizedQuery) {
    if (!normalizedQuery) {
      return [];
    }

    const { text, sources } = normalizedField(entry, property);
    const ranges = [];
    let index = text.indexOf(normalizedQuery);

    while (index !== -1) {
      ranges.push([sources[index], sources[index + normalizedQuery.length - 1] + 1]);
      index = text.indexOf(normalizedQuery, index + normalizedQuery.length);
    }

    if (ranges.length || normalizedQuery.length < 4) {
      return ranges;
    }

    const maxTypos = normalizedQuery.length >= 7 ? 2 : 1;

    if (prefixDistance(normalizedQuery, text, maxTypos) > maxTypos) {
      return [];
    }

    const length = Math.min(text.length, normalizedQuery.length);

    return length ? [[0, sources[length - 1] + 1]] : [];
  }

  const glossaryModel = {
    calculateScore,
    filterEntries,
    findMatchRanges,
    levenshteinDistance,
    normalizeForSearch,
    sortEntries,
  };

  if (typeof module !== "undefined") {
    module.exports = glossaryModel;
  }

  globalScope.GlossaryModel = glossaryModel;
}(typeof window === "undefined" ? globalThis : window));
