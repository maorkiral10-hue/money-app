import { categoryColor } from '../data/colors';
import type { Category } from '../data/types';

/** A category in a list: a round mark with its first letter, in the category's color (a transfer gets ⇄). */
export function CategoryMark(props: { id?: string; categories: Category[]; transfer?: boolean; small?: boolean }) {
  const name = props.categories.find(c => c.id === props.id)?.name.trim() ?? '';
  const color = props.transfer ? 'var(--muted)' : categoryColor(props.id, props.categories);
  return (
    <span class={`cat-mark ${props.small ? 'sm' : ''}`} style={{ '--c': color }} aria-hidden="true">
      {props.transfer ? '⇄' : name.slice(0, 1) || '·'}
    </span>
  );
}
