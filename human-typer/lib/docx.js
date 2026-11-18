// DOCX -> document model. Reads the ZIP with zip.js and parses the WordprocessingML
// parts with a small XML tokenizer (no DOMParser, so it also runs in Node tests
// and in a service worker). Requires docmodel.js and zip.js to be loaded first.
(function (root) {
  'use strict';

  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    require('./docmodel.js');
    require('./zip.js');
  }
  const api = (root.HumanTyperDoc = root.HumanTyperDoc || {});

  // --- XML -----------------------------------------------------------------
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|\w+);/g, (whole, e) => {
      if (e[0] === '#') {
        const hex = e[1] === 'x' || e[1] === 'X';
        const cp = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : whole;
    });
  }

  const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  // Parses XML into a tree of { name, attrs, children } element nodes and
  // { text } text nodes. Names keep their namespace prefix ("w:p").
  function parseXml(src) {
    const doc = { name: '#document', attrs: {}, children: [] };
    const stack = [doc];
    const n = src.length;
    const skipTo = (marker, from, what) => {
      const end = src.indexOf(marker, from);
      if (end < 0) throw new Error(`Malformed XML: unterminated ${what}`);
      return end + marker.length;
    };
    let i = 0;
    while (i < n) {
      const lt = src.indexOf('<', i);
      const top = stack[stack.length - 1];
      if (lt < 0) break;
      if (lt > i) top.children.push({ text: decodeEntities(src.slice(i, lt)) });
      if (src.startsWith('<!--', lt)) {
        i = skipTo('-->', lt + 4, 'comment');
      } else if (src.startsWith('<![CDATA[', lt)) {
        i = skipTo(']]>', lt + 9, 'CDATA section');
        top.children.push({ text: src.slice(lt + 9, i - 3) });
      } else if (src[lt + 1] === '?') {
        i = skipTo('?>', lt + 2, 'processing instruction');
      } else if (src[lt + 1] === '!') {
        i = skipTo('>', lt + 2, 'declaration');
      } else {
        // Find the end of the tag; '>' may legally appear inside attribute values.
        let j = lt + 1;
        let quote = '';
        for (; j < n; j++) {
          const c = src[j];
          if (quote) {
            if (c === quote) quote = '';
          } else if (c === '"' || c === "'") quote = c;
          else if (c === '>') break;
        }
        if (j >= n) throw new Error('Malformed XML: unterminated tag');
        let body = src.slice(lt + 1, j);
        i = j + 1;
        if (body[0] === '/') {
          const name = body.slice(1).trim();
          if (stack.length < 2 || top.name !== name) {
            throw new Error(`Malformed XML: unexpected </${name}>`);
          }
          stack.pop();
          continue;
        }
        const selfClosing = body.endsWith('/');
        if (selfClosing) body = body.slice(0, -1);
        const m = /^[^\s]+/.exec(body);
        if (!m) throw new Error('Malformed XML: empty tag');
        const node = { name: m[0], attrs: {}, children: [] };
        ATTR.lastIndex = m[0].length;
        let a;
        while ((a = ATTR.exec(body))) {
          node.attrs[a[1]] = decodeEntities(a[2] !== undefined ? a[2] : a[3]);
        }
        top.children.push(node);
        if (!selfClosing) stack.push(node);
      }
    }
    if (stack.length !== 1) {
      throw new Error(`Malformed XML: <${stack[stack.length - 1].name}> is not closed`);
    }
    return doc;
  }

  function kids(node, name) {
    return node ? node.children.filter((c) => c.name === name) : [];
  }
  function kid(node, name) {
    return node ? node.children.find((c) => c.name === name) : undefined;
  }
  // The w:val attribute of the named child element, if any.
  function val(node, name) {
    const el = kid(node, name);
    return el ? el.attrs['w:val'] : undefined;
  }
  function hasDescendant(node, name) {
    return (node.children || []).some((c) => c.name === name || hasDescendant(c, name));
  }

  // --- styles and numbering ------------------------------------------------
  // On/off run property: true, false, or undefined when not specified.
  function toggle(rPr, name) {
    const el = kid(rPr, name);
    if (!el) return undefined;
    const v = el.attrs['w:val'];
    return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
  }

  // Font of an rPr: an explicit name, 'theme:major' / 'theme:minor', or
  // undefined. Theme attributes win over explicit names (ECMA-376 17.3.2.26).
  function runFont(rPr) {
    const f = kid(rPr, 'w:rFonts');
    if (!f) return undefined;
    const theme = f.attrs['w:asciiTheme'] || f.attrs['w:hAnsiTheme'];
    if (theme) return /^major/i.test(theme) ? 'theme:major' : 'theme:minor';
    return f.attrs['w:ascii'] || f.attrs['w:hAnsi'] || undefined;
  }
  // Font size in points (w:sz is in half-points).
  function runSize(rPr) {
    const n = Number(val(rPr, 'w:sz'));
    return n > 0 ? n / 2 : undefined;
  }

  function runProps(rPr) {
    if (!rPr) return {};
    const strike = toggle(rPr, 'w:strike');
    return {
      bold: toggle(rPr, 'w:b'),
      italic: toggle(rPr, 'w:i'),
      underline: toggle(rPr, 'w:u'),
      strike: strike !== undefined ? strike : toggle(rPr, 'w:dstrike'),
      font: runFont(rPr),
      size: runSize(rPr),
    };
  }

  // Later property sets override earlier ones; undefined means "inherit".
  function mergeProps(...sets) {
    const out = {};
    for (const s of sets) for (const k in s) if (s[k] !== undefined) out[k] = s[k];
    return out;
  }

  function readStyles(xml) {
    const byId = new Map();
    let defaultParagraph;
    const root = xml ? kid(parseXml(xml), 'w:styles') : undefined;
    // Document-wide run defaults (font and size most of all).
    const defaults = runProps(kid(kid(kid(root, 'w:docDefaults'), 'w:rPrDefault'), 'w:rPr'));
    for (const s of kids(root, 'w:style')) {
      const id = s.attrs['w:styleId'];
      byId.set(id, {
        // Built-in style names are not localized ("heading 1"), unlike style ids.
        name: (val(s, 'w:name') || '').toLowerCase().replace(/\s+/g, ''),
        basedOn: val(s, 'w:basedOn'),
        pPr: kid(s, 'w:pPr'),
        rProps: runProps(kid(s, 'w:rPr')),
      });
      if (s.attrs['w:type'] === 'paragraph' && /^(1|true|on)$/.test(s.attrs['w:default'] || '')) {
        defaultParagraph = id;
      }
    }
    // The style followed by its ancestors, most specific first.
    const chain = (id) => {
      const out = [];
      for (let s = byId.get(id); s && !out.includes(s); s = byId.get(s.basedOn)) out.push(s);
      return out;
    };
    return { byId, chain, defaultParagraph, defaults };
  }

  // Latin typefaces of the theme's major (headings) and minor (body) fonts.
  function readTheme(xml) {
    const out = {};
    if (!xml) return out;
    const scheme = kid(kid(kid(parseXml(xml), 'a:theme'), 'a:themeElements'), 'a:fontScheme');
    for (const [k, name] of [['major', 'a:majorFont'], ['minor', 'a:minorFont']]) {
      const latin = kid(kid(scheme, name), 'a:latin');
      if (latin && latin.attrs.typeface) out[k] = latin.attrs.typeface;
    }
    return out;
  }

  // Returns (numId, ilvl) -> 'bullet' | 'number' | null.
  function readNumbering(xml) {
    const abstracts = new Map();
    const nums = new Map();
    const numbering = xml ? kid(parseXml(xml), 'w:numbering') : undefined;
    for (const a of kids(numbering, 'w:abstractNum')) {
      const formats = {};
      for (const lvl of kids(a, 'w:lvl')) formats[lvl.attrs['w:ilvl']] = val(lvl, 'w:numFmt');
      abstracts.set(a.attrs['w:abstractNumId'], formats);
    }
    for (const num of kids(numbering, 'w:num')) {
      const overrides = {};
      for (const o of kids(num, 'w:lvlOverride')) {
        overrides[o.attrs['w:ilvl']] = val(kid(o, 'w:lvl'), 'w:numFmt');
      }
      nums.set(num.attrs['w:numId'], { abstractId: val(num, 'w:abstractNumId'), overrides });
    }
    return (numId, ilvl) => {
      const num = nums.get(numId);
      const fmt = num && (num.overrides[ilvl] || (abstracts.get(num.abstractId) || {})[ilvl]);
      if (fmt === 'none') return null;
      return !fmt || fmt === 'bullet' ? 'bullet' : 'number';
    };
  }

  function styleFromName(name) {
    if (name === 'title' || name === 'subtitle') return name;
    const m = /^heading([1-6])$/.exec(name || '');
    return m ? 'h' + m[1] : null;
  }

  const JC = {
    left: 'left',
    start: 'left',
    center: 'center',
    right: 'right',
    end: 'right',
    both: 'justify',
    distribute: 'justify',
  };

  // --- body ----------------------------------------------------------------
  // Wrappers whose children are treated as if they were in the parent.
  const TRANSPARENT = new Set([
    'w:hyperlink',
    'w:ins',
    'w:moveTo',
    'w:smartTag',
    'w:fldSimple',
    'w:customXml',
    'w:sdtContent',
    'w:sdt',
    'w:dir',
    'w:bdo',
  ]);

  function convertParagraph(p, ctx) {
    const pPr = kid(p, 'w:pPr');
    const styleId = val(pPr, 'w:pStyle') || ctx.styles.defaultParagraph;
    const chain = ctx.styles.chain(styleId);
    // Paragraph properties from most specific (direct) to least (base style).
    const pPrs = [pPr, ...chain.map((s) => s.pPr)].filter(Boolean);
    const firstVal = (name) => {
      for (const pr of pPrs) if (kid(pr, name)) return val(pr, name);
      return undefined;
    };

    let style = 'normal';
    for (const s of chain) {
      style = styleFromName(s.name) || 'normal';
      if (style !== 'normal') break;
    }
    if (style === 'normal' && styleId && !ctx.styles.byId.has(styleId)) {
      style = styleFromName(styleId.toLowerCase()) || 'normal';
    }
    if (style === 'normal') {
      const lvl = Number(firstVal('w:outlineLvl'));
      if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 5) style = 'h' + (lvl + 1);
    }

    // Headings carry their look in the style itself, so list membership
    // (numbered headings) and style-level run formatting are not applied.
    let list = null;
    let base = {};
    if (style === 'normal') {
      const numPr = pPrs.map((pr) => kid(pr, 'w:numPr')).find(Boolean);
      const numId = val(numPr, 'w:numId');
      if (numId && numId !== '0') {
        const level = parseInt(val(numPr, 'w:ilvl'), 10) || 0;
        const kind = ctx.listKind(numId, String(level));
        if (kind) list = { kind, level };
      }
      base = mergeProps(ctx.styles.defaults, ...chain.map((s) => s.rProps).reverse());
    }

    const runs = [];
    ctx.normal = style === 'normal';
    collectRuns(p, base, runs, ctx);
    ctx.normal = false;
    return { type: 'paragraph', style, list, align: JC[firstVal('w:jc')] || 'left', runs };
  }

  // Hyperlinks become plain text: the underline that marks them as links is
  // dropped, other formatting is kept.
  function collectRuns(node, base, runs, ctx, inLink) {
    for (const c of node.children) {
      if (c.name === 'w:r') convertRun(c, base, runs, ctx, inLink);
      else if (TRANSPARENT.has(c.name)) {
        collectRuns(c, base, runs, ctx, inLink || c.name === 'w:hyperlink');
      }
      // Everything else (w:del, w:moveFrom, bookmarks, ...) has no visible text.
    }
  }

  function convertRun(r, base, runs, ctx, inLink) {
    const rPr = kid(r, 'w:rPr');
    const charStyles = ctx.styles.chain(val(rPr, 'w:rStyle')).map((s) => s.rProps);
    const props = mergeProps(base, ...charStyles.reverse(), runProps(rPr));
    let text = '';
    for (const c of r.children) {
      switch (c.name) {
        case 'w:t':
          text += c.children.map((t) => t.text || '').join('');
          break;
        case 'w:tab':
        case 'w:ptab':
          text += ' ';
          break;
        case 'w:br':
        case 'w:cr':
          text += '\n';
          break;
        case 'w:noBreakHyphen':
          text += '-';
          break;
        case 'w:drawing':
        case 'w:pict':
        case 'w:object':
        case 'mc:AlternateContent':
          ctx.skipped[hasDescendant(c, 'w:txbxContent') ? 'textBoxes' : 'images']++;
          break;
        case 'w:footnoteReference':
          ctx.skipped.footnotes++;
          break;
        case 'w:endnoteReference':
          ctx.skipped.endnotes++;
          break;
        case 'w:commentReference':
          ctx.skipped.comments++;
          break;
        case 'w:sym':
          ctx.skipped.symbols++;
          break;
      }
    }
    if (!text) return;
    // Body text font/size tally, by characters (see bodyFont).
    if (ctx.normal && ctx.fonts) {
      const k = (props.font || '') + '|' + (props.size || '');
      ctx.fonts.set(k, (ctx.fonts.get(k) || 0) + text.replace(/\s/g, '').length);
    }
    const run = { text };
    if (inLink) props.underline = false;
    for (const f of ['bold', 'italic', 'underline', 'strike']) if (props[f]) run[f] = true;
    runs.push(run);
  }

  // Paragraphs of a table cell; nested tables are flattened to their text.
  function cellParagraphs(container, ctx, nested) {
    const out = [];
    for (const c of container.children) {
      if (c.name === 'w:p') {
        const p = convertParagraph(c, ctx);
        if (!nested || p.runs.length) out.push(p);
      } else if (c.name === 'w:tbl') {
        if (!nested) ctx.skipped.nestedTables++;
        for (const tr of kids(c, 'w:tr')) {
          for (const tc of kids(tr, 'w:tc')) out.push(...cellParagraphs(tc, ctx, true));
        }
      } else if (TRANSPARENT.has(c.name)) {
        out.push(...cellParagraphs(c, ctx, nested));
      }
    }
    return out;
  }

  function convertTable(tbl, ctx) {
    const rows = [];
    for (const tr of kids(tbl, 'w:tr')) {
      const row = [];
      const before = parseInt(val(kid(tr, 'w:trPr'), 'w:gridBefore'), 10) || 0;
      for (let k = 0; k < before; k++) row.push({ paragraphs: [] });
      for (const tc of kids(tr, 'w:tc')) {
        const tcPr = kid(tc, 'w:tcPr');
        const span = Math.max(1, parseInt(val(tcPr, 'w:gridSpan'), 10) || 1);
        const vMerge = kid(tcPr, 'w:vMerge');
        // A w:vMerge without val="restart" continues the cell above it.
        const continued = !!vMerge && vMerge.attrs['w:val'] !== 'restart';
        if (span > 1 || (vMerge && !continued)) ctx.skipped.mergedCells++;
        row.push({ paragraphs: continued ? [] : cellParagraphs(tc, ctx, false) });
        for (let k = 1; k < span; k++) row.push({ paragraphs: [] });
      }
      if (row.length) rows.push(row);
    }
    return { type: 'table', rows };
  }

  function collectBlocks(container, ctx, out) {
    for (const c of container.children) {
      if (c.name === 'w:p') out.push(convertParagraph(c, ctx));
      else if (c.name === 'w:tbl') out.push(convertTable(c, ctx));
      else if (TRANSPARENT.has(c.name)) collectBlocks(c, ctx, out);
    }
  }

  // The font family and size most of the body text is in: { family, size }
  // (either may be missing when the file does not say).
  function bodyFont(fonts, theme) {
    let best = null;
    let most = 0;
    for (const [k, n] of fonts) if (n > most) [best, most] = [k, n];
    if (!best) return null;
    const [f, sz] = best.split('|');
    const family = f.startsWith('theme:') ? theme[f.slice(6)] : f;
    const out = {};
    if (family) out.family = family;
    if (sz) out.size = Number(sz);
    return out.family || out.size ? out : null;
  }

  function buildWarnings(skipped) {
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const items = [
      [skipped.images, 'image skipped', 'images skipped'],
      [skipped.textBoxes, 'text box skipped', 'text boxes skipped'],
      [skipped.footnotes, 'footnote skipped', 'footnotes skipped'],
      [skipped.endnotes, 'endnote skipped', 'endnotes skipped'],
      [skipped.comments, 'comment skipped', 'comments skipped'],
      [skipped.symbols, 'symbol character skipped', 'symbol characters skipped'],
      [skipped.nestedTables, 'nested table flattened to text', 'nested tables flattened to text'],
      [skipped.mergedCells, 'merged cell expanded', 'merged cells expanded'],
    ];
    const out = items.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
    if (skipped.headersFooters) out.push('Headers and footers skipped');
    return out;
  }

  // Resolves to { doc, warnings }. Rejects with an Error when the input is not
  // a readable .docx file.
  async function parseDocx(input) {
    const zip = api.readZip(input);
    const decoder = new TextDecoder('utf-8');
    const readText = async (path) => (zip.has(path) ? decoder.decode(await zip.read(path)) : '');

    // The main part is almost always word/document.xml; otherwise follow the
    // package relationships.
    let path = 'word/document.xml';
    if (!zip.has(path) && zip.has('_rels/.rels')) {
      const rels = kid(parseXml(await readText('_rels/.rels')), 'Relationships');
      const rel = kids(rels, 'Relationship').find((r) =>
        /\/officeDocument$/.test(r.attrs.Type || '')
      );
      if (rel) path = String(rel.attrs.Target || '').replace(/^\//, '');
    }
    if (!zip.has(path)) {
      throw new Error('Not a Word document (word/document.xml is missing)');
    }
    const dir = path.slice(0, path.lastIndexOf('/') + 1);

    const body = kid(kid(parseXml(await readText(path)), 'w:document'), 'w:body');
    if (!body) throw new Error('Not a Word document (document body is missing)');

    const ctx = {
      fonts: new Map(),
      styles: readStyles(await readText(dir + 'styles.xml')),
      listKind: readNumbering(await readText(dir + 'numbering.xml')),
      skipped: {
        images: 0,
        textBoxes: 0,
        footnotes: 0,
        endnotes: 0,
        comments: 0,
        symbols: 0,
        nestedTables: 0,
        mergedCells: 0,
        headersFooters: zip.names.some((n) => /(^|\/)(header|footer)\d*\.xml$/.test(n)),
      },
    };
    const blocks = [];
    collectBlocks(body, ctx, blocks);
    const font = bodyFont(ctx.fonts, readTheme(await readText(dir + 'theme/theme1.xml')));
    const out = { doc: api.normalize({ blocks }), warnings: buildWarnings(ctx.skipped) };
    if (font) out.font = font;
    return out;
  }

  api.parseDocx = parseDocx;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
