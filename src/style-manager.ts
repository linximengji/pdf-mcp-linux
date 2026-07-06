import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const STYLES_DIR = path.join(os.homedir(), '.pdf-gen-styles');

interface StyleConfig {
  name: string;
  description: string;
  prompt: string;
  theme: string;
  customCSS: string;
  format: string;
  orientation: string;
  margin: Record<string, string>;
  include_toc: boolean;
  toc_depth: number;
  page_numbers: boolean;
  header: string;
  footer: string;
  template: string | null;
  created: string;
  updated: string;
}

async function ensureDir() {
  await fs.mkdir(STYLES_DIR, { recursive: true });
}

export async function createStyle(name: string, data: any): Promise<any> {
  await ensureDir();
  const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '');
  if (sanitized !== name) throw new Error('Style name: letters, numbers, hyphens, underscores only');

  const style: StyleConfig = {
    name, description: data.description || '', prompt: data.prompt || '',
    theme: data.theme || 'default', customCSS: data.customCSS || '',
    format: data.format || 'A4', orientation: data.orientation || 'portrait',
    margin: data.margin || { top: '2.5cm', right: '2cm', bottom: '2.5cm', left: '2cm' },
    include_toc: !!data.include_toc, toc_depth: data.toc_depth || 3,
    page_numbers: data.page_numbers !== false,
    header: data.header || '', footer: data.footer || '',
    template: data.template || null,
    created: new Date().toISOString(), updated: new Date().toISOString()
  };
  await fs.writeFile(path.join(STYLES_DIR, `${sanitized}.json`), JSON.stringify(style, null, 2), 'utf-8');
  return { success: true, style_name: name };
}

export async function getStyle(name: string): Promise<any> {
  const p = path.join(STYLES_DIR, `${name}.json`);
  return JSON.parse(await fs.readFile(p, 'utf-8'));
}

export async function updateStyle(name: string, updates: any): Promise<any> {
  const existing = await getStyle(name);
  const updated = { ...existing, ...updates, updated: new Date().toISOString() };
  if (updates.formatting) {
    updated.theme = updates.formatting.theme ?? existing.theme;
    updated.customCSS = updates.formatting.customCSS ?? existing.customCSS;
    updated.format = updates.formatting.format ?? existing.format;
    updated.orientation = updates.formatting.orientation ?? existing.orientation;
    updated.margin = updates.formatting.margin ?? existing.margin;
    updated.include_toc = updates.formatting.include_toc ?? existing.include_toc;
    updated.page_numbers = updates.formatting.page_numbers ?? existing.page_numbers;
    updated.header = updates.formatting.header ?? existing.header;
    updated.footer = updates.formatting.footer ?? existing.footer;
  }
  await fs.writeFile(path.join(STYLES_DIR, `${name}.json`), JSON.stringify(updated, null, 2), 'utf-8');
  return { success: true, style_name: name, updated_style: updated };
}

export async function listStyles(): Promise<any[]> {
  await ensureDir();
  const files = await fs.readdir(STYLES_DIR);
  const styles: any[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(await fs.readFile(path.join(STYLES_DIR, f), 'utf-8'));
      styles.push({
        name: s.name, description: s.description,
        created: s.created, updated: s.updated,
        hasPrompt: !!s.prompt, hasTemplate: !!s.template,
        theme: s.theme
      });
    } catch {}
  }
  return styles;
}

export async function deleteStyle(name: string): Promise<any> {
  await fs.unlink(path.join(STYLES_DIR, `${name}.json`));
  return { success: true };
}

export function styleToOptions(style: any, override: any = {}): any {
  return {
    theme: style.theme,
    custom_css: style.customCSS,
    format: style.format,
    orientation: style.orientation,
    margin: style.margin,
    include_toc: style.include_toc,
    toc_depth: style.toc_depth,
    page_numbers: style.page_numbers,
    header: style.header,
    footer: style.footer,
    ...override
  };
}
