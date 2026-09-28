const state = {
  entries: [],
  chapters: [],
  chapter: "all",
  query: "",
  selectedId: null,
  isBatchDeleting: false,
  batchSelectedIds: [],
  alphabetOrder: "asc",
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  toggleLeftSidebar: document.querySelector("#toggle-left-sidebar"),
  chapterTabs: document.querySelector("#chapter-tabs"),
  allChapterButton: document.querySelector('[data-chapter="all"]'),
  allCount: document.querySelector("#all-count"),
  totalCount: document.querySelector("#total-count"),
  chapterLabel: document.querySelector("#chapter-label"),
  pageTitle: document.querySelector("#page-title"),
  searchInput: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
  umlautToolbar: document.querySelector(".umlaut-toolbar"),
  resultCount: document.querySelector("#result-count"),
  wordListPanel: document.querySelector(".word-list-panel"),
  listHeader: document.querySelector(".list-header"),
  alphabetJump: document.querySelector("#alphabet-jump"),
  alphabetButtons: document.querySelector("#alphabet-buttons"),
  alphabetCount: document.querySelector("#alphabet-count"),
  sortToggle: document.querySelector("#sort-toggle"),
  wordList: document.querySelector("#word-list"),
  loadStatus: document.querySelector("#load-status"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  addWordBtn: document.querySelector("#add-word-btn"),
  editWordBtn: document.querySelector("#edit-word-btn"),
  deleteWordBtn: document.querySelector("#delete-word-btn"),
  batchDeleteBtn: document.querySelector("#batch-delete-btn"),
  cancelBatchBtn: document.querySelector("#cancel-batch-btn"),
  wordModal: document.querySelector("#word-modal"),
  wordForm: document.querySelector("#word-form"),
  cancelWordBtn: document.querySelector("#cancel-word-btn"),
  modalMode: document.querySelector("#modal-mode"),
  modalTitle: document.querySelector("#word-modal-title"),
  modalChapter: document.querySelector("#modal-chapter"),
  modalWord: document.querySelector("#modal-word"),
  modalMeaning: document.querySelector("#modal-meaning"),
  modalError: document.querySelector("#modal-error"),
};

const GERMAN_ALPHABET = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "Ä", "Ö", "Ü",
];

function applyTheme(theme) {
  const selectedTheme = theme === "dark" ? "dark" : "light";
  const isDark = selectedTheme === "dark";

  document.documentElement.dataset.theme = selectedTheme;
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
  const themeLabel = isDark ? "Enable light mode" : "Enable dark mode";
  elements.themeToggle.setAttribute("aria-label", themeLabel);
  elements.themeToggle.setAttribute("title", themeLabel);
  elements.themeToggle.querySelector(".theme-toggle-icon").innerHTML = isDark
    ? "&#9728;"
    : "&#9790;";
  elements.themeColor.setAttribute("content", isDark ? "#131f24" : "#ffffff");

  try {
    localStorage.setItem("b1-glossar-theme", selectedTheme);
  } catch {
    // The app remains usable when persistent storage is unavailable.
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
}

function chapterName(chapter) {
  return `Chapter ${chapter}`;
}

// Trailing-edge debounce. Exposes cancel() so an immediate action (clearing the
// search, switching chapters) can drop a render that is still waiting to fire.
function debounce(func, wait) {
  let timeout;

  const debounced = (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = undefined;
      func(...args);
    }, wait);
  };

  debounced.cancel = () => clearTimeout(timeout);

  return debounced;
}

// Wraps the ranges reported by the model in <mark>. The text is escaped piece by
// piece, so no unescaped query ever reaches innerHTML.
function highlightField(value, ranges) {
  if (!ranges.length) {
    return escapeHtml(value);
  }

  const merged = [];

  for (const range of [...ranges].sort((left, right) => left[0] - right[0])) {
    const last = merged[merged.length - 1];

    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  let html = "";
  let cursor = 0;

  for (const [start, end] of merged) {
    // Merging already guarantees ascending, non-overlapping ranges; this only
    // guards against a zero-length one. Note that start === cursor === 0 is a
    // legitimate match at the very beginning of the word, so it must not skip.
    if (end <= cursor) {
      continue;
    }

    html += escapeHtml(value.slice(cursor, start));
    html += `<mark>${escapeHtml(value.slice(start, end))}</mark>`;
    cursor = end;
  }

  return html + escapeHtml(value.slice(cursor));
}

function normalizedQuery() {
  return GlossaryModel.normalizeForSearch(state.query.trim());
}

function entriesForCurrentView() {
  return GlossaryModel.filterEntries(state.entries, {
    chapter: state.chapter,
    query: state.query,
  });
}

function renderChapterTabs() {
  elements.chapterTabs.innerHTML = state.chapters.map((chapter) => {
    const isActive = state.chapter === chapter.number;
    // The collapsed rail hides the label, so the tooltip carries the full name.
    const fullTitle = `${chapterName(chapter.number)} (${chapter.entries.length} entries)`;

    return `
      <button class="chapter-tab${isActive ? " is-active" : ""}" type="button"
        data-chapter="${chapter.number}" aria-pressed="${isActive}"
        title="${fullTitle}">
        <span>${chapterName(chapter.number)}</span>
        <span class="tab-count">${chapter.entries.length}</span>
      </button>
    `;
  }).join("");

  const allActive = state.chapter === "all";
  elements.allChapterButton.classList.toggle("is-active", allActive);
  elements.allChapterButton.setAttribute("aria-pressed", String(allActive));
  elements.allCount.textContent = state.entries.length;
  elements.totalCount.textContent = state.entries.length;
}

function renderHeader(visibleEntries) {
  elements.chapterLabel.textContent = state.chapter === "all"
    ? "All Chapters"
    : chapterName(state.chapter);
  elements.pageTitle.textContent = state.query.trim() ? "Search Results" : "Vocabulary";
  elements.resultCount.textContent = `${visibleEntries.length} ${visibleEntries.length === 1 ? "entry" : "entries"}`;
  elements.clearSearch.hidden = !state.query;
}

function ensureSelected(visibleEntries) {
  // Deliberately does not auto-select a row: leaving selectedId null at startup
  // is what lets "Remove Word" enter batch mode when nothing is chosen.
  if (state.selectedId && !visibleEntries.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = null;
  }
}

function renderWordList(visibleEntries) {
  elements.wordListPanel.classList.toggle("is-batch", state.isBatchDeleting);

  if (!visibleEntries.length) {
    elements.wordList.innerHTML = '<div class="empty-state">No matching words found.</div>';
    return;
  }

  const query = normalizedQuery();
  // Relevance order is not alphabetical, so the A–Z section headings only make
  // sense when the full list is shown.
  const showHeadings = !query;
  let lastLetter = "";
  const rows = [];

  for (const entry of visibleEntries) {
    const letter = entry.word.slice(0, 1).toLocaleUpperCase("de-DE");

    if (showHeadings && letter !== lastLetter) {
      rows.push(`<div class="letter-heading" data-letter="${escapeHtml(letter)}" aria-hidden="true">${escapeHtml(letter)}</div>`);
    }

    lastLetter = letter;

    const isChecked = state.batchSelectedIds.includes(entry.id);
    const checkbox = state.isBatchDeleting
      ? `<input class="select-checkbox" type="checkbox" data-select-id="${escapeHtml(entry.id)}"
          aria-label="Select ${escapeHtml(entry.word)}"${isChecked ? " checked" : ""}>`
      : "";

    rows.push(`
      <div class="word-row${entry.id === state.selectedId ? " is-selected" : ""}"
        role="option" tabindex="0" aria-selected="${entry.id === state.selectedId}"
        data-entry-id="${escapeHtml(entry.id)}">
        ${checkbox}
        <span class="word-name">${highlightField(entry.word, query ? GlossaryModel.findMatchRanges(entry, "word", query) : [])}</span>
        <span class="word-meaning">${highlightField(entry.meaning, query ? GlossaryModel.findMatchRanges(entry, "meaning", query) : [])}</span>
        <span class="chapter-tag">${chapterName(entry.chapter)}</span>
      </div>
    `);
  }

  elements.wordList.innerHTML = rows.join("");
}

function renderActions() {
  const batchMode = state.isBatchDeleting;

  elements.addWordBtn.classList.toggle("hidden", batchMode);
  elements.editWordBtn.classList.toggle("hidden", batchMode);
  elements.deleteWordBtn.classList.toggle("hidden", batchMode);
  elements.batchDeleteBtn.classList.toggle("hidden", !batchMode);
  elements.cancelBatchBtn.classList.toggle("hidden", !batchMode);

  // Editing requires a concrete selection, so the button mirrors that state.
  elements.editWordBtn.disabled = batchMode || !state.selectedId;

  const count = state.batchSelectedIds.length;

  // Only the label changes: replacing the button's textContent would drop the icon span.
  const batchText = elements.batchDeleteBtn.querySelector(".btn-text");

  if (batchText) {
    batchText.textContent = `Delete Selected (${count})`;
  }

  elements.batchDeleteBtn.title = `Delete Selected (${count})`;
  elements.batchDeleteBtn.disabled = count === 0;
}

function renderAlphabetJump(visibleEntries) {
  const availableLetters = new Set(visibleEntries.map((entry) => (
    entry.word.slice(0, 1).toLocaleUpperCase("de-DE")
  )));

  // Only the letter buttons flip order; the word list itself always stays A-Z.
  const letters = state.alphabetOrder === "desc"
    ? [...GERMAN_ALPHABET].reverse()
    : GERMAN_ALPHABET;

  elements.alphabetButtons.innerHTML = letters.map((letter) => {
    const available = availableLetters.has(letter);
    const status = available ? `Jump to ${letter}` : `No words with ${letter}`;

    return `
      <button class="alphabet-button" type="button" data-letter="${letter}"
        aria-label="${status}" title="${status}"${available ? "" : " disabled"}>
        ${letter}
      </button>
    `;
  }).join("");

  elements.alphabetCount.textContent = String(availableLetters.size);
}


function render() {
  const visibleEntries = entriesForCurrentView();
  ensureSelected(visibleEntries);
  renderChapterTabs();
  renderHeader(visibleEntries);
  renderWordList(visibleEntries);
  renderAlphabetJump(visibleEntries);
  renderActions();
  renderSortToggle();
}

function selectEntry(entryId, focus = false) {
  state.selectedId = entryId;
  render();

  if (focus) {
    const selected = elements.wordList.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`);
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
  }
}

function selectChapter(chapter) {
  state.chapter = chapter === "all" ? "all" : Number(chapter);
  state.selectedId = null;
  render();
  elements.wordListPanel.scrollTop = 0;
}

function applyGlossary(glossary) {
  state.chapters = glossary.chapters;
  state.entries = glossary.chapters.flatMap((chapter) => (
    chapter.entries.map((entry) => ({
      ...entry,
      id: `${chapter.number}-${entry.word}`,
      chapter: chapter.number,
    }))
  ));

  elements.loadStatus.textContent = `${glossary.totalEntries} words`;
}

async function loadGlossary() {
  elements.loadStatus.textContent = "Loading glossary...";

  try {
    applyGlossary(await window.glossaryApi.loadGlossary());
    render();
  } catch (error) {
    console.error(error);
    elements.loadStatus.textContent = "Failed to load glossary";
    elements.wordList.innerHTML = '<div class="empty-state">The glossary data could not be loaded.</div>';
  }
}

elements.chapterTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chapter]");

  if (button) {
    selectChapter(button.dataset.chapter);
  }
});

elements.allChapterButton.addEventListener("click", () => selectChapter("all"));

function runSearch(value) {
  state.query = value;
  state.selectedId = null;
  render();
  elements.wordListPanel.scrollTop = 0;
}

// Fuzzy scoring runs over ~9000 entries, so typing must not re-render on every
// keystroke; the list catches up 250ms after the user pauses.
const applySearchQuery = debounce(runSearch, 250);

elements.searchInput.addEventListener("input", (event) => {
  applySearchQuery(event.target.value);
});

// The toolbar lives inside the search <label>, so a click would otherwise move
// the caret into the label's own text; preventDefault keeps focus on the input.
elements.umlautToolbar.addEventListener("click", (event) => {
  const button = event.target.closest(".umlaut-btn");

  if (!button) {
    return;
  }

  event.preventDefault();

  const input = elements.searchInput;
  const character = button.dataset.char;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;

  input.value = `${input.value.slice(0, start)}${character}${input.value.slice(end)}`;

  const caret = start + character.length;

  input.setSelectionRange(caret, caret);
  input.focus();

  // A button press is deliberate, so render straight away instead of waiting
  // for the typing debounce — and drop anything still queued from keystrokes.
  applySearchQuery.cancel();
  runSearch(input.value);
});

elements.clearSearch.addEventListener("click", () => {
  applySearchQuery.cancel();
  elements.searchInput.value = "";
  state.query = "";
  state.selectedId = null;
  elements.searchInput.focus();
  render();
  elements.wordListPanel.scrollTop = 0;
});

elements.wordList.addEventListener("click", (event) => {
  const checkbox = event.target.closest("[data-select-id]");

  if (checkbox) {
    const id = checkbox.dataset.selectId;

    state.batchSelectedIds = checkbox.checked
      ? [...new Set([...state.batchSelectedIds, id])]
      : state.batchSelectedIds.filter((selectedId) => selectedId !== id);

    renderActions();
    return;
  }

  const row = event.target.closest("[data-entry-id]");

  if (!row) {
    return;
  }

  // Dragging to highlight text inside a row finishes with a click. Re-rendering
  // would wipe that selection, so leave the click alone while it is active.
  const selection = window.getSelection();

  if (selection?.toString() && (row.contains(selection.anchorNode) || row.contains(selection.focusNode))) {
    return;
  }

  selectEntry(row.dataset.entryId);
});

// Rows are focusable divs (a button cannot legally contain a checkbox), so
// Enter/Space must be handled explicitly.
elements.wordList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const row = event.target.closest("[data-entry-id]");

  if (row) {
    event.preventDefault();
    selectEntry(row.dataset.entryId);
  }
});

elements.alphabetJump.addEventListener("click", (event) => {
  const button = event.target.closest("[data-letter]");

  if (!button || button.disabled) {
    return;
  }

  const letter = CSS.escape(button.dataset.letter);
  const target = elements.wordList.querySelector(`.letter-heading[data-letter="${letter}"]`);

  if (target) {
    const targetTop = target.getBoundingClientRect().top
      - elements.wordListPanel.getBoundingClientRect().top
      + elements.wordListPanel.scrollTop;
    const stickyOffset = elements.listHeader.offsetHeight;

    elements.wordListPanel.scrollTo({
      behavior: "auto",
      top: Math.max(0, targetTop - stickyOffset),
    });
  }
});


elements.themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

// --- Sorting -------------------------------------------------------------

const SORT_GLYPHS = { asc: "&#8645;", desc: "&#8646;" };

function renderSortToggle() {
  const label = state.alphabetOrder === "asc" ? "Alphabet list A to Z" : "Alphabet list Z to A";

  elements.sortToggle.innerHTML = SORT_GLYPHS[state.alphabetOrder];
  elements.sortToggle.title = label;
  elements.sortToggle.setAttribute("aria-label", label);
}

elements.sortToggle.addEventListener("click", () => {
  state.alphabetOrder = state.alphabetOrder === "asc" ? "desc" : "asc";
  render();
});

// --- Copying -------------------------------------------------------------

function copyEntry(entry, row) {
  if (!entry) {
    return;
  }

  writeClipboard(`${entry.word} - ${entry.meaning}`).then((ok) => {
    if (!ok || !row) {
      return;
    }

    // Brief flash so the copy is visible even without a toast.
    row.classList.add("is-copied");
    setTimeout(() => row.classList.remove("is-copied"), 400);
  });
}

function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text),
    );
  }

  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  const area = document.createElement("textarea");

  area.value = text;
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();

  let ok = false;

  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  area.remove();
  return ok;
}

// Right-clicking a row copies the whole "word - meaning" entry. Plain mouse
// selection is left untouched, so highlighting part of a row and using the
// browser's own Copy still works for just that text.
elements.wordList.addEventListener("contextmenu", (event) => {
  const row = event.target.closest("[data-entry-id]");

  if (!row) {
    return;
  }

  // If the user highlighted part of the row, leave the native menu alone so
  // "Copy" copies only that text. With nothing selected, right-click copies
  // the whole entry.
  if (window.getSelection()?.toString()) {
    return;
  }

  event.preventDefault();
  copyEntry(
    state.entries.find((item) => item.id === row.dataset.entryId),
    row,
  );
});

function resetModalError() {
  elements.modalError.hidden = true;
  elements.modalError.textContent = "";
}

function closeWordModal() {
  elements.wordModal.classList.add("hidden");
  elements.wordForm.reset();
  resetModalError();
  elements.modalMode.value = "add";
  elements.modalWord.disabled = false;
  elements.modalChapter.disabled = false;
}

function openWordModal(mode) {
  elements.wordForm.reset();
  resetModalError();
  elements.modalMode.value = mode;

  if (mode === "edit") {
    const entry = state.entries.find((item) => item.id === state.selectedId);

    if (!entry) {
      return;
    }

    elements.modalTitle.textContent = "Edit Word Meaning";
    elements.modalChapter.value = entry.chapter;
    elements.modalWord.value = entry.word;
    elements.modalMeaning.value = entry.meaning;

    // The word and chapter identify the entry, so they are locked while editing.
    elements.modalWord.disabled = true;
    elements.modalChapter.disabled = true;
  } else {
    elements.modalTitle.textContent = "Add New Word";
    elements.modalChapter.value = state.chapter === "all" ? 1 : state.chapter;
    elements.modalWord.disabled = false;
    elements.modalChapter.disabled = false;
  }

  elements.wordModal.classList.remove("hidden");
  (mode === "edit" ? elements.modalMeaning : elements.modalWord).focus();
}

function openAddWordModal() {
  openWordModal("add");
}

function openEditWordModal() {
  if (!state.selectedId) {
    return;
  }

  openWordModal("edit");
}

elements.addWordBtn.addEventListener("click", openAddWordModal);
elements.editWordBtn.addEventListener("click", openEditWordModal);
elements.cancelWordBtn.addEventListener("click", closeWordModal);

// Clicking the dimmed backdrop (but not the dialog itself) closes the modal.
elements.wordModal.addEventListener("click", (event) => {
  if (event.target === elements.wordModal) {
    closeWordModal();
  }
});

elements.wordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const mode = elements.modalMode.value === "edit" ? "edit" : "add";
  const chapter = Number(elements.modalChapter.value);
  const word = elements.modalWord.value.trim();
  const meaning = elements.modalMeaning.value.trim();

  elements.modalError.hidden = true;

  try {
    const api = mode === "edit"
      ? window.glossaryApi.updateEntry(chapter, word, meaning)
      : window.glossaryApi.addEntry(chapter, word, meaning);

    applyGlossary(await api);
    closeWordModal();

    // Jump to the chapter that received the word so the change is visible.
    applySearchQuery.cancel();
    state.chapter = chapter;
    state.query = "";
    elements.searchInput.value = "";
    state.selectedId = `${chapter}-${word}`;
    render();
  } catch (error) {
    elements.modalError.textContent = error?.message || "The word could not be saved.";
    elements.modalError.hidden = false;
  }
});

function resetBatchState() {
  state.isBatchDeleting = false;
  state.batchSelectedIds = [];
}

function enterBatchMode() {
  state.isBatchDeleting = true;
  state.batchSelectedIds = [];
  render();
}

elements.deleteWordBtn.addEventListener("click", async () => {
  // With no selected word there is nothing to remove, so fall through to batch
  // mode instead of silently doing nothing.
  if (!state.selectedId) {
    enterBatchMode();
    return;
  }

  if (!window.confirm("Are you sure you want to delete this word?")) {
    return;
  }

  try {
    applyGlossary(await window.glossaryApi.deleteEntries([state.selectedId]));
    state.selectedId = null;
    render();
  } catch (error) {
    console.error(error);
    elements.loadStatus.textContent = error?.message || "Delete failed";
  }
});

elements.batchDeleteBtn.addEventListener("click", async () => {
  const count = state.batchSelectedIds.length;

  if (!count) {
    return;
  }

  if (!window.confirm(`Delete ${count} ${count === 1 ? "word" : "words"}?`)) {
    return;
  }

  try {
    applyGlossary(await window.glossaryApi.deleteEntries(state.batchSelectedIds));
    resetBatchState();
    state.selectedId = null;
    render();
  } catch (error) {
    console.error(error);
    elements.loadStatus.textContent = error?.message || "Delete failed";
  }
});

elements.cancelBatchBtn.addEventListener("click", () => {
  resetBatchState();
  render();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.searchInput.focus();
    return;
  }

  // Escape always dismisses the dialog, even while a field has focus.
  if (event.key === "Escape" && !elements.wordModal.classList.contains("hidden")) {
    closeWordModal();
  }
});

function setSidebarCollapsed(collapsed) {
  elements.appShell.classList.toggle("sidebar-collapsed", collapsed);

  if (elements.toggleLeftSidebar) {
    elements.toggleLeftSidebar.setAttribute("aria-expanded", String(!collapsed));
  }

  try {
    localStorage.setItem("b1-glossar-left-collapsed", String(collapsed));
  } catch {
    // The app stays usable when persistent storage is unavailable.
  }
}

elements.toggleLeftSidebar?.addEventListener("click", () => {
  setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
});

function restoreSidebarState() {
  try {
    setSidebarCollapsed(localStorage.getItem("b1-glossar-left-collapsed") === "true");
  } catch {
    // The default expanded layout is used when storage is unavailable.
  }
}

restoreSidebarState();
applyTheme(document.documentElement.dataset.theme);
loadGlossary();
