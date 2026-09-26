import { parseMoney } from './money';
import type { AppData } from './store';
import type { Transaction, TxType } from './types';

/** Details an iPhone Shortcut already asked for in its own pop-ups. Category and payment method go by name. */
export interface QuickPreset {
  type?: TxType;
  amount?: number;
  category?: string;
  /** Expenses: payment method. Income: the account it went into. */
  method?: string;
}

/**
 * The Shortcut copies this to the clipboard before opening the app, because the iPhone drops anything
 * added to the address it opens a home-screen web app with:
 *   money-app:add=expense&amount=45&cat=אוכל בחוץ&pay=מזומן
 */
export const CLIPBOARD_PREFIX = 'money-app:';

export function presetFromParams(params: URLSearchParams): QuickPreset | null {
  const add = params.get('add');
  if (add === null) return null;
  return {
    type: (['expense', 'income', 'transfer'] as const).find(t => t === add.trim()),
    amount: parseMoney(params.get('amount') ?? '') || undefined,
    category: params.get('cat')?.trim() || undefined,
    method: params.get('pay')?.trim() || undefined,
  };
}

export function presetFromClipboard(text: string): QuickPreset | null {
  const t = text.trim();
  return t.startsWith(CLIPBOARD_PREFIX) ? presetFromParams(new URLSearchParams(t.slice(CLIPBOARD_PREFIX.length))) : null;
}

const byName = <T extends { name: string; archived?: boolean }>(items: T[], name?: string) =>
  name ? items.find(i => !i.archived && i.name.trim() === name.trim()) : undefined;

/** Finds the category, payment method and account the preset names. */
export function resolvePreset(preset: QuickPreset, data: Pick<AppData, 'categories' | 'methods' | 'accounts'>) {
  const type = preset.type ?? 'expense';
  return {
    type,
    category: byName(data.categories.filter(c => c.kind === type), preset.category),
    method: type === 'expense' ? byName(data.methods, preset.method) : undefined,
    account: type === 'income' ? byName(data.accounts, preset.method) : undefined,
  };
}

/** A ready-to-save transaction when the Shortcut gave everything it needs (today's date), otherwise null. */
export function quickTransaction(preset: QuickPreset, data: Pick<AppData, 'categories' | 'methods' | 'accounts'>, today: string): Transaction | null {
  const r = resolvePreset(preset, data);
  if (!preset.amount || !r.category || (r.type === 'expense' ? !r.method : r.type === 'income' ? !r.account : true)) return null;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: r.type,
    amount: preset.amount,
    date: today,
    categoryId: r.category.id,
    ...(r.type === 'expense' ? { methodId: r.method!.id } : { accountId: r.account!.id }),
    createdAt: now,
    updatedAt: now,
  };
}
