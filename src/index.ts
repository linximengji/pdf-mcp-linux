import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PDFGenerator } from './pdf-generator.js';
import { embedImages } from './image-processor.js';
import { createTemplate, getTemplate, getAvailableThemes } from './template-manager.js';
import {
  createStyle, getStyle, updateStyle, listStyles, deleteStyle, styleToOptions
} from './style-manager.js';

const pdfGen = new PDFGenerator();
const server = new Server(
  { name: 'pdf-gen', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.onerror = (e) => console.error('[MCP Error]', e);

process.on('SIGINT', async () => {
  await pdfGen.close();
  await server.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await pdfGen.close();
  await server.close();
  process.exit(0);
});

const TOOL_DEFS = [
  {
    name: 'generate_pdf',
    description: 'Generate a PDF from markdown content with custom styling',
    inputSchema: {
      type: 'object', required: ['content', 'output_path'],
      properties: {
        content: { type: 'string', description: 'Markdown content to convert' },
        output_path: { type: 'string', description: 'Output PDF file path' },
        options: {
          type: 'object', description: 'PDF generation options',
          properties: {
            format: { type: 'string', enum: ['A4','A3','A5','Letter','Legal','Tabloid'] },
            orientation: { type: 'string', enum: ['portrait','landscape'] },
            margin: {
              type: 'object',
              properties: {
                top: { type: 'string' }, right: { type: 'string' },
                bottom: { type: 'string' }, left: { type: 'string' }
              }
            },
            theme: { type: 'string', enum: ['default','professional','minimal','dark','custom'] },
            custom_css: { type: 'string', description: 'Additional CSS to inject' },
            include_toc: { type: 'boolean' }, toc_depth: { type: 'number', minimum: 1, maximum: 6 },
            page_numbers: { type: 'boolean' },
            header: { type: 'string', description: 'HTML for page header' },
            footer: { type: 'string', description: 'HTML for page footer' },
            density: { type: 'string', enum: ['compact','normal','spacious'], default: 'normal', description: 'Content density: compact (more content/page), normal, spacious (more whitespace)' },
            include_cover: { type: 'boolean', description: 'Generate a cover page with title/date/source' },
            highlight_theme: { type: 'string', description: 'highlight.js CSS theme name (e.g. github, monokai, atom-one-dark). Set false to disable' },
            render_mermaid: { type: 'boolean', description: 'Render Mermaid diagram code blocks' },
            image_quality: { type: 'number', minimum: 0, maximum: 100 },
            max_image_width: { type: 'number' },
            wait_for_network: { type: 'boolean' },
            enable_javascript: { type: 'boolean' },
            print_background: { type: 'boolean' },
          }
        }
      }
    }
  },
  {
    name: 'create_styled_template',
    description: 'Create a reusable styled template for consistent document generation',
    inputSchema: {
      type: 'object', required: ['template_name', 'css_content'],
      properties: {
        template_name: { type: 'string' }, css_content: { type: 'string' },
        html_template: { type: 'string', description: 'Base HTML template (placeholders: {{content}}, {{base_css}}, {{theme_css}}, {{hljs_css}}, {{custom_css}}, {{cover}}, {{toc}})' }
      }
    }
  },
  {
    name: 'generate_pdf_from_template',
    description: 'Generate PDF using a predefined template',
    inputSchema: {
      type: 'object', required: ['content', 'template_name', 'output_path'],
      properties: {
        content: { type: 'string' }, template_name: { type: 'string' },
        output_path: { type: 'string' },
        variables: { type: 'object', description: 'Template variables {{key}} to replace' }
      }
    }
  },
  {
    name: 'embed_images',
    description: 'Process and embed images in markdown, with optimization',
    inputSchema: {
      type: 'object', required: ['markdown_content', 'image_sources'],
      properties: {
        markdown_content: { type: 'string' },
        image_sources: {
          type: 'array',
          items: {
            type: 'object', required: ['placeholder', 'source'],
            properties: {
              placeholder: { type: 'string' }, source: { type: 'string' },
              alt: { type: 'string' }, caption: { type: 'string' },
              width: { type: 'number' }, height: { type: 'number' },
              alignment: { type: 'string', enum: ['left','center','right'] }
            }
          }
        },
        options: {
          type: 'object',
          properties: {
            auto_optimize: { type: 'boolean' }, quality: { type: 'number' },
            format: { type: 'string', enum: ['auto','jpeg','png','webp'] },
            create_thumbnails: { type: 'boolean' }
          }
        }
      }
    }
  },
  {
    name: 'get_available_themes',
    description: 'List all available PDF themes and their descriptions',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'validate_markdown',
    description: 'Validate markdown content and check for issues before PDF generation',
    inputSchema: {
      type: 'object', required: ['content'],
      properties: {
        content: { type: 'string' },
        check_images: { type: 'boolean' }, check_links: { type: 'boolean' }
      }
    }
  },
  {
    name: 'create_custom_style',
    description: 'Create a custom PDF style with formatting, prompts, and templates',
    inputSchema: {
      type: 'object', required: ['style_name'],
      properties: {
        style_name: { type: 'string' },
        description: { type: 'string' }, prompt: { type: 'string' },
        theme: { type: 'string', enum: ['default','professional','minimal','dark'] },
        custom_css: { type: 'string' },
        format: { type: 'string', enum: ['A4','A3','A5','Letter','Legal','Tabloid'] },
        orientation: { type: 'string', enum: ['portrait','landscape'] },
        margin: {
          type: 'object',
          properties: {
            top: { type: 'string' }, right: { type: 'string' },
            bottom: { type: 'string' }, left: { type: 'string' }
          }
        },
        include_toc: { type: 'boolean' }, page_numbers: { type: 'boolean' },
        header: { type: 'string' }, footer: { type: 'string' },
        template: { type: 'string' }
      }
    }
  },
  {
    name: 'get_custom_style',
    description: 'Get details of a saved custom style including its prompt',
    inputSchema: { type: 'object', required: ['style_name'], properties: { style_name: { type: 'string' } } }
  },
  {
    name: 'list_custom_styles',
    description: 'List all available custom styles',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'generate_pdf_with_style',
    description: 'Generate a PDF using a saved custom style',
    inputSchema: {
      type: 'object', required: ['style_name', 'content', 'output_path'],
      properties: {
        style_name: { type: 'string' }, content: { type: 'string' }, output_path: { type: 'string' },
        override_options: { type: 'object', description: 'Options to override from the style' }
      }
    }
  },
  {
    name: 'update_custom_style',
    description: 'Update an existing custom style',
    inputSchema: { type: 'object', required: ['style_name', 'updates'], properties: { style_name: { type: 'string' }, updates: { type: 'object' } } }
  },
  {
    name: 'delete_custom_style',
    description: 'Delete a custom style',
    inputSchema: { type: 'object', required: ['style_name'], properties: { style_name: { type: 'string' } } }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

async function validateMarkdown(content: string, opts: any = {}): Promise<any> {
  const issues: any[] = [];
  const stats: any = { word_count: 0, images: 0, links: 0, headings: [] };

  const textContent = content.replace(/[#*`\[\]()!]/g, '');
  stats.word_count = textContent.split(/\s+/).filter(Boolean).length;

  const lines = content.split('\n');
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) stats.headings.push({ level: h[1].length, text: h[2].trim() });

    const img = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (img) stats.images++;
  }

  const firstLine = lines.find(l => l.trim());
  if (firstLine && !firstLine.startsWith('#')) {
    issues.push({ type: 'info', message: 'Document does not start with a heading', suggestion: 'Start with # Title' });
  }

  return { valid: issues.filter(i => i.type === 'error').length === 0, issues, statistics: stats };
}

function ok(data: any) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(error: Error) {
  return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const { name, arguments: rawArgs } = req.params;
    const args = rawArgs as Record<string, any>;

    switch (name) {
      case 'generate_pdf': {
        const { content, output_path, options = {} } = args;
        return ok(await pdfGen.generate(content as string, output_path as string, options as any));
      }
      case 'create_styled_template': {
        const { template_name, css_content, html_template } = args;
        return ok(await createTemplate(template_name as string, css_content as string, html_template as string | undefined));
      }
      case 'generate_pdf_from_template': {
        const { content, template_name, output_path, variables = {} } = args;
        const tmpl = await getTemplate(template_name as string);
        let processedContent = content as string;
        for (const [k, v] of Object.entries(variables as Record<string, any>)) {
          processedContent = processedContent.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return ok(await pdfGen.generateWithTemplate(processedContent, tmpl, output_path as string));
      }
      case 'embed_images': {
        const { markdown_content, image_sources, options = {} } = args;
        return ok(await embedImages(markdown_content as string, image_sources as any[], options as any));
      }
      case 'get_available_themes': {
        return ok({ themes: await getAvailableThemes() });
      }
      case 'validate_markdown': {
        const { content, check_images = false, check_links = false } = args;
        return ok(await validateMarkdown(content as string, { check_images: check_images as boolean, check_links: check_links as boolean }));
      }
      case 'create_custom_style': {
        const { style_name, ...data } = args;
        return ok(await createStyle(style_name as string, data));
      }
      case 'get_custom_style': {
        return ok(await getStyle(args.style_name as string));
      }
      case 'list_custom_styles': {
        return ok({ styles: await listStyles() });
      }
      case 'generate_pdf_with_style': {
        const { style_name, content, output_path, override_options = {} } = args;
        return ok(await pdfGen.generate(content as string, output_path as string, styleToOptions(await getStyle(style_name as string), override_options as any)));
      }
      case 'update_custom_style': {
        return ok(await updateStyle(args.style_name as string, args.updates as any));
      }
      case 'delete_custom_style': {
        return ok(await deleteStyle(args.style_name as string));
      }
      default:
        throw new Error(`Unknown tool "${name}"`);
    }
  } catch (e: any) {
    return fail(e);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('PDF Generator MCP server v2 running...');
