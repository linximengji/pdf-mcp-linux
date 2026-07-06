import { chromium, Browser, Page } from 'playwright-core';
import MarkdownIt from 'markdown-it';
import markdownItAttrs from 'markdown-it-attrs';
import hljs from 'highlight.js';
import path from 'path';
import { promises as fs, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── highlight.js CSS loader ─────────────────────────────────────
const HL_CACHE: Record<string, string> = {};
function loadHLJS(theme: string): string {
  if (HL_CACHE[theme]) return HL_CACHE[theme];
  try { HL_CACHE[theme] = readFileSync(path.resolve(__dirname, `../node_modules/highlight.js/styles/${theme}.css`), 'utf-8'); }
  catch { HL_CACHE[theme] = ''; }
  return HL_CACHE[theme];
}

function slugify(t: string): string {
  return t.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
}

function addAnchorIds(md: MarkdownIt) {
  md.core.ruler.push('anchor_ids', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'heading_open') continue;
      const next = state.tokens[state.tokens.indexOf(token) + 1];
      if (!next || next.type !== 'inline') continue;
      token.attrSet('id', slugify(next.content));
    }
  });
}

// ── Density presets ────────────────────────────────────────────
const DENSITY: Record<string, Record<string, string>> = {
  compact: {
    fs:       '10px',
    lh:       '1.3',
    h1:       '1.5em', h2: '1.25em', h3: '1.1em', h4: '1em', h5: '0.9em', h6: '0.8em',
    hm:       '0.8em',
    pm:       '0.35em',
    td_pad:   '4px 5px',
    pre_fs:   '0.75em',
    pre_pad:  '0.5em',
    bq_m:     '0.4em 0',
    bq_pad:   '0.5em',
    toc_lh:   '1.2',
  },
  normal: {
    fs:       '12px',
    lh:       '1.5',
    h1:       '2em', h2: '1.6em', h3: '1.3em', h4: '1.1em', h5: '1em', h6: '0.9em',
    hm:       '1.3em',
    pm:       '0.7em',
    td_pad:   '7px 8px',
    pre_fs:   '0.8em',
    pre_pad:  '0.85em',
    bq_m:     '0.7em 0',
    bq_pad:   '0.8em',
    toc_lh:   '1.4',
  },
  spacious: {
    fs:       '16px',
    lh:       '2.0',
    h1:       '2.5em', h2: '1.8em', h3: '1.4em', h4: '1.2em', h5: '1.1em', h6: '1em',
    hm:       '2em',
    pm:       '1.2em',
    td_pad:   '10px 12px',
    pre_fs:   '0.9em',
    pre_pad:  '1em',
    bq_m:     '1em 0',
    bq_pad:   '1em',
    toc_lh:   '1.7',
  },
};

function densityCSS(d: string): string {
  const v = DENSITY[d] || DENSITY.normal;
  return `
html { font-size: ${v.fs}; }
body { font-size: 1rem; line-height: ${v.lh}; }
h1 { font-size: ${v.h1}; margin-top: ${v.hm}; }
h2 { font-size: ${v.h2}; margin-top: ${v.hm}; }
h3 { font-size: ${v.h3}; margin-top: ${v.hm}; }
h4 { font-size: ${v.h4}; margin-top: ${v.hm}; }
h5 { font-size: ${v.h5}; }
h6 { font-size: ${v.h6}; }
p  { margin: ${v.pm} 0; }
pre { font-size: ${v.pre_fs}; padding: ${v.pre_pad}; }
table th, table td { padding: ${v.td_pad}; }
blockquote { margin: ${v.bq_m}; padding-left: ${v.bq_pad}; }
.toc ul { line-height: ${v.toc_lh}; }
.cover-page h1 { font-size: 2.5rem !important; }
`;
}

// ── PDFGenerator ───────────────────────────────────────────────
export class PDFGenerator {
  private browser: Browser | null = null;
  private md: MarkdownIt;

  constructor() {
    this.md = new MarkdownIt({
      html: true, linkify: true, typographer: true,
      highlight(str: string, lang: string) {
        if (lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(str, { language: lang }).value; } catch {}
        }
        return '';
      }
    });
    this.md.use(markdownItAttrs);
    addAnchorIds(this.md);

    const defaultFence = this.md.renderer.rules.fence!;
    this.md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const info = tokens[idx].info.trim();
      const lang = info.split(/\s+/g)[0];
      if (lang === 'mermaid') {
        return `<pre class="mermaid">${this.md.utils.escapeHtml(tokens[idx].content)}</pre>`;
      }
      return defaultFence(tokens, idx, options, env, self);
    };
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }

  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }

  async generate(content: string, outputPath: string, options: any = {}): Promise<any> {
    const startTime = Date.now();
    if (!path.isAbsolute(outputPath)) {
      outputPath = path.join(os.homedir(), 'Downloads', outputPath);
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 1280, height: 960 });
      const html = await this.prepareHTML(content, options);
      await page.setContent(html, {
        waitUntil: options.wait_for_network ? 'networkidle' : 'domcontentloaded'
      });

      if (options.render_mermaid) {
        await page.addScriptTag({
          url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
        });
        await page.waitForFunction(() => (window as any).mermaid !== undefined, {}, { timeout: 15000 });
        await page.evaluate(async () => {
          const m = (window as any).mermaid;
          m.initialize({ startOnLoad: false, theme: 'default' });
          await m.run({ nodes: document.querySelectorAll('.mermaid') });
        });
        await page.waitForFunction(
          () => document.querySelectorAll('.mermaid svg').length > 0,
          {}, { timeout: 10000 }
        ).catch(() => {});
        await page.waitForTimeout(300);
      }

      const pdfOptions = this.buildPDFOptions(options);
      await page.pdf({ path: outputPath, ...pdfOptions });

      const stats = await fs.stat(outputPath);
      if (stats.size === 0) throw new Error('PDF was created but is empty (0 bytes)');

      const pageCount = await this.estimatePageCount(page);
      return {
        success: true, output_path: outputPath,
        file_size: stats.size, page_count: pageCount,
        generation_time_ms: Date.now() - startTime,
        warnings: options._warnings || []
      };
    } finally {
      await page.close();
    }
  }

  async generateWithTemplate(content: string, template: any, outputPath: string): Promise<any> {
    return this.generate(content, outputPath, {
      ...template.options, custom_css: template.css_content, html_template: template.html_template
    });
  }

  private async prepareHTML(content: string, options: any): Promise<string> {
    const themeCSS = await this.loadTheme(options.theme || 'default');
    const hlCSS = options.highlight_theme !== false
      ? loadHLJS(options.highlight_theme || 'github')
      : '';
    const customCSS = options.custom_css || '';
    const denCSS = densityCSS(options.density || 'normal');
    const mermaidScript = options.render_mermaid
      ? '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>'
      : '';

    let coverHTML = '';
    let bodyContent = content;
    if (options.include_cover) {
      const title = content.match(/^#\s+(.+)$/m);
      const date = content.match(/^- 日期:\s*(.+)$/m);
      const source = content.match(/^- 来源:\s*(.+)$/m);
      const tag = content.match(/^- 标签:\s*(.+)$/m);
      coverHTML = buildCoverHTML(
        title ? title[1].trim() : 'Document',
        date ? date[1].trim() : '',
        source ? source[1].trim() : '',
        tag ? tag[1].trim() : '',
        options.theme || 'default'
      );
      bodyContent = content.replace(/^#\s+.+$/m, '').trim();
    }

    const rendered = this.md.render(bodyContent);
    const tocHTML = options.include_toc ? this.buildTOC(bodyContent, options.toc_depth || 3) : '';

    if (options.html_template) {
      return options.html_template
        .replace('{{base_css}}', BASE_CSS)
        .replace('{{density_css}}', denCSS)
        .replace('{{theme_css}}', themeCSS)
        .replace('{{hljs_css}}', hlCSS)
        .replace('{{custom_css}}', customCSS)
        .replace('{{cover}}', coverHTML)
        .replace('{{toc}}', tocHTML)
        .replace('{{content}}', rendered);
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Document</title>
  <style>
    ${BASE_CSS}
    ${denCSS}
    ${themeCSS}
    ${hlCSS}
    ${customCSS}
  </style>
  ${mermaidScript}
</head>
<body>
  ${coverHTML}
  ${tocHTML ? `<div class="toc"><h2>Table of Contents</h2>${tocHTML}</div><div class="page-break"></div>` : ''}
  <div class="content">${rendered}</div>
</body>
</html>`;
  }

  private async loadTheme(name: string): Promise<string> {
    try { return await fs.readFile(path.join(__dirname, 'themes', `${name}.css`), 'utf-8'); }
    catch { return ''; }
  }

  private buildTOC(content: string, maxDepth: number): string {
    const headings: Array<{ level: number; text: string; id: string }> = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (!m) continue;
      const level = m[1].length;
      if (level > maxDepth) continue;
      const text = m[2].trim();
      headings.push({ level, text, id: slugify(text) });
    }
    if (!headings.length) return '';
    let html = '<ul>';
    const stack = [0];
    for (const h of headings) {
      while (stack[stack.length - 1] < h.level) { html += '<ul>'; stack.push(stack[stack.length - 1] + 1); }
      while (stack[stack.length - 1] > h.level) { html += '</ul>'; stack.pop(); }
      html += `<li><a href="#${h.id}">${h.text}</a></li>`;
    }
    while (stack.length > 1) { html += '</ul>'; stack.pop(); }
    html += '</ul>';
    return html;
  }

  private buildPDFOptions(options: any): any {
    const result: any = {
      format: options.format || 'A4',
      landscape: options.orientation === 'landscape',
      margin: options.margin || { top: '1in', right: '1in', bottom: '1in', left: '1in' },
      printBackground: options.print_background !== false
    };
    const hasHeader = options.header || options.footer || options.page_numbers;
    if (hasHeader) {
      result.displayHeaderFooter = true;
      result.headerTemplate = options.header || '<div></div>';
      result.footerTemplate = options.footer ||
        (options.page_numbers
          ? '<div style="width:100%;text-align:center;font-size:10px"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
          : '<div></div>');
    }
    return result;
  }

  private async estimatePageCount(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        const h = document.documentElement.scrollHeight;
        return Math.ceil(h / (11 * 96 - 2 * 96));
      });
    } catch { return 1; }
  }
}

// ── Cover page ─────────────────────────────────────────────────
function buildCoverHTML(title: string, date: string, source: string, tag: string, theme: string): string {
  const palettes: Record<string, [string, string]> = {
    default:      ['#1a5276', '#2980b9'],
    professional: ['#1a3a5c', '#2c6faa'],
    minimal:      ['#2c3e50', '#4a6274'],
    dark:         ['#1a1a2e', '#16213e'],
  };
  const [c1, c2] = palettes[theme] || palettes.default;
  const meta = [date, source, tag].filter(Boolean).join(' | ');
  return `<div class="cover-page" style="background:linear-gradient(135deg,${c1},${c2});color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;page-break-after:always;padding:2in;box-sizing:border-box;text-align:center;">
    <div>
      <div style="width:60px;height:4px;background:rgba(255,255,255,.4);margin:0 auto 1em;border-radius:2px;"></div>
      <h1 style="font-size:2.5rem;margin:0 0 .5em;border:none;color:inherit;padding:0;font-weight:700;letter-spacing:-.02em;">${escapeHTML(title)}</h1>
      <div style="width:40px;height:2px;background:rgba(255,255,255,.3);margin:1.5em auto;border-radius:1px;"></div>
      ${meta ? `<div style="font-size:.9rem;opacity:.75;margin-top:1em">${escapeHTML(meta)}</div>` : ''}
      <div style="margin-top:4em;font-size:.75rem;opacity:.4">Generated by pdf-gen</div>
    </div>
  </div>`;
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Base CSS ───────────────────────────────────────────────────
const BASE_CSS = `
@page { margin: 1in; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #222; margin: 0; padding: 0; text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
.page-break { page-break-after: always; }
.no-break   { page-break-inside: avoid; }

/* Headings */
h1,h2,h3,h4,h5,h6 { font-weight: 600; margin-bottom: .4em; line-height: 1.25; }
h1 { letter-spacing: -.02em; }
h2 { letter-spacing: -.01em; }

/* Paragraphs & lists */
p, li { margin: 0; orphans: 2; widows: 2; }

/* Code */
pre {
  background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 4px;
  overflow-x: auto; line-height: 1.4; tab-size: 2;
}
code {
  background: #f0f0f0; padding: .15em .35em; border-radius: 3px;
  font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace; font-size: .9em;
}
pre code { background: none; padding: 0; font-size: inherit; }

/* Tables */
table { border-collapse: collapse; width: 100%; margin: .8em 0; }
th,td { border: 1px solid #ddd; text-align: left; vertical-align: top; }
th { font-weight: 600; }
tr:nth-child(even) td { background: #f9f9f9; }

/* Images */
img { max-width: 100%; max-height: 70vh; height: auto; object-fit: contain; display: block; margin: .8em auto; }

/* Blockquotes */
blockquote {
  border-left: 4px solid #ddd; margin: .7em 0; padding: .2em .8em .2em 1em; color: #555;
}
blockquote p { margin: .3em 0; }

/* TOC */
.toc { margin-bottom: 2em; }
.toc h2 { margin-top: 0; }
.toc ul { list-style: none; padding-left: 1.5em; }
.toc > ul { padding-left: 0; }
.toc a { text-decoration: none; color: #333; }
.toc a:hover { text-decoration: underline; }

/* Horizontal rules */
hr {
  border: none; border-top: 1px solid #ddd; margin: 1.5em 0;
}

/* Mermaid */
.mermaid { text-align: center; margin: 1em 0; }
.mermaid svg { max-width: 100%; height: auto; }
`;
