// ============================================================================
// NeoLang — неоморфный интерфейс + Material Design 3 (tauri-plugin-m3)
// ============================================================================
// Приложение раздаётся как статика (без бандлера), поэтому команды Tauri
// вызываются напрямую через window.__TAURI__.core.invoke
// (withGlobalTauri: true в tauri.conf.json).

const tauriInvoke = window.__TAURI__?.core?.invoke;

async function invoke(cmd, args) {
  if (!tauriInvoke) {
    throw new Error("Tauri API недоступен — запустите приложение через Tauri");
  }
  return tauriInvoke(cmd, args);
}

/* --------------------------------------------------------------------------
   Material3: цвета + safe-area insets
   -------------------------------------------------------------------------- */
const M3 = {
  async applyColors(theme = "system") {
    try {
      const scheme = await invoke("plugin:m3|colors", { theme });
      for (const [name, value] of Object.entries(scheme)) {
        document.documentElement.style.setProperty(`--${name}`, value);
      }
      return true;
    } catch (err) {
      console.warn("[m3] applyColors:", err);
      return false;
    }
  },

  async getInsets() {
    try {
      return await invoke("plugin:m3|insets");
    } catch (err) {
      console.warn("[m3] getInsets:", err);
      return false;
    }
  },

  async setBarColor(color = "system") {
    try {
      await invoke("plugin:m3|bar_color", { color });
      return true;
    } catch (err) {
      console.warn("[m3] setBarColor:", err);
      return false;
    }
  },
};

/* --------------------------------------------------------------------------
   Тема (светлая / тёмная). Пока пользователь не выбирал — следуем системной.
   -------------------------------------------------------------------------- */
const THEME_KEY = "neolang-theme";
const systemDarkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

function readSavedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

let themeSaved = readSavedTheme();
let theme = themeSaved ?? (systemDarkQuery?.matches ? "dark" : "light");
let themeApplyId = 0;
document.documentElement.dataset.theme = theme;

// Что просить у tauri-plugin-m3: явный выбор или системную палитру
function m3Theme() {
  return themeSaved ? theme : "system";
}

function syncThemeSwitch() {
  document
    .getElementById("theme-switch")
    ?.setAttribute("aria-checked", String(theme === "dark"));
}

async function applyThemeColors(requestId) {
  document.documentElement.dataset.theme = theme;
  syncThemeSwitch();
  if (!tauriInvoke) return;
  // Для «авто» палитру применит сам applyAccent, для своего цвета — сначала база
  if (state.accent !== "auto") await M3.applyColors(m3Theme());
  if (requestId !== themeApplyId) return;
  await applyAccent(state.accent);
}

async function setTheme(next) {
  if (next === theme) return;
  theme = next;
  themeSaved = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* хранилище недоступно — тема просто не запомнится */
  }

  const requestId = ++themeApplyId;
  const run = () => applyThemeColors(requestId);
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (document.startViewTransition && !reduceMotion) {
    try {
      // Плавное перетекание всего интерфейса, пока ползунок едет
      await document.startViewTransition(run).updateCallbackDone;
    } catch (err) {
      console.warn("[NeoLang] смена темы:", err);
    }
  } else {
    await run();
  }
}

function setupThemeSwitch() {
  const sw = document.getElementById("theme-switch");
  if (!sw) return;

  // Стартовое положение без анимации (за заставкой)
  sw.classList.add("is-instant");
  syncThemeSwitch();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => sw.classList.remove("is-instant"))
  );

  sw.addEventListener("click", () =>
    setTheme(theme === "dark" ? "light" : "dark")
  );

  systemDarkQuery?.addEventListener?.("change", (event) => {
    if (themeSaved) return; // выбор пользователя важнее системного
    theme = event.matches ? "dark" : "light";
    applyThemeColors(++themeApplyId);
  });
}

async function initM3() {
  if (!tauriInvoke) {
    console.warn("[m3] Tauri API недоступен (запуск вне Tauri)");
    return false;
  }

  const ok = await M3.applyColors(m3Theme());
  if (ok) console.log("[m3] Material3 цвета применены");

  const insets = await M3.getInsets();
  if (insets) {
    const s = insets.scaleFactor || 1;
    const set = (key, value) => {
      const px = Number(value) / s;
      if (!Number.isNaN(px)) {
        document.documentElement.style.setProperty(key, `${px}px`);
      }
    };
    set("--inset-top", insets.adjustedInsetTop);
    set("--inset-right", insets.adjustedInsetRight);
    set("--inset-bottom", insets.adjustedInsetBottom);
    set("--inset-left", insets.adjustedInsetLeft);
    console.log("[m3] insets применены:", insets);
  }

  await M3.setBarColor("system");
  return ok;
}

async function initAppearance() {
  if (!tauriInvoke) return;

  try {
    const saved = await invoke("get_accent");
    if (saved) {
      state.accent = saved;
      await applyAccent(saved, { persist: false });
    } else {
      // Если акцент не сохранён — применяем auto (Material You)
      await applyAccent("auto", { persist: false });
    }
  } catch (err) {
    console.warn("[NeoLang] не удалось загрузить акцент:", err);
    await applyAccent("auto", { persist: false });
  }

  setupAccentPicker();
}

/* --------------------------------------------------------------------------
   Экран приветствия (2 экрана возможностей -> основной)
   -------------------------------------------------------------------------- */
const introScreens = document.querySelectorAll(".intro-screen");
const mainScreen = document.querySelector(".mainpage");

const FADE_MS = 350;
let isAnimating = false;

function transitionTo(nextScreen) {
  if (!nextScreen || isAnimating) return;

  const current = document.querySelector(".screen.is-visible");
  if (current === nextScreen) return;

  isAnimating = true;

  if (current) current.classList.remove("is-visible");

  setTimeout(() => {
    nextScreen.classList.add("is-visible");
    isAnimating = false;

    const scroller = nextScreen.querySelector(".mainpage__lesson");
    if (scroller) scroller.scrollTop = 0;
  }, current ? FADE_MS : 0);
}

function showIntroScreen() {
  introScreens.forEach((scr) => {
    scr.classList.toggle("is-visible", scr.dataset.screen === "1");
  });
  if (mainScreen) mainScreen.classList.remove("is-visible");
  els.boot?.classList.add("is-hidden");
}

function showMainScreen() {
  introScreens.forEach((scr) => scr.classList.remove("is-visible"));
  if (mainScreen) mainScreen.classList.add("is-visible");
  els.boot?.classList.add("is-hidden");
}

function setupIntroNavigation() {
  document.querySelectorAll(".next-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.next;

      if (next === "main") {
        transitionTo(mainScreen);
        if (tauriInvoke) {
          // Страховка: повторно фиксируем, что интро пройдено,
          // если запись при первом показе почему-то не удалась.
          invoke("set_intro_seen").catch((err) => {
            console.warn("[NeoLang] set_intro_seen недоступен:", err);
          });
          loadLessons();
        }
      } else {
        const target = document.querySelector(
          `.intro-screen[data-screen="${next}"]`
        );
        transitionTo(target);
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Утилиты рендера
   -------------------------------------------------------------------------- */
const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

function formatInline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

const RUST_KEYWORDS = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn",
  "else", "enum", "false", "fn", "for", "if", "impl", "in", "let", "loop",
  "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
  "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
  "where", "while",
]);

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends", "false",
  "finally", "for", "from", "function", "get", "if", "import", "in",
  "instanceof", "let", "new", "null", "of", "return", "set", "static",
  "super", "switch", "this", "throw", "true", "try", "typeof", "undefined",
  "var", "void", "while", "yield",
]);

const CPP_KEYWORDS = new Set([
  "alignas", "alignof", "and", "and_eq", "asm", "bitand", "bitor", "break",
  "case", "catch", "class", "compl", "concept", "const", "consteval",
  "constexpr", "constinit", "const_cast", "continue", "co_await",
  "co_return", "co_yield", "decltype", "default", "delete", "do",
  "dynamic_cast", "else", "enum", "explicit", "export", "extern", "false",
  "final", "for", "friend", "goto", "if", "import", "inline", "mutable",
  "namespace", "new", "noexcept", "not", "not_eq", "nullptr", "operator",
  "or", "or_eq", "override", "private", "protected", "public", "register",
  "reinterpret_cast", "requires", "return", "sizeof", "static",
  "static_assert", "static_cast", "struct", "switch", "template", "this",
  "thread_local", "throw", "true", "try", "typedef", "typeid", "typename",
  "union", "using", "virtual", "volatile", "while", "xor", "xor_eq",
]);

const CPP_TYPES = new Set([
  "auto", "bool", "char", "char8_t", "char16_t", "char32_t", "double",
  "float", "int", "long", "short", "signed", "unsigned", "void", "wchar_t",
  "size_t", "ssize_t", "ptrdiff_t", "int8_t", "int16_t", "int32_t",
  "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
  "std", "string", "string_view", "vector", "array", "map", "set",
  "unordered_map", "unordered_set", "multimap", "multiset", "deque", "list",
  "stack", "queue", "priority_queue", "pair", "tuple", "optional", "variant",
  "expected", "unique_ptr", "shared_ptr", "weak_ptr", "function", "span",
  "ranges", "views", "format", "thread", "jthread", "mutex", "lock_guard",
  "unique_lock", "condition_variable", "atomic", "future", "promise",
  "async", "ostream", "istream", "stringstream", "fstream", "exception",
  "runtime_error", "invalid_argument", "out_of_range", "errc",
]);

// Безопасная подсветка C++: комментарии, строки, директивы препроцессора,
// числа, типы, ключевые слова и имена функций.
function highlightCpp(source) {
  const tokenRe =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(#\s*[A-Za-z_]\w*)|\b(0[xX][0-9a-fA-F']+|0[bB][01']+|\d[\d']*(?:\.\d+)?(?:[eE][+-]?\d+)?[fFlLuU]*)\b|\b([A-Za-z_]\w*)\b/g;

  let out = "";
  let last = 0;

  for (const match of source.matchAll(tokenRe)) {
    const [full, comment, str, preproc, num, ident] = match;
    out += escapeHtml(source.slice(last, match.index));

    let cls = "";
    if (comment) cls = "tok-comment";
    else if (str) cls = "tok-string";
    else if (preproc) cls = "tok-macro";
    else if (num) cls = "tok-number";
    else if (ident) {
      if (CPP_TYPES.has(ident)) cls = "tok-type";
      else if (CPP_KEYWORDS.has(ident)) cls = "tok-keyword";
      else {
        const rest = source.slice(match.index + full.length);
        const next = rest.match(/^\s*/)[0].length;
        if (rest[next] === "(") cls = "tok-fn";
      }
    }

    out += cls
      ? `<span class="${cls}">${escapeHtml(full)}</span>`
      : escapeHtml(full);

    last = match.index + full.length;
  }

  out += escapeHtml(source.slice(last));
  return out;
}

// Безопасная подсветка JavaScript: строки, шаблоны, комментарии и числа.
function highlightJs(source) {
  const tokenRe =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d[\d_]*(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g;

  let out = "";
  let last = 0;

  for (const match of source.matchAll(tokenRe)) {
    const [full, comment, str, num, ident] = match;
    out += escapeHtml(source.slice(last, match.index));

    let cls = "";
    if (comment) cls = "tok-comment";
    else if (str) cls = "tok-string";
    else if (num) cls = "tok-number";
    else if (ident && JS_KEYWORDS.has(ident)) cls = "tok-keyword";

    out += cls
      ? `<span class="${cls}">${escapeHtml(full)}</span>`
      : escapeHtml(full);

    last = match.index + full.length;
  }

  out += escapeHtml(source.slice(last));
  return out;
}

function highlightCode(source, lang) {
  if (lang === "js" || lang === "javascript") return highlightJs(source);
  if (lang === "cpp" || lang === "c++") return highlightCpp(source);
  if (lang === "rust") return highlightRust(source);
  return escapeHtml(source);
}

/* --------------------------------------------------------------------------
   Акцентный цвет: Material You через tauri m3 + собственные оттенки
   -------------------------------------------------------------------------- */
const ACCENT_PRESETS = [
  { name: "Лаванда", color: "#6750a4" },
  { name: "Океан", color: "#2f6fed" },
  { name: "Изумруд", color: "#2e7d32" },
  { name: "Закат", color: "#e76f51" },
  { name: "Ягода", color: "#c2185b" },
  { name: "Мандарин", color: "#f57c00" },
  { name: "Бирюза", color: "#00897b" },
  { name: "Графит", color: "#455a64" },
];

const ACCENT_OVERRIDE_KEYS = [
  "--primary",
  "--onPrimary",
  "--primaryContainer",
  "--onPrimaryContainer",
  "--inversePrimary",
  "--surfaceTint",
];

function normalizeHexColor(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function hexToRgb(value) {
  const hex = normalizeHexColor(value) || "#000000";
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const channel = (value) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixHex(first, second, secondWeight = 0.5) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const weight = Math.max(0, Math.min(1, secondWeight));
  return rgbToHex({
    r: a.r * (1 - weight) + b.r * weight,
    g: a.g * (1 - weight) + b.g * weight,
    b: a.b * (1 - weight) + b.b * weight,
  });
}

function relativeLuminance(value) {
  const { r, g, b } = hexToRgb(value);
  const channel = (part) => {
    const normalized = part / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastColor(value) {
  return relativeLuminance(value) > 0.48 ? "#141218" : "#ffffff";
}

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return normalizeHexColor(value) || fallback;
}

function setPageGradient(primary) {
  const surface = cssColor("--surface", "#ffffff");
  const start = mixHex(primary, surface, 0.68);
  const middle = mixHex(primary, surface, 0.35);
  const end = mixHex(primary, surface, 0.82);
  document.documentElement.style.setProperty(
    "--page-gradient",
    `linear-gradient(135deg, ${start} 0%, ${middle} 40%, ${end} 100%)`
  );
}

function clearAccentOverrides() {
  for (const key of ACCENT_OVERRIDE_KEYS) {
    document.documentElement.style.removeProperty(key);
  }
}

function applyCustomAccent(value) {
  const accent = normalizeHexColor(value);
  if (!accent) return;

  const surface = cssColor("--surface", "#ffffff");
  const isDark = relativeLuminance(surface) < 0.35;
  const container = mixHex(accent, surface, isDark ? 0.62 : 0.82);

  const vars = {
    "--primary": accent,
    "--onPrimary": contrastColor(accent),
    "--primaryContainer": container,
    "--onPrimaryContainer": contrastColor(container),
    "--inversePrimary": mixHex(accent, "#ffffff", 0.45),
    "--surfaceTint": accent,
  };

  for (const [key, color] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, color);
  }

  setPageGradient(accent);
}

function accentPresetHtml() {
  return ACCENT_PRESETS.map(
    (preset) => `
      <button
        class="accent-swatch"
        type="button"
        data-color="${preset.color}"
        style="--swatch: ${preset.color}"
        title="${preset.name}"
        aria-label="${preset.name}"
        aria-pressed="false"
      ></button>`
  ).join("");
}

function updateAccentUi() {
  const isAuto = state.accent === "auto";
  const autoBtn = document.getElementById("accent-auto");

  if (autoBtn) {
    autoBtn.classList.toggle("is-selected", isAuto);
    autoBtn.setAttribute("aria-pressed", String(isAuto));
  }

  document.querySelectorAll(".accent-swatch").forEach((button) => {
    const selected = !isAuto && button.dataset.color === state.accent;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  const colorInput = document.getElementById("accent-color");
  if (colorInput && !isAuto) colorInput.value = state.accent;

  const colorValue = document.getElementById("accent-color-value");
  if (colorValue) {
    colorValue.textContent = isAuto ? "Material You" : state.accent.toUpperCase();
  }
}

let accentApplyId = 0;

async function persistAccent(accent) {
  if (!tauriInvoke) return;

  try {
    const saved = await invoke("set_accent", { accent });
    if (saved && state.accent === accent) {
      state.accent = saved;
      updateAccentUi();
    }
  } catch (err) {
    console.warn("[NeoLang] не удалось сохранить акцент:", err);
  }
}

async function applyAccent(accent, { persist = false } = {}) {
  const normalized =
    accent === "auto" ? "auto" : normalizeHexColor(accent);
  if (!normalized) return;

  const requestId = ++accentApplyId;
  state.accent = normalized;

  if (normalized === "auto") {
    const applied = await M3.applyColors(m3Theme());
    if (requestId !== accentApplyId) {
      if (state.accent !== "auto") applyCustomAccent(state.accent);
      return;
    }

    if (!applied) {
      clearAccentOverrides();
    } else {
      await M3.setBarColor("system");
    }

    if (applied) {
      setPageGradient(cssColor("--primary", "#6750a4"));
    }
  } else {
    applyCustomAccent(normalized);
  }

  updateAccentUi();

  if (persist) {
    await persistAccent(normalized);
  }
}

function isAccentSheetOpen() {
  const overlay = document.getElementById("accent-overlay");
  return Boolean(overlay && !overlay.classList.contains("is-hidden"));
}

function setupAccentPicker() {
  const overlay = document.getElementById("accent-overlay");
  const toggle = document.getElementById("accent-toggle");
  const close = document.getElementById("accent-close");
  const autoBtn = document.getElementById("accent-auto");
  const presets = document.getElementById("accent-presets");
  const colorInput = document.getElementById("accent-color");
  const colorValue = document.getElementById("accent-color-value");

  if (!overlay || !toggle) return;

  if (presets && !presets.childElementCount) {
    presets.innerHTML = accentPresetHtml();
  }

  const setOpen = (open) => {
    overlay.classList.toggle("is-hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      requestAnimationFrame(() => close?.focus());
    } else {
      toggle.focus();
    }
  };

  toggle.addEventListener("click", () => setOpen(true));
  close?.addEventListener("click", () => setOpen(false));

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isAccentSheetOpen()) {
      event.stopPropagation();
      setOpen(false);
    }
  });

  autoBtn?.addEventListener("click", () => {
    applyAccent("auto", { persist: true });
  });

  presets?.addEventListener("click", (event) => {
    const button = event.target.closest(".accent-swatch");
    if (!button) return;
    applyAccent(button.dataset.color, { persist: true });
  });

  colorInput?.addEventListener("input", () => {
    const value = normalizeHexColor(colorInput.value);
    if (!value) return;
    if (colorValue) colorValue.textContent = value.toUpperCase();
    applyAccent(value);
  });

  colorInput?.addEventListener("change", () => {
    applyAccent(colorInput.value, { persist: true });
  });

  updateAccentUi();
}

// Безопасная подсветка Rust: разбиваем исходник на токены и экранируем HTML.
function highlightRust(source) {
  const tokenRe =
    /(\/\/[^\n]*)|("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|\b(\d[\d_]*(?:\.\d+)?(?:[iuf][0-9]+)?)\b|\b([a-z_][a-z0-9_]*!)\b|\b([A-Z][A-Za-z0-9_]*)\b|\b([a-z_][a-z0-9_]*)\b/g;

  let out = "";
  let last = 0;

  for (const match of source.matchAll(tokenRe)) {
    const [full, comment, str, chr, num, macroName, typeName, ident] = match;
    out += escapeHtml(source.slice(last, match.index));

    let cls = "";
    if (comment) cls = "tok-comment";
    else if (str || chr) cls = "tok-string";
    else if (num) cls = "tok-number";
    else if (macroName) cls = "tok-macro";
    else if (typeName) cls = "tok-type";
    else if (ident && RUST_KEYWORDS.has(ident)) cls = "tok-keyword";

    out += cls
      ? `<span class="${cls}">${escapeHtml(full)}</span>`
      : escapeHtml(full);

    last = match.index + full.length;
  }

  out += escapeHtml(source.slice(last));
  return out;
}

function renderBlock(block) {
  const title = block.title ? escapeHtml(block.title) : "";

  switch (block.kind) {
    case "code":
      return `
        <figure class="code-block">
          <div class="code-head">
            <span>${title || "Пример кода"}</span>
            <button class="copy-btn" type="button">Копировать</button>
          </div>
          <pre><code>${highlightCode(block.code || "", block.lang)}</code></pre>
        </figure>`;

    case "tip":
      return `
        <aside class="callout callout--tip">
          <div class="callout__head">
            <span class="callout__icon" aria-hidden="true">💡</span>
            <span>${title || "Совет"}</span>
          </div>
          <p>${formatInline(block.body || "")}</p>
        </aside>`;

    case "warning":
      return `
        <aside class="callout callout--warning">
          <div class="callout__head">
            <span class="callout__icon" aria-hidden="true">⚠️</span>
            <span>${title || "Важно"}</span>
          </div>
          <p>${formatInline(block.body || "")}</p>
        </aside>`;

    case "list":
      return `
        <section class="lesson-block">
          ${title ? `<h3>${title}</h3>` : ""}
          <ul>${(block.items || [])
            .map((item) => `<li>${formatInline(item)}</li>`)
            .join("")}</ul>
        </section>`;

    default:
      return `
        <section class="lesson-block">
          ${title ? `<h3>${title}</h3>` : ""}
          <p>${formatInline(block.body || "")}</p>
        </section>`;
  }
}

function renderLesson(lesson) {
  const done = state.completedLessons.has(lessonKey(lesson.course, lesson.id));

  return `
    <header class="lesson-head">
      <div class="lesson-head__text">
        <div class="lesson-kicker">Урок ${lesson.id} · ${escapeHtml(
          lesson.duration
        )} · ${escapeHtml(lesson.level)}</div>
        <h2 class="lesson-title" id="lesson-title">${escapeHtml(
          lesson.title
        )}</h2>
        <p class="lesson-subtitle">${escapeHtml(lesson.subtitle)}</p>
      </div>
      <button
        class="download-btn"
        type="button"
        data-id="${lesson.id}"
        data-tooltip="Скачать конспект в PDF"
        aria-label="Скачать конспект в PDF"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/>
        </svg>
      </button>
    </header>

    <div class="lesson-goals">
      <h3>Чему вы научитесь</h3>
      ${lesson.goals.map((goal) => `<div class="goal">${formatInline(goal)}</div>`).join("")}
    </div>

    ${lesson.blocks.map(renderBlock).join("")}

    <section class="lesson-practice">
      <h3 class="lesson-section-title">Практика</h3>
      ${lesson.practice
        .map(
          (task, index) => `
          <div class="practice-item">
            <span class="num">${index + 1}</span>
            <span>${formatInline(task)}</span>
          </div>`
        )
        .join("")}
    </section>

    <section class="lesson-takeaways">
      <h3 class="lesson-section-title">Запомнить</h3>
      ${lesson.takeaways
        .map(
          (item) =>
            `<div class="takeaway-item"><span>${formatInline(item)}</span></div>`
        )
        .join("")}
    </section>

    <section class="lesson-complete${done ? " is-done" : ""}">
      <div class="lesson-complete__text">
        <strong>${done ? "Урок пройден" : "Завершить урок"}</strong>
        <span>${
          done
            ? "Отметка сохранена — номер урока в списке выделен зелёным."
            : "Отметьте урок как пройденный, чтобы сохранить прогресс."
        }</span>
      </div>
      <button
        class="complete-btn${done ? " is-done" : ""}"
        type="button"
        data-id="${lesson.id}"
        aria-pressed="${done}"
      >
        ${done ? "✓ Пройдено" : "Завершить"}
      </button>
    </section>`;
}

/* --------------------------------------------------------------------------
   Состояние и DOM
   -------------------------------------------------------------------------- */
const els = {
  course: document.getElementById("course"),
  search: document.getElementById("lesson-search"),
  progress: document.getElementById("lesson-progress"),
  boot: document.getElementById("boot"),
  toolbar: document.getElementById("lesson-toolbar"),
  listView: document.getElementById("lesson-list-view"),
  list: document.getElementById("lesson-list"),
  detailView: document.getElementById("lesson-detail-view"),
  detailProgress: document.getElementById("lesson-detail-progress"),
  back: document.getElementById("back-to-list"),
  card: document.getElementById("lesson-card"),
  status: document.getElementById("lesson-status"),
  scroller: document.getElementById("lessondiv"),
  menu: document.getElementById("bottommenu"),
  prev: document.getElementById("prev-lesson"),
  next: document.getElementById("next-lesson"),
  home: document.getElementById("homebutton"),
};

const COURSE_LESSON_COUNTS = {
  rust: 26,
  javascript: 12,
  "c++": 20,
};

const state = {
  allLessons: [],
  visibleLessons: [],
  currentLesson: null,
  currentCourse: "rust",
  view: "list",
  listScroll: 0,
  searchTimer: null,
  completedLessons: new Set(),
  progressLoaded: false,
  accent: "auto",
};

function lessonKey(course, id) {
  return `${course}:${id}`;
}

/* --------------------------------------------------------------------------
   Переключение «список уроков» ⇄ «урок»
   -------------------------------------------------------------------------- */
function setView(view) {
  state.view = view;
  const isDetail = view === "detail";

  els.listView?.classList.toggle("is-hidden", isDetail);
  els.toolbar?.classList.toggle("is-hidden", isDetail);
  els.detailView?.classList.toggle("is-hidden", !isDetail);
  els.menu?.classList.toggle("is-hidden", !isDetail);
}

function showList() {
  setView("list");
  els.search?.blur();
  if (els.listView) els.listView.scrollTop = state.listScroll;
  if (els.status) {
    els.status.textContent = `Список уроков, доступно: ${state.allLessons.length}`;
  }
}

/* --------------------------------------------------------------------------
   Загрузка и отображение уроков (данные приходят из Rust)
   -------------------------------------------------------------------------- */
function pluralRu(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function lessonsCountLabel(count) {
  return `${count} ${pluralRu(count, "урок", "урока", "уроков")}`;
}

async function loadProgress(force = false) {
  if (!tauriInvoke) return;
  if (state.progressLoaded && !force) return;

  try {
    const keys = await invoke("get_completed_lessons");
    state.completedLessons = new Set(Array.isArray(keys) ? keys : []);
    state.progressLoaded = true;
  } catch (err) {
    console.warn("[NeoLang] не удалось загрузить прогресс:", err);
    state.progressLoaded = true;
  }
}

async function loadLessons() {
  if (!els.list) return;

  els.list.innerHTML = `<div class="lesson-empty">Загрузка уроков…</div>`;
  setView("list");

  try {
    await loadProgress();
    const lessons = await invoke("get_lessons", {
      course: state.currentCourse,
    });
    state.allLessons = lessons;
    state.currentLesson = null;
    state.listScroll = 0;
    renderLessonList(lessons);
    if (els.progress) els.progress.textContent = lessonsCountLabel(lessons.length);
    if (els.status) {
      els.status.textContent = `Доступно уроков: ${lessons.length}`;
    }
  } catch (err) {
    console.error("[NeoLang] не удалось загрузить уроки:", err);
    state.allLessons = [];
    els.list.innerHTML = `
      <div class="lesson-empty">
        Не удалось загрузить уроки.<br>
        Откройте приложение через Tauri, чтобы Rust-бэкенд был доступен.
      </div>`;
    if (els.progress) els.progress.textContent = "—";
  }
}

function renderLessonList(lessons, emptyText) {
  if (!els.list) return;
  state.visibleLessons = lessons;

  if (!lessons.length) {
    els.list.innerHTML = `<div class="lesson-empty">${escapeHtml(
      emptyText || "Ничего не найдено"
    )}</div>`;
    return;
  }

  els.list.innerHTML = lessons
    .map((lesson) => {
      const done = state.completedLessons.has(
        lessonKey(lesson.course, lesson.id)
      );

      return `
      <button class="lesson-item" type="button" data-id="${lesson.id}">
        <span class="lesson-item__num${done ? " is-done" : ""}" aria-hidden="true">${String(
          lesson.id
        ).padStart(2, "0")}</span>
        <span class="lesson-item__body">
          <span class="lesson-item__title">${escapeHtml(lesson.title)}</span>
          <span class="lesson-item__desc">${escapeHtml(lesson.subtitle)}</span>
          <span class="lesson-item__meta">${escapeHtml(
            lesson.duration
          )} · ${escapeHtml(lesson.level)}</span>
        </span>
        <svg class="lesson-item__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/>
        </svg>
      </button>`;
    })
    .join("");
}

async function openLesson(id) {
  try {
    const lesson = await invoke("get_lesson", {
      course: state.currentCourse,
      id,
    });
    state.currentLesson = lesson;
    if (state.view !== "detail") {
      state.listScroll = els.listView ? els.listView.scrollTop : 0;
    }

    els.card.innerHTML = renderLesson(lesson);
    const totalLessons =
      state.allLessons.length ||
      COURSE_LESSON_COUNTS[state.currentCourse] ||
      0;
    els.detailProgress.textContent = `${lesson.id} / ${totalLessons}`;
    els.prev.disabled = lesson.id <= 1;
    els.next.disabled = lesson.id >= totalLessons;
    if (els.status) {
      els.status.textContent = `Открыт урок ${lesson.id}: ${lesson.title}`;
    }

    setView("detail");

    // Сбрасываем прокрутку после перерисовки карточки.
    els.scroller.scrollTop = 0;
    requestAnimationFrame(() => {
      els.scroller.scrollTop = 0;
    });

    bindLessonActions();

    console.log(`[NeoLang] открыт урок ${lesson.id}: ${lesson.title}`);
  } catch (err) {
    console.error("[NeoLang] не удалось открыть урок:", err);
    showToast("Не удалось открыть урок");
  }
}

async function toggleLessonCompleted(button) {
  const lesson = state.currentLesson;
  if (!lesson || !button) return;

  const key = lessonKey(lesson.course, lesson.id);
  const next = !state.completedLessons.has(key);
  button.disabled = true;

  try {
    if (tauriInvoke) {
      const keys = await invoke("set_lesson_completed", {
        course: lesson.course,
        id: lesson.id,
        completed: next,
      });
      state.completedLessons = new Set(Array.isArray(keys) ? keys : []);
    } else if (next) {
      state.completedLessons.add(key);
    } else {
      state.completedLessons.delete(key);
    }

    updateCompletionUi();
    showToast(
      next ? "Урок отмечен как пройденный" : "Отметка о прохождении снята"
    );
  } catch (err) {
    console.error("[NeoLang] не удалось сохранить прогресс:", err);
    showToast("Не удалось сохранить прогресс");
  } finally {
    button.disabled = false;
  }
}

function updateListCompletion() {
  if (!els.list) return;

  els.list.querySelectorAll(".lesson-item").forEach((item) => {
    const id = Number(item.dataset.id);
    const done = state.completedLessons.has(
      lessonKey(state.currentCourse, id)
    );
    item
      .querySelector(".lesson-item__num")
      ?.classList.toggle("is-done", done);
  });
}

function updateCompletionUi() {
  const lesson = state.currentLesson;

  if (lesson) {
    const done = state.completedLessons.has(
      lessonKey(lesson.course, lesson.id)
    );
    const section = els.card.querySelector(".lesson-complete");
    const button = els.card.querySelector(".complete-btn");
    const title = section?.querySelector(".lesson-complete__text strong");
    const hint = section?.querySelector(".lesson-complete__text span");

    section?.classList.toggle("is-done", done);

    if (button) {
      button.classList.toggle("is-done", done);
      button.setAttribute("aria-pressed", String(done));
      button.textContent = done ? "✓ Пройдено" : "Завершить";
    }

    if (title) title.textContent = done ? "Урок пройден" : "Завершить урок";
    if (hint) {
      hint.textContent = done
        ? "Отметка сохранена — номер урока в списке выделен зелёным."
        : "Отметьте урок как пройденный, чтобы сохранить прогресс.";
    }
  }

  updateListCompletion();
}

function bindLessonActions() {
  // Кнопка завершения урока
  const completeBtn = els.card.querySelector(".complete-btn");
  if (completeBtn) {
    completeBtn.addEventListener("click", () => {
      toggleLessonCompleted(completeBtn);
    });
  }

  // Кнопка скачивания конспекта
  const downloadBtn = els.card.querySelector(".download-btn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      downloadNotes(Number(downloadBtn.dataset.id), downloadBtn);
    });
  }

  // Копирование кода
  els.card.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.closest(".code-block")?.querySelector("code");
      if (!code) return;

      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(code.textContent);
        btn.textContent = "Скопировано";
      } catch {
        btn.textContent = "Не удалось";
      }
      setTimeout(() => {
        btn.textContent = original;
      }, 1400);
    });
  });
}

/* --------------------------------------------------------------------------
   Скачивание PDF-конспекта
   --------------------------------------------------------------------------
   Готовый PDF привязан к уроку на стороне Rust: JS только просит сохранить
   файл и показывает путь. Никакой разметки конспекта в JavaScript нет. */
async function downloadNotes(id, button) {
  if (button) button.classList.add("is-loading");

  try {
    if (!tauriInvoke) {
      showToast("PDF-конспект доступен в приложении NeoLang");
      return;
    }

    const savedPath = await invoke("save_lesson_pdf", {
      course: state.currentCourse,
      id,
    });
    showToast(`PDF-конспект сохранён: ${savedPath}`);
  } catch (err) {
    console.error("[NeoLang] не удалось сохранить PDF-конспект:", err);
    showToast("Не удалось сохранить PDF-конспект");
  } finally {
    if (button) button.classList.remove("is-loading");
  }
}

let toastTimer = null;

function showToast(message) {
  let toast = document.querySelector(".toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3400);
}

/* --------------------------------------------------------------------------
   Поиск уроков (выполняется в Rust)
   -------------------------------------------------------------------------- */
async function runSearch(query) {
  try {
    const found = await invoke("search_lessons", {
      course: state.currentCourse,
      query,
    });
    renderLessonList(found);

    const total = state.allLessons.length || found.length;
    if (els.progress) {
      els.progress.textContent = query.trim()
        ? `${found.length} из ${total}`
        : lessonsCountLabel(found.length);
    }

    if (els.status) {
      els.status.textContent = query.trim()
        ? `Найдено уроков: ${found.length}`
        : "Показаны все уроки";
    }
    return found;
  } catch (err) {
    console.warn("[NeoLang] поиск недоступен:", err);
    showToast("Поиск недоступен");
    return [];
  }
}

function setupSearch() {
  if (!els.search) return;

  els.search.addEventListener("input", () => {
    clearTimeout(state.searchTimer);

    state.searchTimer = setTimeout(() => {
      runSearch(els.search.value);
    }, 220);
  });

  // Enter открывает первый найденный урок.
  els.search.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(state.searchTimer);

    const found = await runSearch(els.search.value);
    if (found.length > 0) {
      openLesson(found[0].id);
    }
  });
}

function setupLessonControls() {
  if (els.list) {
    els.list.addEventListener("click", (event) => {
      const item = event.target.closest(".lesson-item");
      if (!item) return;
      openLesson(Number(item.dataset.id));
    });
  }

  if (els.back) {
    els.back.addEventListener("click", showList);
  }

  if (els.prev) {
    els.prev.addEventListener("click", () => {
      if (state.currentLesson && state.currentLesson.id > 1) {
        openLesson(state.currentLesson.id - 1);
      }
    });
  }

  if (els.next) {
    els.next.addEventListener("click", () => {
      if (
        state.currentLesson &&
        state.currentLesson.id < state.allLessons.length
      ) {
        openLesson(state.currentLesson.id + 1);
      }
    });
  }

  if (els.home) {
    els.home.addEventListener("click", () => {
      els.scroller?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Escape из урока возвращает к списку.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.view === "detail" && !isAccentSheetOpen()) {
      showList();
    }
  });
}

/* --------------------------------------------------------------------------
   Выбор курса
   -------------------------------------------------------------------------- */
function setupCourseSelect() {
  if (!els.course) return;

  els.course.value = state.currentCourse;

  els.course.addEventListener("change", async () => {
    const nextCourse = els.course.value;

    if (!(nextCourse in COURSE_LESSON_COUNTS)) {
      return;
    }

    state.currentCourse = nextCourse;

    if (els.search) els.search.value = "";
    state.currentLesson = null;
    state.visibleLessons = [];
    state.listScroll = 0;

    await loadLessons();

    if (els.status) {
      const name = els.course.selectedOptions[0]?.textContent || "";
      els.status.textContent = `Выбран курс ${name}: ${lessonsCountLabel(
        state.allLessons.length
      )}`;
    }
  });
}

/* --------------------------------------------------------------------------
   Запуск: интро показываем только при первом открытии приложения
   -------------------------------------------------------------------------- */
async function checkIntroAndInit() {
  let skipIntro = false;
  if (tauriInvoke) {
    try {
      skipIntro = await invoke("has_seen_intro");
    } catch (err) {
      console.warn("[NeoLang] has_seen_intro недоступен:", err);
    }
  }

  // Показываем нужный экран сразу, не дожидаясь инициализации M3.
  if (skipIntro) {
    showMainScreen();
    loadLessons();
  } else {
    showIntroScreen();
    setupIntroNavigation();
    if (tauriInvoke) {
      // Приветствие показываем только один раз за всё время работы приложения:
      // отмечаем первый запуск сразу, даже если пользователь закроет окно.
      invoke("set_intro_seen").catch((err) => {
        console.warn("[NeoLang] set_intro_seen недоступен:", err);
      });
      // Уроки подгружаем заранее — понадобятся после интро.
      loadLessons();
    }
  }

  setupCourseSelect();
  setupSearch();
  setupLessonControls();
  setupThemeSwitch();

  await initM3();
  await initAppearance();

  console.log("[NeoLang] интерфейс инициализирован");
}

document.addEventListener("DOMContentLoaded", checkIntroAndInit);
