// Valide et normalise la sortie JSON du modèle vers le contrat "Content" attendu
// par le moteur Astro. Tolérant : ignore les blocs malformés plutôt que de casser.

const ALLOWED_INLINE = /<\/?(?:strong|em|code|b|i)>/gi;

function cleanHtml(s) {
  if (typeof s !== 'string') return '';
  // Conserve uniquement les balises inline autorisées ; neutralise le reste.
  return s
    .replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '')
    .replace(/<(?!\/?(?:strong|em|code|b|i)\b)[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function txt(s) { return typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''; }
function arr(a) { return Array.isArray(a) ? a : []; }

function normalizeBlock(b) {
  if (!b || typeof b !== 'object' || typeof b.type !== 'string') return null;
  switch (b.type) {
    case 'lead': {
      const html = cleanHtml(b.html || b.text);
      return html ? { type: 'lead', html } : null;
    }
    case 'paragraph': {
      const html = cleanHtml(b.html || b.text);
      return html ? { type: 'paragraph', html } : null;
    }
    case 'heading': {
      const text = txt(b.text || b.html);
      if (!text) return null;
      const level = Number(b.level) === 3 ? 3 : 2;
      return { type: 'heading', level, text };
    }
    case 'list': {
      const items = arr(b.items).map(cleanHtml).filter(Boolean);
      if (!items.length) return null;
      return { type: 'list', style: b.style === 'number' ? 'number' : 'bullet', items };
    }
    case 'callout': {
      const html = cleanHtml(b.html || b.text);
      if (!html) return null;
      const variant = ['info', 'tip', 'warning', 'key'].includes(b.variant) ? b.variant : 'info';
      return { type: 'callout', variant, title: txt(b.title) || undefined, html };
    }
    case 'table': {
      const headers = arr(b.headers).map(txt).filter((h) => h !== '');
      let rows = arr(b.rows).map((r) => arr(r).map(cleanHtml));
      if (!headers.length || !rows.length) return null;
      const n = headers.length;
      rows = rows.map((r) => {
        const c = r.slice(0, n);
        while (c.length < n) c.push('');
        return c;
      });
      return { type: 'table', caption: txt(b.caption) || undefined, headers, rows };
    }
    case 'comparison': {
      let cols = arr(b.columns);
      // rétro-compat : certaines sorties utilisent left/right
      if (!cols.length && (b.left || b.right)) cols = [b.left, b.right].filter(Boolean);
      cols = cols.slice(0, 2).map((c) => ({
        heading: txt(c?.heading || c?.title) || 'Option',
        tone: ['pos', 'neg', 'neutral'].includes(c?.tone) ? c.tone : 'neutral',
        points: arr(c?.points).map(cleanHtml).filter(Boolean),
      })).filter((c) => c.points.length);
      if (cols.length < 2) return null;
      return { type: 'comparison', title: txt(b.title) || undefined, columns: cols };
    }
    case 'stats': {
      const items = arr(b.items).map((i) => ({ value: txt(i?.value), label: txt(i?.label) }))
        .filter((i) => i.value && i.label).slice(0, 4);
      if (items.length < 2) return null;
      return { type: 'stats', items };
    }
    case 'steps': {
      const items = arr(b.items).map((i) => ({ title: txt(i?.title), html: cleanHtml(i?.html || i?.text) }))
        .filter((i) => i.title || i.html);
      if (!items.length) return null;
      return { type: 'steps', items };
    }
    case 'quote': {
      const html = cleanHtml(b.html || b.text);
      return html ? { type: 'quote', html, cite: txt(b.cite) || undefined } : null;
    }
    default:
      return null;
  }
}

export function normalizeContent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('non-object');
  const blocks = arr(raw.blocks).map(normalizeBlock).filter(Boolean);
  if (blocks.length < 3) throw new Error(`trop peu de blocs (${blocks.length})`);
  // garantit un lead en tête
  if (blocks[0].type !== 'lead') {
    const li = blocks.findIndex((b) => b.type === 'lead');
    if (li > 0) { const [lead] = blocks.splice(li, 1); blocks.unshift(lead); }
  }
  const faq = arr(raw.faq).map((f) => ({ q: txt(f?.q), a: cleanHtml(f?.a) }))
    .filter((f) => f.q && f.a);
  const tags = arr(raw.tags).map(txt).filter(Boolean).slice(0, 4);

  const content = {
    title: txt(raw.title) || undefined,
    metaTitle: txt(raw.metaTitle) || undefined,
    metaDescription: txt(raw.metaDescription) || undefined,
    excerpt: txt(raw.excerpt) || undefined,
    readingTime: Number.isFinite(+raw.readingTime) ? Math.round(+raw.readingTime) : undefined,
    tags,
    keyTakeaways: arr(raw.keyTakeaways).map(txt).filter(Boolean).slice(0, 6),
    blocks,
    faq,
  };
  return content;
}

// Extrait le texte de sortie d'une réponse Responses API (sync ou item batch).
export function extractOutputText(response) {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text) return response.output_text;
  const out = response.output || response.body?.output;
  if (Array.isArray(out)) {
    const parts = [];
    for (const item of out) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join('');
  }
  return '';
}
