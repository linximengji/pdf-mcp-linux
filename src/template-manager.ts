import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(os.homedir(), '.pdf-gen-templates');

async function ensureDir() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
}

export async function createTemplate(name: string, cssContent: string, htmlTemplate?: string): Promise<any> {
  await ensureDir();
  const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '');
  if (sanitized !== name) throw new Error('Template name: letters, numbers, hyphens, underscores only');

  const dir = path.join(TEMPLATES_DIR, sanitized);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'style.css'), cssContent, 'utf-8');
  if (htmlTemplate) {
    await fs.writeFile(path.join(dir, 'template.html'), htmlTemplate, 'utf-8');
  }
  await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify({
    name, created: new Date().toISOString(), hasHtmlTemplate: !!htmlTemplate
  }, null, 2), 'utf-8');

  return { success: true, template_name: name, template_path: dir };
}

export async function getTemplate(name: string): Promise<any> {
  const dir = path.join(TEMPLATES_DIR, name);
  await fs.access(dir);
  const cssContent = await fs.readFile(path.join(dir, 'style.css'), 'utf-8');
  let htmlTemplate: string | null = null;
  try { htmlTemplate = await fs.readFile(path.join(dir, 'template.html'), 'utf-8'); } catch {}
  return { name, css_content: cssContent, html_template: htmlTemplate, options: {} };
}

export async function getAvailableThemes(): Promise<any[]> {
  const themesDir = path.join(__dirname, 'themes');
  const themes: any[] = [
    { name: 'default', description: 'Clean and readable typography with standard spacing',
      features: ['Professional font stack', 'Clear heading hierarchy', 'Syntax highlighting', 'Responsive images'],
      best_for: ['General documentation', 'Technical reports'] },
    { name: 'professional', description: 'Corporate styling with branded colors and letterhead design',
      features: ['Professional color scheme', 'Enhanced tables', 'Custom header/footer support', 'Page numbering'],
      best_for: ['Business reports', 'Proposals', 'Corporate documentation'] },
    { name: 'minimal', description: 'Distraction-free design with focus on content',
      features: ['Maximum readability', 'Generous whitespace', 'Clean code blocks'],
      best_for: ['Technical docs', 'Academic papers', 'Long-form content'] },
    { name: 'dark', description: 'Dark theme optimized for presentations and screens',
      features: ['High contrast design', 'Eye-friendly colors', 'Vibrant syntax highlighting'],
      best_for: ['Slide presentations', 'Code documentation', 'Screen viewing'] },
  ];
  for (const t of themes) {
    try { await fs.access(path.join(themesDir, `${t.name}.css`)); t.available = true; } catch { t.available = false; }
  }
  return themes;
}
