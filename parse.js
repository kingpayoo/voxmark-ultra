// VoxMark Ultra — a fast, dependency-free CommonMark 0.31.2 + GFM 0.29
// renderer that returns exactly the HTML marked 18.1.3 produces with its
// default options (gfm on, breaks off, pedantic off). Direct-to-HTML:
// no token tree, index-based scanning, one pass per level.
// Written fresh for the make.fun markdown-render-speed-02 bounty.

export function parse(md) {
  return renderDoc(md);
}

// ---------- character classes (code units) ----------
function isWs(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 ||
    c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}
function isBlankLine(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}
function isAsciiPunct(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
// Unicode punctuation / symbol (CommonMark "punctuation" = Unicode P or S).
const UNI_PUNCT_RE = /[\p{P}\p{S}]/u;
function isPunctCode(c) {
  if (c < 128) return isAsciiPunct(c);
  return UNI_PUNCT_RE.test(String.fromCharCode(c));
}
function isPunctChar(ch) {
  return isPunctCode(ch.charCodeAt(0));
}

// ---------- escaping ----------
// Text content: escape & (unless it begins a valid entity), <, >, " and '.
const ENT_NUM_RE = /^&#(?:[0-9]{1,7}|[xX][0-9a-fA-F]{1,6});/;
const ENT_NAME_RE = /^&[A-Za-z][A-Za-z0-9]*;/;
function escText(s) {
  let out = "";
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) { // &
      const rest = s.slice(i);
      const m = ENT_NUM_RE.exec(rest) || ENT_NAME_RE.exec(rest);
      if (m) {
        if (m[0].charCodeAt(1) === 35) {
          out += s.slice(start, i) + decodeNumericEntity(m[0]);
          i += m[0].length - 1;
          start = i + 1;
        }
        // named entity: passed through unchanged
      } else {
        out += s.slice(start, i) + "&amp;";
        start = i + 1;
      }
    } else if (c === 60) { // <
      out += s.slice(start, i) + "&lt;";
      start = i + 1;
    } else if (c === 62) { // >
      out += s.slice(start, i) + "&gt;";
      start = i + 1;
    } else if (c === 34) { // "
      out += s.slice(start, i) + "&quot;";
      start = i + 1;
    } else if (c === 39) { // '
      out += s.slice(start, i) + "&#39;";
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}
// Decode a numeric character reference; 0, surrogates and >0x10FFFF -> U+FFFD.
// A decoded HTML-special char is returned already escaped (&#X22; -> &quot;).
function decodeNumericEntity(ref) {
  const body = ref.slice(2, -1);
  let cp;
  if (body.charCodeAt(0) === 120 || body.charCodeAt(0) === 88) {
    cp = parseInt(body.slice(1), 16);
  } else {
    cp = parseInt(body, 10);
  }
  if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return "\uFFFD";
  if (cp === 38) return "&amp;";
  if (cp === 60) return "&lt;";
  if (cp === 62) return "&gt;";
  if (cp === 34) return "&quot;";
  if (cp === 39) return "&#39;";
  return String.fromCodePoint(cp);
}
// Code spans / code blocks: escape & < > " ' (no entity recognition here).
function escFull(s) {
  let out = "";
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      out += s.slice(start, i) + "&amp;";
      start = i + 1;
    } else if (c === 60) {
      out += s.slice(start, i) + "&lt;";
      start = i + 1;
    } else if (c === 62) {
      out += s.slice(start, i) + "&gt;";
      start = i + 1;
    } else if (c === 34) {
      out += s.slice(start, i) + "&quot;";
      start = i + 1;
    } else if (c === 39) {
      out += s.slice(start, i) + "&#39;";
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}
// Attribute values (href / title): escape & (unless a valid entity), <, >,
// " — a ' needs no escaping inside a double-quoted attribute.
function escAttr(s) {
  let out = "";
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      const rest = s.slice(i);
      const m = ENT_NUM_RE.exec(rest) || ENT_NAME_RE.exec(rest);
      if (m) {
        if (m[0].charCodeAt(1) === 35) {
          out += s.slice(start, i) + decodeNumericEntity(m[0]);
          i += m[0].length - 1;
          start = i + 1;
        }
        continue; // named entity preserved
      }
      out += s.slice(start, i) + "&amp;";
      start = i + 1;
    }
    else if (c === 60) { out += s.slice(start, i) + "&lt;"; start = i + 1; }
    else if (c === 62) { out += s.slice(start, i) + "&gt;"; start = i + 1; }
    else if (c === 34) { out += s.slice(start, i) + "&quot;"; start = i + 1; }
  }
  return start === 0 ? s : out + s.slice(start);
}

// ---------- URLs ----------
// marked: encodeURI, then restore %25 -> %. Returns null on bad input.
function encodeHref(href) {
  try {
    return encodeURI(href).replace(/%25/g, "%");
  } catch (_) {
    return null;
  }
}
// Unescape backslash-escaped punctuation inside a URL / title.
function unescapePunct(s) {
  if (s.indexOf("\\") === -1) return s;
  let out = "";
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 92 && i + 1 < s.length && isAsciiPunct(s.charCodeAt(i + 1))) {
      out += s.slice(start, i) + s[i + 1];
      i++;
      start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}

// Expand tabs to spaces, tracking the column (tab stops every 4).
function expandTabs(s, col) {
  if (s.indexOf("\t") === -1) return s;
  let out = "";
  let c = col;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 9) {
      const n = 4 - (c % 4);
      out += s.slice(start, i) + " ".repeat(n);
      c += n;
      start = i + 1;
    } else {
      c++;
    }
  }
  return out + s.slice(start);
}
// Column width of a prefix (tabs count to next multiple of 4).
function colWidth(s) {
  let c = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 9) c += 4 - (c % 4);
    else c++;
  }
  return c;
}
// Remove up to n columns of leading whitespace from s, where s starts at
// column startCol (tabs expand to the next multiple of 4). Leading tabs are
// expanded to spaces (by absolute column) so a tab that straddles the cut
// leaves the right number of spaces and later tabs keep their width.
// Tabs after the first non-whitespace character are left untouched.
function stripColumns(s, n, startCol) {
  if (n <= 0) return s;
  let i = 0;
  let col = startCol;
  let spaces = "";
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32) { spaces += " "; col++; i++; }
    else if (c === 9) { const w = 4 - (col % 4); spaces += " ".repeat(w); col += w; i++; }
    else break;
  }
  if (spaces.length <= n) return s.slice(i);
  return spaces.slice(n) + s.slice(i);
}
// Strip n columns for CODE content: a tab that starts at or beyond the
// strip boundary is kept literally (indented/fenced code is literal text).
function stripCodeColumns(s, n, startCol) {
  if (n <= 0) return s;
  const target = startCol + n;
  let i = 0;
  let col = startCol;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32) {
      if (col >= target) break;
      col++; i++;
    } else if (c === 9) {
      if (col >= target) break;
      const w = 4 - (col % 4);
      if (col + w <= target) { col += w; i++; }
      // A tab that STRADDLES the strip boundary is removed ENTIRELY
      // by marked (fenced code, doc-13/17): no remainder spaces are
      // left, even though the tab extends past the target.
      else return s.slice(i + 1);
    } else break;
  }
  return s.slice(i);
}
// Remove up to n columns of indent from a line start (tab-aware).
function stripIndent(line, n) {
  return stripColumns(line, n, 0);
}

// ================= INLINE =================
// Item kinds:
//  {t:'x', s} text (raw; escaped at render)
//  {t:'d', c, n, o, cl} delimiter run: c='*'|'_'|'~', n=len, o=canOpen, cl=canClose
//  {t:'c', s} code span (content already processed; escFull at render)
//  {t:'b'} hard break <br>
//  {t:'h', s} raw HTML
//  {t:'l', href, ti, im, ch} link/image (ch = inner items, ti=title|null)
//  {t:'a', href, s} autolink
//  {t:'e', ch} em, {t:'s', ch} strong, {t:'del', ch} del (built by resolver)

// Flanking for a delimiter run at [i, i+n) in src.
function flankInfo(src, i, n, ch) {
  const prev = i > 0 ? src[i - 1] : "";
  const next = i + n < src.length ? src[i + n] : "";
  const prevWs = prev === "" ? true : isWs(prev.charCodeAt(0));
  const nextWs = next === "" ? true : isWs(next.charCodeAt(0));
  const prevP = prev === "" ? false : isPunctChar(prev);
  const nextP = next === "" ? false : isPunctChar(next);
  const left = !nextWs && (!nextP || prevWs || prevP);
  const right = !prevWs && (!prevP || nextWs || nextP);
  let open = left, close = right;
  if (ch === 95) { // _
    open = left && (!right || prevP);
    close = right && (!left || nextP);
  }
  return { open, close, prev, next };
}

// Find a code span starting at src[i] (a run of n backticks). Returns
// {content, end} or null. Content has newlines -> spaces and one
// leading+trailing space stripped when both present and not all spaces.
function matchCodeSpan(src, i) {
  let n = 0;
  while (i + n < src.length && src.charCodeAt(i + n) === 96) n++;
  // find a closing run of exactly n backticks not followed by another
  let j = i + n;
  while (j < src.length) {
    const k = src.indexOf("`".repeat(n), j);
    if (k === -1) return null;
    // closing run must not be followed by another backtick
    if (k + n < src.length && src.charCodeAt(k + n) === 96) { j = k + 1; continue; }
    // and must not be part of a longer run on the left
    if (k > 0 && src.charCodeAt(k - 1) === 96) { j = k + 1; continue; }
    let content = src.slice(i + n, k).replace(/\n/g, " ");
    if (content.length > 0 && content[0] === " " && content[content.length - 1] === " " &&
        /[^ ]/.test(content)) {
      content = content.slice(1, -1);
    }
    return { content, end: k + n };
  }
  return null;
}

// Match a raw HTML tag / comment / PI / CDATA / declaration at src[i] ('<').
// Returns the matched string or null.
function matchHtmlTag(src, i) {
  const s = src.slice(i);
  let m;
  if (s.startsWith("<!--")) {
    const e = s.indexOf("-->");
    if (e !== -1) return s.slice(0, e + 3);
    return null;
  }
  if (s.startsWith("<?")) {
    const e = s.indexOf("?>");
    if (e !== -1) return s.slice(0, e + 2);
    return null;
  }
  if (s.startsWith("<![CDATA[")) {
    const e = s.indexOf("]]>");
    if (e !== -1) return s.slice(0, e + 3);
    return null;
  }
  if (s.startsWith("<!") && s.length > 2 && /[A-Za-z]/.test(s[2])) {
    const e = s.indexOf(">");
    if (e !== -1) return s.slice(0, e + 1);
    return null;
  }
  // closing tag
  m = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>/.exec(s);
  if (m) return m[0];
  // opening tag (with attributes)
  m = /^<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/.exec(s);
  if (m) return m[0];
  return null;
}

// Match an angle autolink <scheme:...> or <email> at src[i]. Returns
// {href, text, end} or null.
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/;
function matchAngleAutolink(src, i) {
  if (src.charCodeAt(i) !== 60) return null;
  const rest = src.slice(i + 1);
  const gt = rest.indexOf(">");
  if (gt === -1) return null;
  const inner = rest.slice(0, gt);
  if (inner.indexOf(" ") !== -1 || inner.indexOf("\n") !== -1 || inner.indexOf("<") !== -1) return null;
  if (inner.length === 0) return null;
  const sm = SCHEME_RE.exec(inner);
  if (sm && sm[0] === inner) return { href: inner, text: inner, end: i + 1 + gt + 1 };
  const em = EMAIL_RE.exec(inner);
  if (em && em[0] === inner) return { href: "mailto:" + inner, text: inner, end: i + 1 + gt + 1 };
  return null;
}

// Scan inline markdown into items. st = {inLink, inRaw, linkEmitted}.
// Returns the items array. Link/image parsing is in the next chunk.
function scanInline(src, refs, st) {
  const items = [];
  // emStrong whole-source mask (marked's ze): only when the source can
  // contain an emphasis delimiter; otherwise there is nothing to check.
  // `spans` are the masked intervals; a delimiter run starting inside
  // one is literal text, not a delimiter (see maskEmStrongSrc).
  let zeSpans = null;
  if (src.indexOf("*") !== -1 || src.indexOf("_") !== -1) {
    const mm = maskEmStrongSrc(src);
    items.ze = lastPossibleEmStrong(mm.masked);
    zeSpans = mm.spans;
  }
  // Is source position p inside a masked span? Spans are sorted by
  // start (replace visits matches left to right); `si` is a cursor.
  let zeSi = 0;
  const zeMasked = (p) => {
    if (!zeSpans) return false;
    while (zeSi < zeSpans.length && zeSpans[zeSi][1] <= p) zeSi++;
    return zeSi < zeSpans.length && zeSpans[zeSi][0] <= p && p < zeSpans[zeSi][1];
  };
  let text = "";
  const flush = () => {
    if (text.length) { items.push({ t: "x", s: text, e: st.inRaw }); text = ""; }
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    // backslash escape / hard break
    if (c === 92) {
      if (i + 1 < n && src.charCodeAt(i + 1) === 10) {
        flush(); items.push({ t: "b" }); i += 2;
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        continue;
      }
      if (i + 1 < n && isAsciiPunct(src.charCodeAt(i + 1))) {
        // a backslash-escaped char is its own text token: it must be
        // escaped on its own (e.g. \& -> &amp;) and must not merge with
        // following text to form an entity (e.g. \&ouml; -> &amp;ouml;)
        flush(); items.push({ t: "x", s: src[i + 1], e: st.inRaw }); i += 2; continue;
      }
      text += "\\"; i++; continue;
    }
    // hard break: 2+ spaces then newline
    if (c === 32) {
      let j = i;
      while (j < n && src.charCodeAt(j) === 32) j++;
      if (j - i >= 2 && j < n && src.charCodeAt(j) === 10) {
        flush(); items.push({ t: "b" }); i = j + 1;
        // leading spaces/tabs at the start of the next line are dropped
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        continue;
      }
      text += src.slice(i, j); i = j; continue;
    }
    // newline inside a paragraph: literal newline (kept in text)
    if (c === 10) { text += "\n"; i++; continue; }
    // code span
    if (c === 96) {
      const cs = matchCodeSpan(src, i);
      if (cs) { flush(); items.push({ t: "c", s: cs.content }); i = cs.end; continue; }
      // no matching closer: the whole backtick run is literal text
      let run = 0;
      while (i + run < n && src.charCodeAt(i + run) === 96) run++;
      text += "`".repeat(run); i += run; continue;
    }
    // strikethrough / emphasis delimiters
    if (c === 42 || c === 95 || c === 126) {
      let run = 0;
      while (i + run < n && src.charCodeAt(i + run) === c) run++;
      // A delimiter run starting inside a masked span (marked's ze mask
      // treats the span as atomic) is literal text, not a delimiter.
      if (zeMasked(i)) { text += src.slice(i, i + run); i += run; continue; }
      if (c === 126) {
        // ~~ or ~ : del delimiter (1-2 tildes that can open or close)
        if (run <= 2) {
          const fl = flankInfo(src, i, run, 126);
          if (fl.open || fl.close) {
            flush();
            items.push({ t: "d", c: "~", n: run, o: fl.open, cl: fl.close, pv: fl.prev, nx: fl.next, pos: i });
            i += run; continue;
          }
        }
        text += src.slice(i, i + run); i += run; continue;
      }
      const fl = flankInfo(src, i, run, c);
      flush();
      items.push({ t: "d", c: c === 42 ? "*" : "_", n: run, o: fl.open, cl: fl.close, pv: fl.prev, nx: fl.next, pos: i });
      i += run; continue;
    }
    // image / link
    if (c === 33 && i + 1 < n && src.charCodeAt(i + 1) === 91) {
      const lk = tryParseLink(src, i + 1, refs, st, true);
      if (lk) { flush(); items.push(lk.item); i = lk.end; continue; }
      text += "!"; i++; continue;
    }
    if (c === 91) {
      const lk = tryParseLink(src, i, refs, st, false);
      if (lk) { flush(); items.push(lk.item); i = lk.end; continue; }
      text += "["; i++; continue;
    }
    // angle autolink / raw HTML
    if (c === 60) {
      const al = matchAngleAutolink(src, i);
      if (al) {
        flush();
        items.push({ t: "a", href: al.href, s: al.text });
        if (al.href.startsWith("mailto:") || /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(al.text)) {
          // an autolink is a link for nesting purposes
        }
        i = al.end; continue;
      }
      const tag = matchHtmlTag(src, i);
      if (tag) {
        flush();
        items.push({ t: "h", s: tag });
        // track <a> / </a> and <pre>/<script> state
        if (/^<a[ >]/i.test(tag)) st.inLink = true;
        else if (/^<\/a\s*>/i.test(tag)) st.inLink = false;
        else if (/^<(pre|script|style|textarea)[ >]/i.test(tag)) st.inRaw = true;
        else if (/^<\/(pre|script|style|textarea)\s*>/i.test(tag)) st.inRaw = false;
        i += tag.length; continue;
      }
      text += "<"; i++; continue;
    }
    // GFM autolinks (suppressed inside link text)
    if (!st.inLink) {
      const ga = tryGfmAutolink(src, i, st, items);
      if (ga) { flush(); items.push({ t: "a", href: ga.href, s: ga.text }); i = ga.end; continue; }
    }
    // plain char (fast path: copy a run of ordinary chars, but stop
    // before a position where a GFM autolink could start)
    let j = i + 1;
    while (j < n) {
      const d = src.charCodeAt(j);
      if (d === 92 || d === 32 || d === 10 || d === 96 || d === 42 || d === 95 ||
          d === 126 || d === 91 || d === 60 || d === 33) break;
      // a URL autolink can start here (h/f/w + scheme, preceded by
      // start / whitespace / punctuation); schemes are case-insensitive
      // but www. must be lowercase
      if (d === 104 || d === 102 || d === 119 || d === 72 || d === 70 || d === 87) {
        const p = src.charCodeAt(j - 1);
        if (isWs(p) || isPunctCode(p)) {
          const r = src.slice(j, j + 8);
          const rl = r.toLowerCase();
          if (rl.startsWith("http://") || rl.startsWith("https://") ||
              rl.startsWith("ftp://") || r.startsWith("www.")) break;
        }
      }
      // an email autolink can start inside this run: scan back over the
      // local part from an @; if it starts after punctuation, break
      // before it so the main loop can form the autolink
      if (d === 64) {
        let ls = j;
        while (ls > i) {
          const cc = src.charCodeAt(ls - 1);
          if ((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) ||
              cc === 46 || cc === 35 || cc === 36 || cc === 37 || cc === 38 || cc === 39 ||
              cc === 43 || cc === 45 || cc === 47 || cc === 61 || cc === 63 || cc === 94 ||
              cc === 123 || cc === 124 || cc === 125) ls--;
          else break;
        }
        if (ls > i && ls < j) {
          const p = src.charCodeAt(ls - 1);
          // scheme prefix FIRST (gfm-633/634/635): if the email is
          // immediately preceded by scheme: (e.g. mailto:foo@bar.baz),
          // break before the scheme start so tryGfmAutolink can form
          // one link. (Checked before the generic punctuation break
          // because ':' is punctuation and would break at the email.)
          if (p === 58) { // ':'
            let ss = ls - 2;
            while (ss >= i) {
              const cc = src.charCodeAt(ss);
              if ((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) ||
                  cc === 43 || cc === 45 || cc === 46) ss--;
              else break;
            }
            ss++;
            if (ss < ls - 1 && ss >= i) {
              const first = src.charCodeAt(ss);
              if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
                const before = ss - 1;
                if (before < i || isWs(src.charCodeAt(before)) || isPunctCode(src.charCodeAt(before))) {
                  j = ss; break;
                }
              }
            }
          }
          if (isWs(p) || isPunctCode(p)) { j = ls; break; }
        }
      }
      j++;
    }
    text += src.slice(i, j);
    i = j;
  }
  flush();
  return items;
}

// ---------- link parsing ----------
// Normalize a link label: collapse whitespace runs to one space, trim,
// lowercase. Used as the key into the refs map.
function normalizeLabel(s) {
  let out = "";
  let inWs = true; // trim leading
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isWs(c)) {
      if (!inWs) { out += " "; inWs = true; }
    } else {
      // Unicode case folding: sharp s (ß U+00DF, ẞ U+1E9E) folds to "ss"
      if (c === 223 || c === 7838) out += "ss";
      else out += s[i].toLowerCase();
      inWs = false;
    }
  }
  if (out.endsWith(" ")) out = out.slice(0, -1);
  return out;
}
// Parse a [...] label starting at src[i] ('['). Handles nested brackets,
// backslash escapes and code spans. Returns {text, end} or null.
// Code spans inside a label follow marked's label regex, NOT the
// inline code-span rule: a label code span is `+ [^`]*? `+ (content
// has NO backtick), and a backtick run immediately before ] is
// consumed literally (`+(?=])). So `` a ` b `` in the MIDDLE of a
// label makes it unmatchable (doc-16/22: the link does not form), but
// the same span at the END of a label is fine (doc-03/05/10: the
// trailing `` before ] is literal).
function parseLabel(src, i) {
  const len = src.length;
  let depth = 0;
  let j = i + 1;
  let seenBt = false; // a label code span was consumed in this label
  while (j < len) {
    const c = src.charCodeAt(j);
    if (c === 92) { j += 2; continue; } // backslash escape
    if (c === 96) {
      let run = 0;
      while (j + run < len && src.charCodeAt(j + run) === 96) run++;
      // A run immediately before ] is a dangling run at the label
      // end. It is literal (alt 4) only when it closes a code span
      // opened earlier in this label (doc-33, run>=2); a lone
      // backtick (cm-525) or a first run is a code-span opener, so
      // the label is unmatchable.
      if (j + run < len && src.charCodeAt(j + run) === 93) {
        if (run >= 2 && seenBt) { j = j + run; continue; }
        return null;
      }
      // Label code span: `+ [^`]*? `+ (no backtick in the content).
      // The content may span a ] (e.g. ``b]c``), so scan to the next
      // backtick without a ] stop.
      let k = j + run;
      while (k < len && src.charCodeAt(k) !== 96) k++;
      if (k < len) {
        // closing run (maximal) right after the non-backtick content
        let m = 0;
        while (k + m < len && src.charCodeAt(k + m) === 96) m++;
        j = k + m; seenBt = true; continue;
      }
      return null;
    }
    if (c === 60) {
      // A ] inside an HTML tag or an angle autolink does not close the
      // label (cm-524/526/536/538: <bar attr="](baz)"> swallows the ]).
      // Skip the whole <...> construct when it is a valid tag/autolink;
      // otherwise treat < as a literal char.
      const tag = matchHtmlTag(src, j);
      if (tag) { j += tag.length; continue; }
      const al = matchAngleAutolink(src, j);
      if (al) { j = al.end; continue; }
      j++; continue;
    }
    if (c === 91) { depth++; j++; continue; }
    if (c === 93) {
      if (depth === 0) return { text: src.slice(i + 1, j), end: j + 1 };
      depth--; j++; continue;
    }
    j++;
  }
  return null;
}
// Parse a link destination + optional title starting at src[i] ('(').
// Returns {dest, title, end} or null. dest is raw (unescaped later).
function parseLinkDest(src, i) {
  const n = src.length;
  let j = i + 1;
  // skip spaces/tabs/newlines
  while (j < n && isWs(src.charCodeAt(j))) j++;
  if (j >= n) return null;
  let dest = "";
  let destEnd = -1;
  if (src.charCodeAt(j) === 60) { // angle <...>
    let k = j + 1;
    let ok = false;
    while (k < n) {
      const c = src.charCodeAt(k);
      if (c === 62) { ok = true; break; }
      if (c === 10 || c === 60) break;
      if (c === 92 && k + 1 < n) { k += 2; continue; }
      k++;
    }
    if (!ok) return null;
    dest = src.slice(j + 1, k);
    destEnd = k + 1;
  } else {
    // bare destination: no spaces/controls, balanced parens
    let k = j;
    let depth = 0;
    while (k < n) {
      const c = src.charCodeAt(k);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c < 32) break;
      if (c === 92 && k + 1 < n) { k += 2; continue; }
      if (c === 40) { depth++; k++; continue; }
      if (c === 41) {
        if (depth === 0) break; // this closes the link
        depth--; k++; continue;
      }
      k++;
    }
    if (depth !== 0) return null;
    dest = src.slice(j, k);
    destEnd = k;
  }
  // optional title: skip spaces/tabs and at most one newline
  let k = destEnd;
  let nl = 0;
  while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k++;
  if (k < n && src.charCodeAt(k) === 10) {
    nl++;
    k++;
    while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k++;
  }
  let title = null;
  if (k < n) {
    const q = src.charCodeAt(k);
    if (q === 34 || q === 39 || q === 40) {
      const close = q === 40 ? 41 : q;
      let t = k + 1;
      let ok = false;
      while (t < n) {
        const c = src.charCodeAt(t);
        if (c === 92 && t + 1 < n) { t += 2; continue; }
        if (c === close) { ok = true; break; }
        if (q !== 40 && c === 10) {
          // title may span lines but not a blank line
          if (t + 1 < n && src.charCodeAt(t + 1) === 10) break;
        }
        if (q === 40 && (c === 40 || c === 41)) break; // parens title: no parens inside
        t++;
      }
      if (ok) { title = src.slice(k + 1, t); k = t + 1; }
    }
  }
  // skip spaces/tabs/newlines, expect ')'
  while (k < n && isWs(src.charCodeAt(k))) k++;
  if (k >= n || src.charCodeAt(k) !== 41) return null;
  return { dest, title, end: k + 1 };
}
// Parse a [...] ref label starting at src[i] ('['). Returns {label, end} or null.
function parseRefLabel(src, i) {
  const n = src.length;
  let j = i + 1;
  let out = "";
  while (j < n) {
    const c = src.charCodeAt(j);
    if (c === 93) {
      if (normalizeLabel(out).length === 0 && out.length > 0 && /^[\s]*$/.test(out)) return null;
      return { label: out, end: j + 1 };
    }
    if (c === 91 || c === 92 && j + 1 < n && src.charCodeAt(j + 1) === 93) {
      if (c === 91) return null; // no nested brackets in a ref
    }
    // Keep backslashes in the label: ref labels match literally (case
    // folding + whitespace only, no unescaping), so [foo\!] must NOT
    // match [foo!] (cm-545) while [ref\[] DOES match [ref\[] (cm-549).
    if (c === 92 && j + 1 < n) { out += src[j] + src[j + 1]; j += 2; continue; }
    out += src[j]; j++;
  }
  return null;
}

// Try to parse a link/image at src[i] ('['). isImage = preceded by '!'.
// Returns {item, end} or null.
function tryParseLink(src, i, refs, st, isImage) {
  const lab = parseLabel(src, i);
  if (!lab) return null;
  let href = null;
  let title = null;
  let end = lab.end;
  const n = src.length;
  if (end < n && src.charCodeAt(end) === 40) {
    const d = parseLinkDest(src, end);
    if (d) {
      href = d.dest;
      title = d.title;
      end = d.end;
    } else {
      // Inline destination invalid (e.g. spaces): fall back to the
      // shortcut reference [foo] (cm-568: [foo](not a link) + [foo]: /url1
      // renders <a href="/url1">foo</a> followed by "(not a link)").
      const r = refs[normalizeLabel(lab.text)];
      if (!r) return null;
      href = r.href; title = r.title;
      // end stays at lab.end so "(not a link)" is literal text after.
    }
  } else if (end < n && src.charCodeAt(end) === 91) {
    const rl = parseRefLabel(src, end);
    if (!rl) return null;
    const key = rl.label.length === 0 ? normalizeLabel(lab.text) : normalizeLabel(rl.label);
    const r = refs[key];
    if (!r) return null;
    href = r.href; title = r.title;
    end = rl.end;
  } else {
    // shortcut reference
    const r = refs[normalizeLabel(lab.text)];
    if (!r) return null;
    href = r.href; title = r.title;
  }
  // Parse the label text as inline (links inside are suppressed for the
  // outer link: if one forms, the outer link does not form).
  const savedLink = st.inLink;
  const savedEmitted = st.linkEmitted;
  st.inLink = true;
  st.linkEmitted = false;
  const inner = scanInline(lab.text, refs, st);
  const innerEmitted = st.linkEmitted;
  st.inLink = savedLink;
  st.linkEmitted = savedEmitted;
  if (innerEmitted && !isImage) return null;
  if (!isImage) st.linkEmitted = true;
  const cleanHref = unescapePunct(href);
  const cleanTitle = title === null ? null : unescapePunct(title);
  if (isImage) {
    return { item: { t: "l", href: cleanHref, ti: cleanTitle, im: true, ch: inner }, end };
  }
  return { item: { t: "l", href: cleanHref, ti: cleanTitle, im: false, ch: inner }, end };
}

// Trim trailing punctuation from a URL candidate (backpedal, matching
// marked's GFM url tokenizer). The backpedal regex consumes the URL
// left-to-right: runs of non-punct chars, balanced (...) groups, '&'
// not starting an entity, and trailing punct only when NOT at end of
// string. A simple paren COUNT is wrong here: in
// '...page=4)](./docs/create.md)' the '(./docs/create.md)' group is
// balanced, so the trailing ')' is kept — but a count sees 1 '(' vs
// 2 ')' and wrongly drops it (doc-12).
const AUTOLINK_BACKPEDAL = /^(?:[^?!.,:;*_'\"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/;
function trimAutolinkTail(u) {
  // marked applies the backpedal in a loop until stable: one pass
  // leaves '...(business))' (two ')'), a second pass leaves one.
  let end = u.length;
  let prev = -1;
  while (prev !== end && end > 0) {
    prev = end;
    const m = AUTOLINK_BACKPEDAL.exec(u.slice(0, end));
    end = m ? m[0].length : 0;
  }
  // numeric entity &#...; : the backpedal drops only the ';', leaving
  // '&#123'. Remove the whole entity.
  if (end > 0) {
    const tail = u.slice(0, end);
    const em = /&#\d+$/.exec(tail) || /&#x[0-9a-fA-F]+$/.exec(tail);
    if (em) end -= em[0].length;
  }
  // safety net: drop any trailing punctuation the backpedal left
  while (end > 0) {
    const c = u.charCodeAt(end - 1);
    if (c === 63 || c === 33 || c === 46 || c === 44 || c === 58 || c === 59 ||
        c === 42 || c === 95 || c === 126 || c === 39 || c === 34) {
      end--;
    } else break;
  }
  return u.slice(0, end);
}
const EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+/;
// Match an email local@domain starting at src[i]. Returns {text, end} or null.
function matchEmailAt(src, i) {
  const n = src.length;
  const lm = EMAIL_LOCAL_RE.exec(src.slice(i));
  if (!lm) return null;
  let j = i + lm[0].length;
  if (j >= n || src.charCodeAt(j) !== 64) return null; // '@'
  // Domain per marked's GFM email regex:
  // [A-Za-z0-9-_]+ (first label, may contain _) then
  // (\.[A-Za-z0-9-_]*[A-Za-z0-9])+ (each dot-label ends in alnum),
  // then (?![\w-]) — must not be followed by a word char or '-'.
  const isAl = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  let k = j + 1;
  const firstStart = k;
  while (k < n) {
    const c = src.charCodeAt(k);
    if (isAl(c) || c === 45 || c === 95) k++;
    else break;
  }
  if (k === firstStart) return null;
  let labels = 0;
  let end = k;
  while (k < n && src.charCodeAt(k) === 46) {
    let m = k + 1;
    const ls = m;
    while (m < n) {
      const c = src.charCodeAt(m);
      if (isAl(c) || c === 45 || c === 95) m++;
      else break;
    }
    if (m === ls) break;
    let la = -1;
    for (let q = m - 1; q >= ls; q--) {
      if (isAl(src.charCodeAt(q))) { la = q + 1; break; }
    }
    if (la === -1) break;
    labels++;
    end = la;
    k = m;
    if (la < m) { k = la; break; }
  }
  if (labels < 1) return null;
  // (?![\w-]) lookahead at end
  if (end < n) {
    const c = src.charCodeAt(end);
    if (isAl(c) || c === 95 || c === 45) {
      // Blocked. A trailing '_' run may be an emphasis closer
      // (doc-25 __...__): signal it so the caller, which knows the
      // delimiter context, can allow the link. Alnum/'-' never links.
      if (c === 95) {
        let ue = end;
        while (ue < n && src.charCodeAt(ue) === 95) ue++;
        return { text: src.slice(i, end), end, blockedUnderscore: ue };
      }
      return null;
    }
  }
  return { text: src.slice(i, end), end };
}
function tryGfmAutolink(src, i, st, items) {
  const n = src.length;
  // Is there an unmatched '_' opener in the items scanned so far that
  // a trailing '_' run could close (doc-25: the __ of __...__)? A
  // trailing '_' with no such opener is not emphasis, so the email
  // must not link at all (gfm-632/633).
  const hasUnderscoreOpener = (runLen) => {
    if (!items) return false;
    const need = runLen >= 2 ? 2 : 1;
    for (let q = items.length - 1; q >= 0; q--) {
      const it = items[q];
      if (it.t === "d" && it.c === "_" && it.o && it.n >= need) return true;
    }
    return false;
  };
  // Resolve a matchEmailAt result: a clean match links; a
  // blocked-by-underscore match links only if the '_' run is an
  // emphasis closer (has an opener in the scanned items).
  const emailResult = (em) => {
    if (!em) return null;
    if (em.blockedUnderscore !== undefined) {
      const runLen = em.blockedUnderscore - em.end;
      if (!hasUnderscoreOpener(runLen)) return null;
      return { text: em.text, end: em.end };
    }
    return em;
  };
  // must be preceded by start / whitespace / punctuation
  if (i > 0) {
    const p = src.charCodeAt(i - 1);
    if (!isWs(p) && !isPunctCode(p)) return null;
  }
  const rest = src.slice(i);
  // schemes are case-insensitive; www. must be lowercase
  let m = /^(?:https?:\/\/|ftp:\/\/)[^\s<]*/i.exec(rest);
  if (!m) m = /^www\.[^\s<]*/.exec(rest);
  if (m) {
    let url = trimAutolinkTail(m[0]);
    if (url.length === 0) return null;
    // a bare scheme with nothing after it is not a link
    if (/^(?:https?:\/\/|ftp:\/\/)$/i.test(url) || url === "www.") return null;
    // www. needs a dot in the host part
    const isWww = url.startsWith("www.");
    if (isWww && url.indexOf(".", 4) === -1) return null;
    const href = isWww ? "http://" + url : url;
    return { href, text: url, end: i + url.length };
  }
  // Generic scheme (mailto:, xmpp:, ...) followed by an email-like
  // pattern (gfm-633/634/635). Narrow: only when the scheme is
  // immediately followed by a valid email. The URL may carry one
  // /segment after the email (xmpp resource); a second '/' ends it.
  const sm = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(rest);
  if (sm) {
    const em = emailResult(matchEmailAt(src, i + sm[0].length));
    if (em) {
      let url = sm[0] + em.text;
      let endPos = em.end;
      if (endPos < n && src.charCodeAt(endPos) === 47) { // '/'
        let k = endPos + 1;
        while (k < n) {
          const c = src.charCodeAt(k);
          if (c === 32 || c === 9 || c === 10 || c === 60 || c === 47) break;
          k++;
        }
        if (k > endPos + 1) { url += src.slice(endPos, k); endPos = k; }
      }
      url = trimAutolinkTail(url);
      if (url.length > sm[0].length) {
        return { href: url, text: url, end: i + url.length };
      }
    }
  }
  // email: local@domain (domain labels, last label alnum)
  const em2 = emailResult(matchEmailAt(src, i));
  if (em2) return { href: "mailto:" + em2.text, text: em2.text, end: em2.end };
  return null;
}

// ---------- emStrong masking (marked's ze / lastPossibleEmStrongCloserIndex) ----------
// marked's emStrong tokenizer does a WHOLE-SOURCE scan: it masks links,
// code spans and HTML tags (via the `ot` regex, after `Ot` replaces inner
// backticks in code spans), then records the last delimiter run (* or _)
// preceded by a non-whitespace char. If that index is before an opener's
// end, the opener can never close and no emphasis forms. This suppresses
// emphasis inside failed link labels whose code spans contain an inner
// backtick (the mask "sees" a link the tokenizer rejects), and inside
// any masked span. Reflink masking (marked's #n first step) is omitted:
// it only removes MORE delimiters, so omitting it can only under-
// suppress, never over-suppress (no false positives).
const ZE_OT_RE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const ZE_BLOCKSKIP_RE = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;
function maskEmStrongSrc(src) {
  // Returns {masked, spans}: the masked source plus the [start,end)
  // intervals (in src coordinates) that blockSkip replaced. Ot preserves
  // length, so blockSkip offsets in the Ot-modified string equal src
  // offsets. A delimiter run starting inside a span is invisible to
  // marked's emphasis machinery (the mask treats the span as atomic
  // even when our tokenizer rejects it — e.g. a code span opened by a
  // dangling backtick, or a failed link label).
  const spans = [];
  let t = src;
  t = t.replace(ZE_OT_RE, (n, s, r) => r ? "+".repeat(n.length) : s ? s + n.slice(s.length, -s.length).replace(/`/g, "+") + s : n);
  t = t.replace(ZE_BLOCKSKIP_RE, (n, s, r, b, off) => {
    spans.push([off, off + n.length]);
    const o = r ? r.length : 0;
    return n.slice(0, o) + "[" + "a".repeat(n.length - o - 2) + "]";
  });
  return { masked: t, spans };
}
// Last delimiter run (* or _) preceded by a non-whitespace char, in the
// masked source. Returns {s: lastStar, u: lastUnder} (-1 if none).
function lastPossibleEmStrong(masked) {
  let s = -1, u = -1;
  const n = masked.length;
  for (let i = 0; i < n; i++) {
    const r = masked[i];
    if (r !== "*" && r !== "_") continue;
    const o = i === 0 ? "\n" : masked[i - 1];
    let j = i + 1;
    while (j < n && masked[j] === r) j++;
    if (o !== " " && o !== "\t" && o !== "\n" && o !== "\r" && o !== "\f") {
      if (r === "*") s = i; else u = i;
    }
    i = j - 1;
  }
  return { s, u };
}

// ---------- emphasis / strikethrough resolution ----------
// Find a closer for the opener at items[oi] (delimiter '*'/ '_') using
// marked's m-counter: m starts at the opener length; later left-only runs
// of the same char add their length; right runs subtract (after the
// odd-match check for runs that can also open); the run that brings m<=0
// is the closer. Returns {closer, use} or null.
function findEmCloser(items, oi) {
  const op = items[oi];
  const k = op.n;
  const ch = op.c;
  // marked's ze gate: if the last possible closer for this delimiter in
  // the whole masked source is before the opener's end, no emphasis can
  // form here at all (the opener sits inside a masked span — a failed
  // link label, a code span, or an HTML tag — whose delimiters the mask
  // removed). Returns null without touching the m-counter.
  const ze = items.ze;
  if (ze && op.pos !== undefined) {
    const last = ch === "*" ? ze.s : ze.u;
    if (last < op.pos + k) return null;
  }
  const y = k;
  const prevWs = op.pv === "" || isWs(op.pv.charCodeAt(0));
  const prevP = op.pv !== "" && isPunctChar(op.pv);
  const nextP = op.nx !== "" && isPunctChar(op.nx);
  // R: the opener can also close
  const R = !prevWs && (nextP || (ch === "*" && !prevP));
  const o = op.pv === ch; // previous char is the same delimiter
  let m = k;
  let f = 0;
  let firstValid = null;
  let hadIntervening = false;
  // marked's emStrong RDelim first alternative
  // (^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)) skips a `__...*...__` span at
  // the START of the closer search (cm-470): the `*` inside that strong
  // must not inflate the m-counter. It only fires when the first
  // `*`/`_` delimiter after the opener is a `__` opener, the next is a
  // `*` opener, and the next after that is a `__` closer (no other
  // `*`/`_` delimiter in between). Find that `*` index, if any.
  let skipIdx = -1;
  if (ch === "*") {
    const firstDelim = (from) => {
      for (let j = from; j < items.length; j++) {
        const it = items[j];
        if (it.t === "d" && (it.c === "*" || it.c === "_")) return j;
      }
      return -1;
    };
    const u1 = firstDelim(oi + 1);
    if (u1 !== -1 && items[u1].c === "_" && items[u1].n >= 2 && items[u1].o) {
      const s1 = firstDelim(u1 + 1);
      if (s1 !== -1 && items[s1].c === "*" && items[s1].o) {
        const u2 = firstDelim(s1 + 1);
        if (u2 !== -1 && items[u2].c === "_" && items[u2].n >= 2 && items[u2].cl) skipIdx = s1;
      }
    }
  }
  for (let j = oi + 1; j < items.length; j++) {
    const it = items[j];
    if (it.t !== "d" || it.c !== ch) continue;
    const b = it.n;
    if (j === skipIdx) continue; // swallowed by the RDelim `__...*...__` skip
    if (it.o && !it.cl) { m += b; hadIntervening = true; continue; } // left-only: opener
    if (!it.cl) continue; // cannot close
    if ((it.o && it.cl) || R) {
      if (o && it.o && it.cl) return null; // run-boundary break
      if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; continue; } // odd-match: skip
    }
    if (firstValid === null) firstValid = { closer: j, use: b };
    m -= b;
    if (m > 0) continue;
    return { closer: j, use: Math.min(b, b + m + f) };
  }
  // Fallback: opener longer than any closer (e.g. **foo*, ***foo**).
  // CommonMark matches with 1-2 delimiters and leaves the rest of the
  // opener literal; the m-balance above never reaches 0 in that case.
  // BUT only when no intervening opener consumed the closer (cm-471:
  // **foo **bar baz** — the first ** must stay literal because the
  // second ** claims the final ** as its closer).
  if (hadIntervening) return null;
  return firstValid;
}
// Find a closer for a '~' delimiter: the closer must have the same length.
function findDelCloser(items, oi) {
  const op = items[oi];
  const o = op.n;
  let p = o;
  for (let j = oi + 1; j < items.length; j++) {
    const it = items[j];
    if (it.t !== "d" || it.c !== "~" || it.n !== o) continue;
    if (it.o && !it.cl) { p += o; continue; }
    if (!it.cl) continue;
    p -= o;
    if (p > 0) continue;
    return { closer: j, use: o };
  }
  return null;
}
// Resolve emphasis/del over an items array (outside-in, recursive).
// Returns a new array.
function resolveEmph(items, refs, st) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.t === "d" && it.o && it.c !== "~") {
      const m = findEmCloser(items, i);
      if (m) {
        const cl = items[m.closer];
        const take = (Math.min(it.n, m.use) % 2 === 1) ? 1 : 2;
        const inner = [];
        const leftOver = it.n - take;
        const closeLeft = m.use - take;
        if (leftOver > 0) {
          // Does the leftover opener have anything to pair with inside?
          // Either a leftover closer (cm-416) or a same-char delimiter
          // in the inner range (cm-408/413/430: the leftover opens a
          // nested emphasis closed by a delimiter inside the range).
          let innerDelim = closeLeft > 0;
          if (!innerDelim) {
            for (let k = i + 1; k < m.closer; k++) {
              if (items[k].t === "d" && items[k].c === it.c) { innerDelim = true; break; }
            }
          }
          if (innerDelim) {
            // Leftover opener pairs inside: it belongs INSIDE (forms a
            // nested emphasis, cm-416/408/413).
            // Leftover opener is at the START of the inner content (the
            // delimiter(s) used for the outer emphasis are gone), so its
            // previous char is empty — NOT the delimiter char itself.
            // Using pv: it.c made findEmCloser see o=true and hit the
            // run-boundary break, killing the inner <strong> (cm-416).
            inner.push({ t: "d", c: it.c, n: leftOver, o: it.o, cl: it.cl, pv: "", nx: it.nx, pos: it.pos });
          } else {
            // No leftover closer and no inner delimiter: the leftover
            // opener cannot form an inner emphasis, so it is literal and
            // goes BEFORE the emphasis element (cm-442: **foo* ->
            // *<em>foo</em>).
            out.push({ t: "x", s: it.c.repeat(leftOver) });
          }
        }
        for (let k = i + 1; k < m.closer; k++) inner.push(items[k]);
        if (closeLeft > 0) {
          inner.push({ t: "d", c: cl.c, n: closeLeft, o: cl.o, cl: cl.cl, pv: cl.pv, nx: cl.nx, pos: cl.pos });
        }
        inner.ze = items.ze;
        out.push({ t: take === 1 ? "e" : "s", ch: resolveEmph(inner, refs, st) });
        if (cl.n - m.use > 0) {
          out.push({ t: "d", c: cl.c, n: cl.n - m.use, o: cl.o, cl: cl.cl, pv: cl.c, nx: cl.nx, pos: cl.pos });
        }
        i = m.closer + 1;
        continue;
      }
      out.push({ t: "x", s: it.c.repeat(it.n) });
      i++;
      continue;
    }
    if (it.t === "d" && it.o && it.c === "~") {
      const m = findDelCloser(items, i);
      if (m) {
        const cl = items[m.closer];
        const inner = [];
        for (let k = i + 1; k < m.closer; k++) inner.push(items[k]);
        inner.ze = items.ze;
        out.push({ t: "del", ch: resolveEmph(inner, refs, st) });
        i = m.closer + 1;
        continue;
      }
      out.push({ t: "x", s: "~".repeat(it.n) });
      i++;
      continue;
    }
    if (it.t === "l") {
      out.push({ t: "l", href: it.href, ti: it.ti, im: it.im, ch: resolveEmph(it.ch, refs, st) });
      i++;
      continue;
    }
    out.push(it);
    i++;
  }
  return out;
}

// Plain-text rendering of items (for image alt text): no tags.
function plainTextOf(items) {
  let s = "";
  for (const it of items) {
    if (it.t === "x" || it.t === "c" || it.t === "h" || it.t === "a") s += it.s;
    else if (it.t === "d") s += it.c.repeat(it.n);
    else if (it.t === "e" || it.t === "s" || it.t === "del") s += plainTextOf(it.ch);
    else if (it.t === "l") s += plainTextOf(it.ch);
  }
  return s;
}

// Render resolved items to HTML.
function renderItems(items, refs, st) {
  let out = "";
  for (const it of items) {
    switch (it.t) {
      case "x":
        out += it.e ? it.s : escText(it.s);
        break;
      case "d":
        out += it.c.repeat(it.n);
        break;
      case "c":
        out += "<code>" + escFull(it.s) + "</code>";
        break;
      case "b":
        out += "<br>";
        break;
      case "h":
        out += it.s;
        break;
      case "a": {
        const href = encodeHref(it.href);
        if (href === null) { out += escFull(it.s); break; }
        out += '<a href="' + escAttr(href) + '">' + escFull(it.s) + "</a>";
        break;
      }
      case "l": {
        if (it.im) {
          const href = encodeHref(it.href);
          const alt = escAttr(plainTextOf(it.ch));
          if (href === null) { out += alt; break; }
          out += '<img src="' + escAttr(href) + '" alt="' + alt + '"';
          if (it.ti !== null && it.ti !== undefined) out += ' title="' + escAttr(it.ti) + '"';
          out += ">";
        } else {
          const href = encodeHref(it.href);
          const inner = renderItems(it.ch, refs, st);
          if (href === null) { out += inner; break; }
          out += '<a href="' + escAttr(href) + '"';
          if (it.ti !== null && it.ti !== undefined) out += ' title="' + escAttr(it.ti) + '"';
          out += ">" + inner + "</a>";
        }
        break;
      }
      case "e":
        out += "<em>" + renderItems(it.ch, refs, st) + "</em>";
        break;
      case "s":
        out += "<strong>" + renderItems(it.ch, refs, st) + "</strong>";
        break;
      case "del":
        out += "<del>" + renderItems(it.ch, refs, st) + "</del>";
        break;
    }
  }
  return out;
}

// Full inline parse: scan, resolve emphasis, render.
function inlineHtml(src, refs, st) {
  if (src === "") return "";
  const items = scanInline(src, refs, st);
  const resolved = resolveEmph(items, refs, st);
  return renderItems(resolved, refs, st);
}

// ================= BLOCKS =================
// Block kinds (lightweight list; inline is parsed at render time, once
// all link reference definitions in the document are known):
//  {k:'p', lines} paragraph (raw lines, defs removed)
//  {k:'h', lv, src} ATX heading
//  {k:'sx', lv, lines} setext heading
//  {k:'fc', lang, text} fenced code
//  {k:'ic', text} indented code
//  {k:'html', text} raw HTML block
//  {k:'hr'}
//  {k:'bq', items} blockquote (items = blocks)
//  {k:'list', ord, start, tight, items} list (items = arrays of blocks)
//  {k:'tab', align, head, rows} table

function renderDoc(md) {
  const s = md.replace(/\r\n?/g, "\n");
  const lines = s.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const refs = Object.create(null);
  const st = { inLink: false, inRaw: false, linkEmitted: false };
  const blocks = parseBlocks(lines, 0, lines.length, refs, st, false, s.endsWith("\n")).blocks;
  return renderBlocks(blocks, refs, st);
}

// Leading indent of a line in columns (tab = to next multiple of 4).
// Returns {col, idx} where idx is the string index after the indent.
function lineIndent(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) { col++; i++; }
    else if (c === 9) { col += 4 - (col % 4); i++; }
    else break;
  }
  return { col, idx: i };
}

// Parse a link reference definition starting at lines[i].
// Returns {key, href, title, next} (next = first line after the def) or null.
function tryRefDef(lines, i) {
  const line = lines[i];
  const ind = lineIndent(line);
  if (ind.col > 3) return null;
  const rest = line.slice(ind.idx);
  if (rest.charCodeAt(0) !== 91) return null; // '['
  // Gather up to 8 lines of body text (the label itself may span lines,
  // and a title may span several lines).
  let body = rest;
  let used = 1;
  while (used < 8 && i + used < lines.length) {
    body += "\n" + lines[i + used];
    used++;
  }
  const n = body.length;
  const lab = parseLabel(body, 0);
  if (!lab) return null;
  // A ref label cannot contain an unescaped '[' (cm-547/548: [ref[bar]]
  // and [[foo]] are not valid definitions). parseLabel allows nested
  // brackets (for link text), so check the raw label text here.
  for (let q = 0; q < lab.text.length; q++) {
    if (lab.text.charCodeAt(q) === 91) {
      let bs = 0;
      for (let r = q - 1; r >= 0 && lab.text.charCodeAt(r) === 92; r--) bs++;
      if (bs % 2 === 0) return null;
    }
  }
  if (body.charCodeAt(lab.end) !== 58) return null; // ':'
  // destination: spaces/tabs, then at most one newline to the next line
  // (a blank line before the destination invalidates the definition)
  let j = lab.end + 1;
  while (j < n && (body.charCodeAt(j) === 32 || body.charCodeAt(j) === 9)) j++;
  if (j < n && body.charCodeAt(j) === 10) {
    j++;
    while (j < n && (body.charCodeAt(j) === 32 || body.charCodeAt(j) === 9)) j++;
    if (j >= n || body.charCodeAt(j) === 10) return null;
  }
  if (j >= n) return null;
  let dest = "";
  if (body.charCodeAt(j) === 60) { // angle <...>
    let k = j + 1;
    let ok = false;
    while (k < n) {
      const c = body.charCodeAt(k);
      if (c === 62) { ok = true; break; }
      if (c === 10 || c === 60) break;
      if (c === 92 && k + 1 < n) { k += 2; continue; }
      k++;
    }
    if (!ok) return null;
    dest = body.slice(j + 1, k);
    j = k + 1;
  } else {
    let k = j;
    let depth = 0;
    while (k < n) {
      const c = body.charCodeAt(k);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c < 32) break;
      if (c === 92 && k + 1 < n) { k += 2; continue; }
      if (c === 40) { depth++; k++; continue; }
      if (c === 41) { depth--; k++; continue; }
      k++;
    }
    if (depth !== 0 || k === j) return null;
    dest = body.slice(j, k);
    j = k;
  }
  const destEnd = j;
  // optional title: only when whitespace separates it from the dest.
  // If the title cannot be parsed cleanly, fall back to dest-only.
  let title = null;
  let titleEnd = destEnd;
  {
    let k = j;
    let skippedWs = false;
    while (k < n && (body.charCodeAt(k) === 32 || body.charCodeAt(k) === 9)) { k++; skippedWs = true; }
    if (k < n && body.charCodeAt(k) === 10) {
      k++; skippedWs = true;
      while (k < n && (body.charCodeAt(k) === 32 || body.charCodeAt(k) === 9)) k++;
    }
    if (skippedWs && k < n) {
      const q = body.charCodeAt(k);
      if (q === 34 || q === 39 || q === 40) {
        const close = q === 40 ? 41 : q;
        let t = k + 1;
        let ok = false;
        while (t < n) {
          const c = body.charCodeAt(t);
          if (c === 92 && t + 1 < n) { t += 2; continue; }
          if (c === close) { ok = true; break; }
          if (q === 40 && (c === 40 || c === 41)) break;
          if (q !== 40 && c === 10 && t + 1 < n && body.charCodeAt(t + 1) === 10) break;
          t++;
        }
        if (ok) {
          // rest of the title's line must be only spaces/tabs
          let eol = t + 1;
          while (eol < n && body.charCodeAt(eol) !== 10) eol++;
          let clean = true;
          for (let q2 = t + 1; q2 < eol; q2++) {
            const c = body.charCodeAt(q2);
            if (c !== 32 && c !== 9) { clean = false; break; }
          }
          if (clean) { title = body.slice(k + 1, t); titleEnd = t + 1; }
        }
      }
    }
  }
  // the definition ends on the title's line (if a title was taken) or on
  // the destination's line; the rest of that line must be spaces/tabs
  const endPos = title === null ? destEnd : titleEnd;
  let eol = endPos;
  while (eol < n && body.charCodeAt(eol) !== 10) eol++;
  for (let q = endPos; q < eol; q++) {
    const c = body.charCodeAt(q);
    if (c !== 32 && c !== 9) return null;
  }
  const consumed = body.slice(0, eol).split("\n").length;
  const key = normalizeLabel(lab.text);
  if (key.length === 0) return null;
  return { key, href: unescapePunct(dest), title: title === null ? null : unescapePunct(title), next: i + consumed };
}

// ATX heading: returns {lv, src, } or null. src = heading text (raw).
function matchATX(line) {
  const ind = lineIndent(line);
  if (ind.col > 3) return null;
  const s = line.slice(ind.idx);
  if (s.charCodeAt(0) !== 35) return null;
  let lv = 0;
  while (lv < s.length && s.charCodeAt(lv) === 35) lv++;
  if (lv > 6) return null;
  if (lv < s.length && s.charCodeAt(lv) !== 32 && s.charCodeAt(lv) !== 9) return null;
  let text = s.slice(lv).trim();
  // closing sequence: trailing #'s preceded by a space (or all #'s)
  if (/[ \t]+#+[ \t]*$/.test(text) || /^#+[ \t]*$/.test(text)) {
    text = text.replace(/[ \t]+#+[ \t]*$/, "").replace(/^#+[ \t]*$/, "");
  }
  return { lv, src: text };
}
function isThematicBreak(line) {
  const ind = lineIndent(line);
  if (ind.col > 3) return false;
  const s = line.slice(ind.idx);
  if (s.length < 3) return false;
  const c = s.charCodeAt(0);
  if (c !== 45 && c !== 42 && c !== 95) return false;
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i);
    if (d === c) count++;
    else if (d !== 32 && d !== 9) return false;
  }
  return count >= 3;
}
// Fence opener: returns {ch, len, info, indent} or null.
function matchFence(line) {
  const ind = lineIndent(line);
  if (ind.col > 3) return null;
  const s = line.slice(ind.idx);
  const c = s.charCodeAt(0);
  if (c !== 96 && c !== 126) return null;
  let len = 0;
  while (len < s.length && s.charCodeAt(len) === c) len++;
  if (len < 3) return null;
  if (c === 96 && s.slice(len).indexOf("`") !== -1) return null;
  return { ch: c === 96 ? "`" : "~", len, info: s.slice(len).trim(), indent: ind.col };
}
// Is this line a fence closer for the given fence?
function isFenceClose(line, fence) {
  const ind = lineIndent(line);
  if (ind.col > 3) return false;
  const s = line.slice(ind.idx);
  const c = fence.ch === "`" ? 96 : 126;
  let len = 0;
  while (len < s.length && s.charCodeAt(len) === c) len++;
  if (len < fence.len) return false;
  return s.slice(len).trim() === "";
}
// HTML block start type (1-7) for a line, or 0 if none.
const BLOCK_TAGS = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/i;

function htmlBlockType(line) {
  const ind = lineIndent(line);
  if (ind.col > 3) return 0;
  const s = line.slice(ind.idx);
  if (/^<(script|pre|style|textarea)([\s>]|$)/i.test(s)) return 1;
  if (/^<!--/.test(s)) return 2;
  if (/^<\?/.test(s)) return 3;
  if (/^<![A-Za-z]/.test(s)) return 4;
  if (/^<!\[CDATA\[/.test(s)) return 5;
  // tag start: </?name followed by whitespace, >, / or end of line.
  // A block-level tag name -> type 6 (the tag may span lines).
  const m = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(s);
  if (m) {
    const after = s.slice(m[0].length);
    if ((after === "" || /^[\s>\/]/.test(after)) && BLOCK_TAGS.test(m[1])) return 6;
  }
  // type 7: a complete tag on this line, alone (only whitespace after it).
  // Validate the tag strictly with matchHtmlTag: the lenient regex
  // accepted invalid tags (cm-619 <a h*...>, cm-622 missing space
  // between attributes, cm-624 closing tag with attributes).
  const tag7 = matchHtmlTag(s, 0);
  if (tag7 && s.slice(tag7.length).trim() === "") return 7;
  return 0;
}
function htmlBlockEnd(line, type) {
  if (type === 1) return /<\/(script|pre|style|textarea)>/i.test(line);
  if (type === 2) return line.indexOf("-->") !== -1;
  if (type === 3) return line.indexOf("?>") !== -1;
  if (type === 4) return line.indexOf(">") !== -1;
  if (type === 5) return line.indexOf("]]>") !== -1;
  return false; // types 6,7 end at a blank line
}

// marked's ge(): strip trailing blank lines, but only when there are 2+
// of them (counted after splitting on \n); 0-1 trailing blank lines keep
// the text unchanged (so a single trailing \n survives).
function geText(s) {
  const parts = s.split("\n");
  let t = parts.length - 1;
  while (t >= 0 && isBlankLine(parts[t])) t--;
  if (parts.length - t <= 2) return s;
  return parts.slice(0, t + 1).join("\n");
}

// Split a table row into cells (handles escaped pipes).
function splitTableRow(line) {
  // leading/trailing whitespace around the row is not a cell
  line = line.trim();
  const cells = [];
  let cur = "";
  let i = 0;
  const n = line.length;
  for (; i < n; i++) {
    const c = line.charCodeAt(i);
    if (c === 92 && i + 1 < n && line.charCodeAt(i + 1) === 124) { cur += "|"; i++; continue; }
    if (c === 124) { cells.push(cur.trim()); cur = ""; continue; }
    cur += line[i];
  }
  cells.push(cur.trim());
  // a leading/trailing pipe creates an empty artifact cell, not a real one
  if (n > 0 && line.charCodeAt(0) === 124 && cells.length) cells.shift();
  if (n > 0 && line.charCodeAt(n - 1) === 124 && cells.length) cells.pop();
  return cells;
}
// Is this line a valid table delimiter row? Returns alignments or null.
function tableDelimiter(line) {
  const cells = splitTableRow(line);
  if (cells.length === 0) return null;
  const align = [];
  for (const cell of cells) {
    const m = /^:?-+:?$/.exec(cell);
    if (!m) return null;
    const left = cell.charCodeAt(0) === 58;
    const right = cell.charCodeAt(cell.length - 1) === 58;
    align.push(left && right ? "center" : left ? "left" : right ? "right" : null);
  }
  return align;
}
function isSetextLine(line) {
  const ind = lineIndent(line);
  if (ind.col > 3) return 0;
  const s = line.slice(ind.idx).trim();
  if (s.length === 0) return 0;
  const c = s.charCodeAt(0);
  if (c !== 61 && c !== 45) return 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) !== c) return 0;
  }
  return c === 61 ? 1 : 2;
}
// Does this line start a block that interrupts a paragraph?
// (inList = inside a list item's content: any ordered start interrupts)
function interruptsPara(line, inList) {
  const ind = lineIndent(line);
  if (ind.col > 3) return false;
  const s = line.slice(ind.idx);
  if (s.length === 0) return false;
  const c = s.charCodeAt(0);
  if (c === 35) return matchATX(line) !== null;
  if (c === 96 || c === 126) return matchFence(line) !== null;
  if (c === 60) { const t = htmlBlockType(line); return t >= 1 && t <= 6; }
  if (c === 62) return true; // blockquote
  if (c === 45 || c === 42 || c === 95) {
    if (isThematicBreak(line)) return true;
  }
  const lm = matchListMarker(line, inList);
  if (lm === null) return false;
  // an empty marker does not interrupt a paragraph
  if (lm.empty) return false;
  // an ordered marker interrupts a paragraph only if it starts with 1
  // (unless we are inside a list item's content)
  if (lm.ord && !inList && lm.start !== 1) return false;
  return true;
}
// A list marker at a line start. Returns {bullet, ord, start, delim, indent, markerLen, contentIndent} or null.
function matchListMarker(line, inList) {
  const ind = lineIndent(line);
  if (ind.col > 3) return null;
  const s = line.slice(ind.idx);
  const c = s.charCodeAt(0);
  let markerLen = 0;
  let bullet = null;
  let ord = false;
  let start = 1;
  let delim = "";
  if (c === 45 || c === 43 || c === 42) {
    bullet = s[0];
    markerLen = 1;
  } else if (c >= 48 && c <= 57) {
    let j = 0;
    while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
    if (j === 0 || j > 9) return null;
    const d = s.charCodeAt(j);
    if (d !== 46 && d !== 41) return null;
    ord = true;
    delim = s[j];
    start = parseInt(s.slice(0, j), 10);
    markerLen = j + 1;
  } else return null;
  // must be followed by 1+ spaces/tabs, or end of line (empty item)
  const after = s.slice(markerLen);
  if (after.trim() === "") {
    // empty item (nothing, or only spaces, after the marker):
    // content indent = marker indent + marker len + 1
    return { bullet, ord, start, delim, indent: ind.col, markerLen, contentIndent: ind.col + markerLen + 1, empty: true };
  }
  const a0 = after.charCodeAt(0);
  if (a0 !== 32 && a0 !== 9) return null;
  // count spaces after the marker (tab-aware, from the marker column)
  let spaces = 0;
  let col = ind.col + markerLen;
  let k = 0;
  while (k < after.length) {
    const d = after.charCodeAt(k);
    if (d === 32) { spaces++; col++; k++; }
    else if (d === 9) { const w = 4 - (col % 4); spaces += w; col += w; k++; }
    else break;
  }
  if (spaces === 0) return null;
  let contentIndent;
  if (spaces >= 5) contentIndent = ind.col + markerLen + 1;
  else contentIndent = ind.col + markerLen + spaces;
  return { bullet, ord, start, delim, indent: ind.col, markerLen, contentIndent, empty: after.trim() === "" };
}

// Collect a paragraph starting at lines[i]. Returns {block, next}.
function parseParagraph(lines, i, b, refs, st, inList) {
  const plines = [];
  let setextLv = 0;
  let tableMode = false;
  let tableAlign = null;
  let j = i;
  while (j < b) {
    const line = lines[j];
    if (isBlankLine(line)) {
      // In a table, a tab-only line is a ROW (empty cells); a spaces-only
      // (or empty) line ends the table (doc-02/05/07). Only TAB counts.
      if (tableMode && line.indexOf("\t") !== -1) {
        plines.push(line); j++; continue;
      }
      break;
    }
    if (tableMode) {
      // A blockquote line ends the table (it is not a table row).
      const tInd = lineIndent(line);
      if (line.charCodeAt(tInd.idx) === 62) break; // '>'
      // A line that starts a new block (HTML block, list, heading, fence,
      // ...) ends the table instead of becoming a row (doc-05 <details>,
      // doc-07 list); a plain paragraph line stays a row (doc-02).
      if (interruptsPara(line, inList)) break;
      plines.push(line); j++; continue;
    }
    // (a link reference definition cannot interrupt a paragraph, so a
    // def-looking line here is plain paragraph text)
    // table delimiter as the 2nd line (header must contain a pipe)
    if (!tableMode && plines.length === 1) {
      const al = tableDelimiter(line);
      if (al && plines[0].indexOf("|") !== -1) {
        const hc = splitTableRow(plines[0]);
        if (hc.length === al.length) {
          tableMode = true;
          tableAlign = al;
          j++;
          continue;
        }
      }
    }
    // setext underline (needs a preceding paragraph line)
    const sx = isSetextLine(line);
    if (sx && !tableMode && plines.length > 0) {
      setextLv = sx;
      j++;
      break;
    }
    // interrupting block?
    if (plines.length > 0 && interruptsPara(line, inList)) break;
    plines.push(line);
    j++;
  }
  if (tableMode) {
    // body rows: the lines collected after the delimiter
    const body = plines.slice(1);
    return { block: { k: "tab", align: tableAlign, head: splitTableRow(plines[0]), rows: body.map(splitTableRow) }, next: j };
  }
  if (setextLv) {
    return { block: { k: "sx", lv: setextLv, lines: plines }, next: j };
  }
  return { block: { k: "p", lines: plines }, next: j };
}

// Is this line a blockquote start (0-3 spaces then '>')?
function bqPrefix(line) {
  const ind = lineIndent(line);
  if (ind.col > 3) return -1;
  if (line.charCodeAt(ind.idx) !== 62) return -1;
  return ind.idx;
}
// Strip one blockquote marker from a line. Returns the inner line or null.
// The marker is '>' plus one following space/tab column (tab-aware).
function stripBq(line) {
  const p = bqPrefix(line);
  if (p === -1) return null;
  const after = line.slice(p + 1);
  const colAfter = lineIndent(line).col + 1;
  return stripColumns(after, 1, colAfter);
}
// Collect blockquote inner lines starting at lines[i]. Returns {inner, next}.
// Lazy lines are appended to the last inner line when allowed.
function collectBlockquote(lines, i, b) {
  const inner = [];
  let j = i;
  let inFence = false;
  let fenceCh = "";
  let fenceLen = 0;
  let prevLazy = false;
  while (j < b) {
    const line = lines[j];
    const stripped = stripBq(line);
    if (stripped !== null) {
      inner.push(stripped);
      prevLazy = false;
      // track fenced code inside the quote (for the lazy rule)
      const f = matchFence(stripped);
      if (!inFence && f) { inFence = true; fenceCh = f.ch; fenceLen = f.len; }
      else if (inFence && isFenceClose(stripped, { ch: fenceCh, len: fenceLen })) inFence = false;
      j++;
      continue;
    }
    // lazy continuation?
    if (inner.length === 0) break;
    const last = inner[inner.length - 1];
    if (isBlankLine(last)) break;
    if (inFence) break;
    const li = lineIndent(last);
    if (li.col >= 4) break; // last inner line is indented code
    if (isBlankLine(line)) break;
    // a lazy line that is itself a block start does not continue
    const lm = matchListMarker(line, false);
    const lInd = lineIndent(line);
    if (lm && lInd.col < 4) break;
    if (matchFence(line)) break;
    if (matchATX(line)) break;
    if (htmlBlockType(line) >= 1 && htmlBlockType(line) <= 6) break;
    if (isThematicBreak(line)) break;
    // lazy line: append to the last inner line. A line with >=4 leading
    // spaces loses 4 (kept-space rule); a setext-looking lazy line that
    // follows another lazy line gets 4 spaces prepended (marked's
    // blockquoteSetextReplace).
    let add = line;
    const lci = lineIndent(line).col;
    if (lci >= 4) add = stripIndent(line, 4);
    if (prevLazy && isSetextLine(add)) add = "    " + add;
    inner[inner.length - 1] = last + "\n" + add;
    prevLazy = true;
    j++;
  }
  return { inner, next: j };
}

// Collect one list item's lines. lines[i] is the marker line.
// marker = matchListMarker result. Returns {itemLines, next, blankRun}.
function collectListItem(lines, i, b, marker) {
  const itemLines = [];
  const first = lines[i];
  const ind = lineIndent(first);
  // content after the marker, with the content indent removed
  const afterMarker = first.slice(ind.idx + marker.markerLen);
  const toRemove = marker.contentIndent - (ind.col + marker.markerLen);
  let content = marker.empty ? "" : stripColumns(afterMarker, toRemove, ind.col + marker.markerLen);
  // GFM task list: [ ] / [x] / [X] + whitespace + content at the start
  // of the item. Strip the marker; record checked state.
  let task = false;
  let checked = false;
  if (!marker.empty && content.charCodeAt(0) === 91) {
    const c1 = content.charCodeAt(1);
    if ((c1 === 32 || c1 === 120 || c1 === 88) && content.charCodeAt(2) === 93) {
      let k = 3;
      while (k < content.length && (content.charCodeAt(k) === 32 || content.charCodeAt(k) === 9)) k++;
      if (k > 3 && k < content.length) {
        task = true;
        checked = c1 !== 32;
        content = content.slice(k);
      }
    }
  }
  itemLines.push(content);
  let j = i + 1;
  let blankRun = 0;
  let fenceContent = 0;
  let inFence = false;
  let fenceCh = "";
  let fenceLen = 0;
  let hasContent = !marker.empty;
  const firstFence = matchFence(content);
  if (firstFence) { inFence = true; fenceCh = firstFence.ch; fenceLen = firstFence.len; fenceContent = 0; }
  while (j < b) {
    const line = lines[j];
    if (isBlankLine(line)) {
      // an empty item ends at a blank line: nothing after it belongs here
      if (!hasContent) { blankRun = 0; break; }
      // blank: look ahead — if a later line belongs to this item or is a
      // sibling marker, the blank is part of the item; else the item ends.
      let k = j;
      while (k < b && isBlankLine(lines[k])) k++;
      if (k >= b) { blankRun = k - j; j = k; break; }
      const nk = lines[k];
      const nInd = lineIndent(nk);
      const nMark = matchListMarker(nk, true);
      if ((nMark && nMark.indent === marker.indent) || nInd.col >= marker.contentIndent) {
        for (let q = j; q < k; q++) itemLines.push("");
        blankRun = k - j;
        j = k;
        continue;
      }
      blankRun = k - j;
      j = k;
      break;
    }
    const li = lineIndent(line);
    const lm = matchListMarker(line, true);
    // sibling marker at the same indent: item ends
    if (lm && lm.indent === marker.indent) break;
    if (li.col >= marker.contentIndent) {
      // indented content: strip the content indent
      let stripped = stripIndent(line, marker.contentIndent);
      itemLines.push(stripped);
      hasContent = true;
      blankRun = 0;
      const f = matchFence(stripped);
      if (!inFence && f) { inFence = true; fenceCh = f.ch; fenceLen = f.len; fenceContent = 0; }
      else if (inFence) {
        if (isFenceClose(stripped, { ch: fenceCh, len: fenceLen })) inFence = false;
        else fenceContent++;
      }
      j++;
      continue;
    }
    // lazy continuation (paragraph text of the item)
    if (inFence) {
      // a lazy line immediately after a fence opener ends the item
      if (fenceContent === 0) break;
      // otherwise it is fence content
      itemLines.push(line);
      fenceContent++;
      j++;
      continue;
    }
    if (lm && li.col < 4) break; // list marker at low indent: not lazy
    if (matchFence(line)) break;
    if (matchATX(line)) break;
    if (htmlBlockType(line) >= 1 && htmlBlockType(line) <= 6) break;
    if (isThematicBreak(line)) break;
    if (bqPrefix(line) !== -1) break; // blockquote interrupts lazy continuation (doc-17)
    // lazy line: append to the last item line (kept-space rule: a line
    // with >=4 leading spaces loses 4, else keeps all)
    const last = itemLines[itemLines.length - 1];
    const ci = li.col;
    const cont = ci >= 4 ? stripIndent(line, 4) : line;
    itemLines[itemLines.length - 1] = last + "\n" + cont;
    hasContent = true;
    blankRun = 0;
    j++;
  }
  return { itemLines, next: j, blankRun, task, checked };
}

// Parse a whole list starting at lines[i]. Returns {block, next}.
function parseList(lines, i, b, refs, st, inList) {
  const first = matchListMarker(lines[i], inList);
  const items = [];
  let tight = true;
  let j = i;
  let prevBlank = false;
  let lastBlankRun = 0;
  // a sibling's marker must sit left of the PREVIOUS item's content
  // indent (a marker at/inside it belongs to that item, not this list);
  // sibling indents may vary, so the threshold moves with each item
  let prevCI = first.contentIndent;
  while (j < b) {
    // a thematic break ends the list (it outranks a list marker)
    if (isThematicBreak(lines[j])) break;
    const lm = matchListMarker(lines[j], inList);
    if (!lm) break;
    // same list type? bullet char must match; ordered delim must match
    if (lm.bullet !== first.bullet || lm.delim !== first.delim) break;
    if (lm.indent >= prevCI) break;
    const it = collectListItem(lines, j, b, lm);
    // looseness: blank line between blocks inside the item, or between items
    const inner = parseBlocks(it.itemLines, 0, it.itemLines.length, refs, st, true, false);
    const innerBlocks = inner.blocks;
    // a list is loose if any item directly contains two blocks separated
    // by a blank line, or if there is a blank line between two items
    let itemLoose = inner.blankBetween;
    if (itemLoose) tight = false;
    if (prevBlank) tight = false;
    items.push({ blocks: innerBlocks, loose: itemLoose, task: it.task, checked: it.checked });
    prevBlank = it.blankRun > 0;
    lastBlankRun = it.blankRun;
    prevCI = lm.contentIndent;
    j = it.next;
    // skip blank lines between items only when a sibling item follows;
    // trailing blanks after the last item are left for the caller, which
    // needs to see them (blank line separating blocks). A blank line
    // skipped here sits between two items, so the list is loose.
    {
      let k = j;
      while (k < b && isBlankLine(lines[k])) k++;
      if (k < b) {
        const nm = matchListMarker(lines[k], inList);
        if (nm && nm.bullet === first.bullet && nm.delim === first.delim && nm.indent < prevCI) {
          if (k > j) tight = false;
          j = k;
        }
      }
    }
  }
  if (items.length === 0) return null;
  // an item that ends with a blank line and is followed by another item
  // makes the list loose; also an item whose content ends blank then a
  // sibling follows. Recompute: loose if any item (except possibly the
  // last) is followed by a blank line, or any item is internally loose.
  let loose = false;
  for (let q = 0; q < items.length; q++) {
    if (items[q].loose) { loose = true; break; }
  }
  // blank line between items: check the raw lines between items is hard
  // here; use the prevBlank chain recorded during collection.
  if (!tight) loose = true;
  // rewind over the last item's trailing blank lines: the caller must see
  // them, since they may separate this list from the next block
  const next = lastBlankRun > 0 ? j - lastBlankRun : j;
  return {
    block: {
      k: "list", ord: first.ord, start: first.start,
      tight: !loose, items: items.map((it) => ({ blocks: it.blocks, task: it.task, checked: it.checked }))
    },
    next
  };
}

// Main block parser over lines[a..b). Returns {blocks, blankBetween}:
// blankBetween is true when two top-level blocks in this range are
// separated by a blank line (used for list looseness).
// hasTrailingNL: whether the source has a newline after the last line
// (true at top level when the input ends with \n; false for inner
// content re-parsed from a blockquote or list item).
function parseBlocks(lines, a, b, refs, st, inList, hasTrailingNL) {
  const blocks = [];
  let blankBetween = false;
  let seenBlock = false;
  let pendingBlank = false;
  let i = a;
  while (i < b) {
    const line = lines[i];
    if (isBlankLine(line)) { pendingBlank = true; i++; continue; }
    const rd = tryRefDef(lines, i);
    if (rd) {
      if (!(rd.key in refs)) refs[rd.key] = { href: rd.href, title: rd.title };
      // a def is a block for looseness: a blank line before it separates
      // the blocks around it
      if (seenBlock && pendingBlank) blankBetween = true;
      seenBlock = true;
      pendingBlank = false;
      i = rd.next;
      continue;
    }
    // a block is about to be parsed in this iteration (one of the
    // types below always matches, ending with a paragraph)
    if (seenBlock && pendingBlank) blankBetween = true;
    seenBlock = true;
    pendingBlank = false;
    const atx = matchATX(line);
    if (atx) { blocks.push({ k: "h", lv: atx.lv, src: atx.src }); i++; continue; }
    const fence = matchFence(line);
    if (fence) {
      const content = [];
      let j = i + 1;
      while (j < b) {
        if (isFenceClose(lines[j], fence)) { j++; break; }
        content.push(lines[j]);
        j++;
      }
      let text = content.join("\n");
      if (fence.ch === "`") {
        text = content.map((l) => stripCodeColumns(l, fence.indent, 0)).join("\n");
      }
      if (content.length > 0 && !isBlankLine(content[content.length - 1])) text += "\n";
      const lang = fence.info.split(/\s+/)[0] || "";
      blocks.push({ k: "fc", lang: unescapePunct(lang), text });
      i = j;
      continue;
    }
    const ind = lineIndent(line);
    if (ind.col >= 4) {
      // indented code: lines indented >=4 (even whitespace-only ones,
      // whose content is the spaces left after stripping the indent);
      // a <4-indent blank line is kept only if a code line follows it
      const content = [];
      let j = i;
      while (j < b) {
        const l2 = lines[j];
        const l2ind = lineIndent(l2);
        if (l2ind.col >= 4) {
          content.push(stripCodeColumns(l2, 4, 0));
          j++;
          continue;
        }
        if (isBlankLine(l2)) {
          let k = j;
          while (k < b && isBlankLine(lines[k]) && lineIndent(lines[k]).col < 4) k++;
          if (k < b && lineIndent(lines[k]).col >= 4) {
            for (let q = j; q < k; q++) content.push("");
            j = k;
            continue;
          }
          break;
        }
        break;
      }
      let text = content.join("\n");
      if (content.length > 0 && !isBlankLine(content[content.length - 1])) text += "\n";
      blocks.push({ k: "ic", text });
      i = j;
      continue;
    }
    const ht = htmlBlockType(line);
    if (ht) {
      const raw = [];
      let j = i;
      raw.push(line);
      j++;
      let done = ht === 7 ? false : htmlBlockEnd(line, ht);
      while (j < b && !done) {
        const l2 = lines[j];
        if (ht >= 6 && isBlankLine(l2)) break;
        raw.push(l2);
        if (ht <= 5 && htmlBlockEnd(l2, ht)) done = true;
        j++;
      }
      // The raw match consumes the blank lines right after the block.
      const j0 = j;
      let blankAfter = 0;
      while (j < b && isBlankLine(lines[j])) {
        // A whitespace-only (non-empty) line after a type-1
        // (pre/script/style/textarea) or type-2 (comment) block is NOT
        // a ge-blank: marked's html regex ends the raw after the
        // closing construct + \n*, so the spaces/tabs line is never
        // part of the raw and ge() keeps the block's trailing \n
        // (doc-24 pre, doc-15 comment). Type 6 (div etc.) ends at a
        // blank line, so it DOES consume it (doc-03). A truly empty
        // line is consumed for all types (ge strips the \n either way).
        if ((ht === 1 || ht === 2) && lines[j].length > 0) break;
        blankAfter++; j++;
      }
      // marked's ge() on the raw match: content lines + a \n after the
      // last content line (when the source has one there) + a \n per
      // consumed blank line.
      let rawText = raw.join("\n");
      if (j0 < b || hasTrailingNL) rawText += "\n";
      rawText += "\n".repeat(blankAfter);
      const text = geText(rawText);
      blocks.push({ k: "html", text });
      i = j;
      continue;
    }
    if (isThematicBreak(line)) { blocks.push({ k: "hr" }); i++; continue; }
    if (bqPrefix(line) !== -1) {
      const bq = collectBlockquote(lines, i, b);
      const inner = parseBlocks(bq.inner, 0, bq.inner.length, refs, st, false, false).blocks;
      // cm-241: a trailing whitespace-only inner line (from a `>  `
      // marker) at the end of a blockquote belongs to the preceding
      // paragraph, not a blank line. Append it to the last paragraph
      // block when it directly follows the paragraph's last line.
      const n = bq.inner.length;
      if (n >= 2) {
        const lastLine = bq.inner[n - 1];
        if (lastLine.length > 0 && /^[ \t]+$/.test(lastLine)) {
          const lastBlock = inner[inner.length - 1];
          if (lastBlock && lastBlock.k === "p") {
            const plines = lastBlock.lines;
            if (plines.length > 0 && plines[plines.length - 1] === bq.inner[n - 2]) {
              plines.push(lastLine);
            }
          }
        }
      }
      blocks.push({ k: "bq", items: inner });
      i = bq.next;
      continue;
    }
    const lm = matchListMarker(line, inList);
    if (lm) {
      const lst = parseList(lines, i, b, refs, st, inList);
      if (lst) { blocks.push(lst.block); i = lst.next; continue; }
    }
    const para = parseParagraph(lines, i, b, refs, st, inList);
    blocks.push(para.block);
    i = para.next;
  }
  return { blocks, blankBetween };
}

// Render a code block (fenced or indented). text follows the cm-318 rule.
function renderCode(lang, text) {
  let r = text;
  if (r) r = r.replace(/\n$/, "") + "\n";
  const first = lang ? lang.split(/\s+/)[0] : "";
  const cls = first ? ' class="language-' + escAttr(first) + '"' : "";
  if (r) return "<pre><code" + cls + ">" + escFull(r) + "</code></pre>\n";
  return "<pre><code" + cls + "></code></pre>\n";
}

function renderBlocks(blocks, refs, st, tight) {
  let out = "";
  for (const b of blocks) {
    switch (b.k) {
      case "p": {
        const src = b.lines.join("\n");
        if (tight) out += inlineHtml(src, refs, st);
        else out += "<p>" + inlineHtml(src, refs, st) + "</p>\n";
        break;
      }
      case "h": {
        out += "<h" + b.lv + ">" + inlineHtml(b.src, refs, st) + "</h" + b.lv + ">\n";
        break;
      }
      case "sx": {
        const src = b.lines.join("\n").replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
        out += "<h" + b.lv + ">" + inlineHtml(src, refs, st) + "</h" + b.lv + ">\n";
        break;
      }
      case "fc":
        out += renderCode(b.lang, b.text);
        break;
      case "ic":
        out += renderCode("", b.text);
        break;
      case "html":
        out += b.text;
        break;
      case "hr":
        out += "<hr>\n";
        break;
      case "bq":
        out += "<blockquote>\n" + renderBlocks(b.items, refs, st, false) + "</blockquote>\n";
        break;
      case "list": {
        const tag = b.ord ? "ol" : "ul";
        const startAttr = b.ord && b.start !== 1 ? ' start="' + b.start + '"' : "";
        out += "<" + tag + startAttr + ">\n";
        for (const item of b.items) {
          let body = renderBlocks(item.blocks, refs, st, b.tight);
          if (item.task) {
            const cb = '<input ' + (item.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
            if (b.tight) {
              body = cb + body;
            } else if (body.startsWith("<p>")) {
              body = "<p>" + cb + body.slice(3);
            } else {
              body = "<p>" + cb + "</p>\n" + body;
            }
          }
          out += "<li>" + body + "</li>\n";
        }
        out += "</" + tag + ">\n";
        break;
      }
      case "tab": {
        out += "<table>\n<thead>\n<tr>\n";
        for (let c = 0; c < b.head.length; c++) {
          const al = b.align[c];
          const attr = al ? ' align="' + al + '"' : "";
          out += "<th" + attr + ">" + inlineHtml(b.head[c], refs, st) + "</th>\n";
        }
        out += "</tr>\n</thead>\n";
        if (b.rows.length) {
          out += "<tbody>";
          for (const row of b.rows) {
            out += "<tr>\n";
            for (let c = 0; c < b.head.length; c++) {
              const al = b.align[c];
              const attr = al ? ' align="' + al + '"' : "";
              const cell = c < row.length ? row[c] : "";
              out += "<td" + attr + ">" + inlineHtml(cell, refs, st) + "</td>\n";
            }
            out += "</tr>\n";
          }
          out += "</tbody>";
        }
        out += "</table>\n";
        break;
      }
    }
  }
  return out;
}
