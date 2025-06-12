/* ---------------  Copy-Equation (patched July-2024) — content.js --------------- */

/* ── environment flags ────────────────────────────────────────────── */
const isChatGPT = /(chatgpt\.com|chat\.openai\.com)$/.test(location.host);
const isAndroid = /(android)/i.test(navigator.userAgent);
const isWindows = /(windows)/i.test(navigator.userAgent);
const parser    = new DOMParser();

/* ── runtime-filled assets ────────────────────────────────────────── */
let wordSvgContent  = "";          // svg/word.svg  (only shown on Windows)
let latexSvgContent = "";          // svg/latex.svg

/* ── helper: inject a css file from /css ---------------------------- */
function insertCSS(name) {
  const link = document.createElement("link");
  link.rel   = "stylesheet";
  link.href  = chrome.runtime.getURL(`css/${name}.css`);
  document.head.appendChild(link);
}

insertCSS("contextMenu");
insertCSS(isChatGPT ? "chatgpt" : "wikipedia");
if (isAndroid) insertCSS("android");

/* ── fetch helpers ───────────────────────────────────────────────── */
function fetchContent(path, cb) {
  fetch(chrome.runtime.getURL(path))
    .then(r => r.text())
    .then(cb)
    .catch(err => console.error(`❌  fetch ${path}:`, err));
}
const fetchSVGContent = (name, cb) => fetchContent(`svg/${name}.svg`, cb);

/* ── global state --------------------------------------------------- */
let contextMenu, chatRoot, putX, putY;
window.updateChat = () => {};                // will be replaced once SVGs load
const androidChat = () =>
  document.querySelector("[class^='react-scroll-to-bottom']:not(.h-full)");

/* ── keep Android context-menu aligned while scrolling -------------- */
function updateScroll() {
  const cm = document.getElementById("contextMenu");
  if (cm) {
    cm.style.top =
      putY + window.initialScroll - androidChat().scrollTop + "px";
  }
}

/* ─────────────────────────────────────────────────────────────────── */
/*                 1 ◇  MULTI-LINE COPY BUTTONS                       */
/* ─────────────────────────────────────────────────────────────────── */
function injectButtons() {
  /* header selectors: first is robust, others are fallbacks */
  const desktopHeaderSelectors = [
    "[data-message-author-role='assistant'] span.font-semibold",
    "[data-message-author-role='assistant'] > div:first-child",
    ".pt-4", ".pt-3", ".pt-2", ".pt-1\\.5"           // escaped dot
  ];

  const headerNodes = isAndroid
    ? [...document.querySelectorAll(".agent-turn")]
    : desktopHeaderSelectors.flatMap(sel => [...document.querySelectorAll(sel)]);

  headerNodes.forEach(span => {
    const header = isAndroid ? span : span.parentElement;
    if (!header || header.querySelector(".copy_eq_btn")) return;

    /* turn raw SVG into clickable buttons */
    const makeBtn = (svg, idx) =>
      `<button class="copy_eq_btn ce-btn-${idx}"
               style="display:inline-flex;align-items:center;
                      margin-left:4px;cursor:pointer;border:none;
                      background:none;padding:0">
         ${svg}
       </button>`;

    header.insertAdjacentHTML(
      "beforeend",
      isWindows
        ? makeBtn(wordSvgContent, 0) + makeBtn(latexSvgContent, 1)
        : makeBtn(latexSvgContent, 0)
    );

    /* attach click handlers */
    [...header.querySelectorAll(".copy_eq_btn")].forEach((btn, idx) => {
      btn.addEventListener("click", () => {
        /*  -------  DEBUG START  ------- */
        console.clear();
        console.log("%cCopyEquation click ▶", "color:#0af");

        /* 1) find the assistant-message container */
        const container = header.closest("[data-message-author-role='assistant']");
        console.log("container:", container);

        /* 2) locate the markdown body */
        const msgBody =
          container?.querySelector("div.markdown, div[data-message-uid]") ||
          container?.children[1];
        console.log("msgBody:", msgBody);

        if (!msgBody) {
          console.warn("‼  Could not find message body — nothing copied.");
          return;
        }

        /* 3) decide MathML vs LaTeX */
        const mode =
          idx === 0 && isWindows ? "copyMathML" : "copyLaTeX";
        console.log("mode:", mode);

        /* 4) call the original copyAll */
        copyAll(msgBody, mode);
        console.log("%c✔ Copied!", "color:#0a0");
        /*  -------  DEBUG END  ------- */
      });
    });
  });
}

/* ─────────────────────────────────────────────────────────────────── */
/*                    2 ◇  CONTEXT MENU (single-formula)              */
/* ─────────────────────────────────────────────────────────────────── */
document.addEventListener("click", removeContextMenu);
document.addEventListener("keydown", removeContextMenu);
if (!isAndroid) window.addEventListener("resize", removeContextMenu);
if (!isChatGPT && !isAndroid)
  document.addEventListener("scroll", removeContextMenu);

function openContextMenu(event) {
  removeContextMenu();

  const Element = isChatGPT
    ? findKatexElement(event.clientX, event.clientY)
    : findMweElement(event.clientX, event.clientY);
  if (!Element) return;

  event.preventDefault();

  if (isAndroid) {
    window.initialScroll = androidChat().scrollTop;
    androidChat().addEventListener("scroll", updateScroll);
  }

  const menuHTML = `
    <div id="contextMenu" ${isAndroid ? "" : "desktop"}
         style="left:${putX}px; top:${putY + window.scrollY}px;">
      <div id="copyMathML">
        ${wordSvgContent}${isAndroid ? "" : "Copy for Word (MathML)"}
      </div>
      <div id="copyLaTeX">
        ${latexSvgContent}${isAndroid ? "" : "Copy LaTeX"}
      </div>
    </div>`;

  contextMenu = document.createElement("div");
  contextMenu.innerHTML = menuHTML;
  document.body.appendChild(contextMenu);

  document
    .getElementById("copyMathML")
    .addEventListener("click", () => checkAndCopy(Element, "copyMathML"));
  document
    .getElementById("copyLaTeX")
    .addEventListener("click", () => checkAndCopy(Element, "copyLaTeX"));
}

function removeContextMenu() {
  contextMenu?.remove();
  if (isAndroid) {
    const chatEl = androidChat();
    chatEl && chatEl.removeEventListener("scroll", updateScroll);
  }
}

/* ── hit-test utils for single equations ---------------------------- */
function isWithin(x, y, classNames, cb) {
  let nodes = [];
  classNames.forEach(c => (nodes = nodes.concat([...document.getElementsByClassName(c)])));
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) {
      putX = isAndroid ? r.right + 7 : x;
      putY = isAndroid ? r.top - 23 - document.body.clientHeight : y;
      return cb(el);
    }
  }
  return null;
}
const findMweElement   = (x,y) => isWithin(x,y,["mwe-math-fallback-image-inline","mwe-math-fallback-image-display"],e=>e.parentElement);
const findKatexElement = (x,y) => isWithin(x,y,["katex"],e=>e);

/* ─────────────────────────────────────────────────────────────────── */
/*                 3 ◇  COPY / TRANSFORM LOGIC                        */
/* ─────────────────────────────────────────────────────────────────── */
function check(el, type) {
  if (type === "copyMathML") {
    if (el.querySelector("annotation").textContent === "\\displaystyle")
      return "\\displaystyle";
    return el.querySelector("math").outerHTML
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll(/<annotation [\S\s]*?>[\S\s]*?<\/annotation>/g, "");
  }
  const latex = el.querySelector("annotation").textContent;
  const m = latex.match(/\\displaystyle{([\S\s]*?)}/s);
  return (m ? m[1] : latex).replace("\\displaystyle", "");
}

function copyToClipboard(text) {
  const listener = e => {
    e.clipboardData.setData("text/plain", text.trim());
    e.preventDefault();
  };
  document.addEventListener("copy", listener, { once: true });
  document.execCommand("copy");
}

function checkAndCopy(element, type) {
  copyToClipboard(check(element, type));
}

/* full-message copy (multi-line) */
fetchContent("popup.html", popupHTML => {
  window.copyAll = (element, type) => {
    if (type === "copyMathML") {
      chrome.storage.sync.get(null, obj => {
        if (!obj.usedbefore) {
          document.body.innerHTML += popupHTML;
          chrome.storage.sync.set({ usedbefore: true });
        }
      });
    }

    const doc = parser.parseFromString(element.innerHTML, "text/html");

    /* transform <span class="math"> blocks */
    [...doc.querySelectorAll(".math, .katex")].forEach((e) => {
      let s = check(e, type)
        .replaceAll("&lt;", "&amp;lt;")
        .replaceAll("&gt;", "&amp;gt;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      const block = e.classList.contains("math-display") || e.classList.contains("katex-display");
      if (type === "copyLaTeX")
        e.outerHTML = block
          ? `\\begin{equation*}\n${s.replaceAll("align*", "aligned")}\n\\end{equation*}\n\n`
          : `$${s}$`;
      else e.outerHTML = block ? `${s}\n` : s;
    });

    /* fenced code blocks → minted (LaTeX mode) */
    [...doc.querySelectorAll("pre > .rounded-md")].forEach(e => {
      const header = e.querySelector(".rounded-t-md");
      const lang = header.querySelector("span").textContent;
      if (type === "copyLaTeX") {
        header.outerHTML = `\\begin{minted}{${lang}}\n`;
        e.outerHTML += "\\end{minted}\n\n";
      } else header.remove();
    });

    /* paragraph / list spacing */
    function addBreaks(str, rules) {
      rules.forEach(([tag, n, prefix]) => {
        str = str.replaceAll(tag, `${prefix ?? ""}${tag}${"\n".repeat(n)}`);
      });
      return str;
    }
    doc.body.outerHTML = addBreaks(doc.body.outerHTML, [
      ["</p>", 2],
      ["</li>", 1],
      ["<ul>", 1],
      ["</ul>", 1],
      ["<ol>", 1],
      ["</ol>", 1],
      ["</pre>", 1],
      ["<li>", 0, "- "]
    ]).replaceAll(/<\/h([1-6])>/g, "</h$1>\n\n");

    doc.querySelector(".mt-1 > .p-1")?.remove();
    doc.querySelector(".mt-1.flex.gap-3")?.remove();

    let txt = doc.body.textContent;
    if (type === "copyMathML")
      txt = txt.replaceAll(/<\/math>\n+/g, "</math>\n")
               .replaceAll(/<\/math>\n*<math/g, "</math>\n\n<math");
    else
      txt = txt.replaceAll("$\\displaystyle$", "\\\\displaystyle");

    copyToClipboard(txt.replaceAll(/\n{3,}/g, "\n\n"));
  };
});

/* ─────────────────────────────────────────────────────────────────── */
/*        4 ◇  ASSET FETCH + CHAT OBSERVER BOOTSTRAP                  */
/* ─────────────────────────────────────────────────────────────────── */
fetchSVGContent("word", svg => {
  wordSvgContent = svg;

  fetchSVGContent("latex", svg2 => {
    latexSvgContent = svg2;

    /* context-menu event once SVGs are ready */
    if (!isAndroid)
      document.addEventListener("contextmenu", openContextMenu);
    else
      document.addEventListener("click", openContextMenu);

    /* observer + initial injection */
    window.updateChat = () => {
      if (!isChatGPT) return;

      const wait = setInterval(() => {
        chatRoot = document.querySelector("main");
        if (chatRoot) {
          clearInterval(wait);
          chatRoot.addEventListener("scroll", removeContextMenu);
          injectButtons();                       // first run

          new MutationObserver(injectButtons).observe(chatRoot, {
            childList: true,
            subtree: true
          });
        }
      }, 50);
    };

    /* kick-start once */
    updateChat();
  });
});
/* -----------------------------  EOF ------------------------------- */
