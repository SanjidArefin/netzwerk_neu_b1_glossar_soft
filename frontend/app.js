const state = {
  entries: [],
  chapters: [],
  chapter: "all",
  query: "",
  selectedId: null,
};

const elements = {
  chapterTabs: document.querySelector("#chapter-tabs"),
  allChapterButton: document.querySelector('[data-chapter="all"]'),
  allCount: document.querySelector("#all-count"),
  totalCount: document.querySelector("#total-count"),
  chapterLabel: document.querySelector("#chapter-label"),
  pageTitle: document.querySelector("#page-title"),
  searchInput: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
  resultCount: document.querySelector("#result-count"),
  wordListPanel: document.querySelector(".word-list-panel"),
  listHeader: document.querySelector(".list-header"),
  alphabetJump: document.querySelector("#alphabet-jump"),
  wordList: document.querySelector("#word-list"),
  loadStatus: document.querySelector("#load-status"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeColor: document.querySelector('meta[name="theme-color"]'),
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
  elements.themeToggle.setAttribute(
    "aria-label",
    isDark ? "Hellmodus aktivieren" : "Dunkelmodus aktivieren",
  );
  elements.themeToggle.setAttribute(
    "title",
    isDark ? "Hellmodus aktivieren" : "Dunkelmodus aktivieren",
  );
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
  return `Kapitel ${chapter}`;
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

    return `
      <button class="chapter-tab${isActive ? " is-active" : ""}" type="button"
        data-chapter="${chapter.number}" aria-pressed="${isActive}">
        <span>${chapter.title}</span>
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
    ? "Alle Kapitel"
    : chapterName(state.chapter);
  elements.pageTitle.textContent = state.query.trim() ? "Suchergebnisse" : "Wortschatz";
  elements.resultCount.textContent = `${visibleEntries.length} ${visibleEntries.length === 1 ? "Eintrag" : "Eintraege"}`;
  elements.clearSearch.hidden = !state.query;
}

function ensureSelected(visibleEntries) {
  if (!visibleEntries.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = visibleEntries[0]?.id ?? null;
  }
}

function renderWordList(visibleEntries) {
  if (!visibleEntries.length) {
    elements.wordList.innerHTML = '<div class="empty-state">Keine passenden Woerter gefunden.</div>';
    return;
  }

  let lastLetter = "";
  const rows = [];

  for (const entry of visibleEntries) {
    const letter = entry.word.slice(0, 1).toLocaleUpperCase("de-DE");

    if (letter !== lastLetter) {
      rows.push(`<div class="letter-heading" data-letter="${escapeHtml(letter)}" aria-hidden="true">${escapeHtml(letter)}</div>`);
      lastLetter = letter;
    }

    rows.push(`
      <button class="word-row${entry.id === state.selectedId ? " is-selected" : ""}"
        type="button" role="option" aria-selected="${entry.id === state.selectedId}"
        data-entry-id="${escapeHtml(entry.id)}">
        <span class="word-name">${escapeHtml(entry.word)}</span>
        <span class="word-meaning">${escapeHtml(entry.meaning)}</span>
        <span class="chapter-tag">${chapterName(entry.chapter)}</span>
      </button>
    `);
  }

  elements.wordList.innerHTML = rows.join("");
}

function renderAlphabetJump(visibleEntries) {
  const availableLetters = new Set(visibleEntries.map((entry) => (
    entry.word.slice(0, 1).toLocaleUpperCase("de-DE")
  )));

  elements.alphabetJump.innerHTML = GERMAN_ALPHABET.map((letter) => {
    const available = availableLetters.has(letter);
    const status = available ? `Zu ${letter} springen` : `Keine Woerter mit ${letter}`;

    return `
      <button class="alphabet-button" type="button" data-letter="${letter}"
        aria-label="${status}" title="${status}"${available ? "" : " disabled"}>
        ${letter}
      </button>
    `;
  }).join("");
}


function render() {
  const visibleEntries = entriesForCurrentView();
  ensureSelected(visibleEntries);
  renderChapterTabs();
  renderHeader(visibleEntries);
  renderWordList(visibleEntries);
  renderAlphabetJump(visibleEntries);
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

async function loadGlossary() {
  elements.loadStatus.textContent = "Glossar wird geladen";

  try {
    const glossary = await window.glossaryApi.loadGlossary();

    state.chapters = glossary.chapters;
    state.entries = glossary.chapters.flatMap((chapter) => (
      chapter.entries.map((entry) => ({
        ...entry,
        id: `${chapter.number}-${entry.word}`,
        chapter: chapter.number,
        searchText: GlossaryModel.normalizeForSearch(`${entry.word} ${entry.meaning}`),
      }))
    ));

    elements.loadStatus.textContent = `${glossary.totalEntries} Woerter`;
    render();
  } catch (error) {
    console.error(error);
    elements.loadStatus.textContent = "Glossar konnte nicht geladen werden";
    elements.wordList.innerHTML = '<div class="empty-state">Die Glossardaten konnten nicht geladen werden.</div>';
  }
}

elements.chapterTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chapter]");

  if (button) {
    selectChapter(button.dataset.chapter);
  }
});

elements.allChapterButton.addEventListener("click", () => selectChapter("all"));

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.selectedId = null;
  render();
  elements.wordListPanel.scrollTop = 0;
});

elements.clearSearch.addEventListener("click", () => {
  elements.searchInput.value = "";
  state.query = "";
  state.selectedId = null;
  elements.searchInput.focus();
  render();
  elements.wordListPanel.scrollTop = 0;
});

elements.wordList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-entry-id]");

  if (row) {
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
    const stickyOffset = elements.listHeader.offsetHeight + elements.alphabetJump.offsetHeight;

    elements.wordListPanel.scrollTo({
      behavior: "auto",
      top: Math.max(0, targetTop - stickyOffset),
    });
  }
});


elements.themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

document.addEventListener("keydown", (event) => {
  const isTyping = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.searchInput.focus();
    return;
  }
});

applyTheme(document.documentElement.dataset.theme);
loadGlossary();
