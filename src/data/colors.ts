import type { Category } from './types';

/**
 * Colors a category can wear, so "where did the money go" tells categories apart at a glance.
 * The first seven are the charts' validated categorical steps; the rest extend the list for users
 * with many categories (charts still show at most seven slices plus "other").
 */
export const CATEGORY_COLORS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7',
  '#0f8b8d', '#8d6e63', '#b0409c', '#607d8b', '#9e9d24', '#e34948',
];

/** The category's own color, or one given by its place in its list (expense and income lists count separately). */
export function categoryColor(id: string | undefined, categories: Category[]) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return 'var(--series-other)';
  if (cat.color) return cat.color;
  const sameKind = categories.filter(c => c.kind === cat.kind).sort((a, b) => a.order - b.order);
  return CATEGORY_COLORS[Math.max(0, sameKind.indexOf(cat)) % CATEGORY_COLORS.length];
}

export const nextColor = (current: string) => CATEGORY_COLORS[(CATEGORY_COLORS.indexOf(current) + 1) % CATEGORY_COLORS.length];
