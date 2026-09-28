(function exposeGlossaryModel(globalScope) {
  function normalizeForSearch(value) {
    return value
      .toLocaleLowerCase("de-DE")
      .replaceAll("\u00e4", "ae")
      .replaceAll("\u00f6", "oe")
      .replaceAll("\u00fc", "ue")
      .replaceAll("\u00df", "ss");
  }

  // The word list is always alphabetical (A-Z). The alphabet-order toggle in the
  // right rail only reorders the letter buttons, never these entries.
  function sortEntries(entries) {
    return [...entries].sort((left, right) => (
      left.word.localeCompare(right.word, "de-DE", { sensitivity: "base" })
      || left.chapter - right.chapter
    ));
  }

  function filterEntries(entries, { chapter = "all", query = "" } = {}) {
    const normalizedQuery = normalizeForSearch(query.trim());

    return sortEntries(entries.filter((entry) => (
      (chapter === "all" || entry.chapter === chapter)
      && (!normalizedQuery || entry.searchText.includes(normalizedQuery))
    )));
  }

  const glossaryModel = {
    filterEntries,
    normalizeForSearch,
    sortEntries,
  };

  if (typeof module !== "undefined") {
    module.exports = glossaryModel;
  }

  globalScope.GlossaryModel = glossaryModel;
}(typeof window === "undefined" ? globalThis : window));
