import { useState } from 'preact/hooks';
import { moneyInputText, parseMoney } from '../data/money';

export function MoneyInput(props: { value: number; onChange: (agorot: number) => void; placeholder?: string; class?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(moneyInputText(props.value));
  return (
    <span class={`money-input ${props.class ?? ''}`}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={props.placeholder ?? '0'}
        autoFocus={props.autoFocus}
        onInput={e => {
          setText(e.currentTarget.value);
          props.onChange(parseMoney(e.currentTarget.value) ?? 0);
        }}
      />
      <span class="currency">₪</span>
    </span>
  );
}

export function Chips<T extends { id: string; name: string }>(props: { items: T[]; value?: string; onChange: (id: string) => void }) {
  return (
    <div class="chips">
      {props.items.map(i => (
        <button type="button" key={i.id} class={`chip ${props.value === i.id ? 'on' : ''}`} onClick={() => props.onChange(i.id)}>
          {i.name}
        </button>
      ))}
    </div>
  );
}

export function Segmented<V extends string>(props: { options: [V, string][]; value: V; onChange: (v: V) => void }) {
  return (
    <div class="segmented">
      {props.options.map(([v, label]) => (
        <button type="button" key={v} class={props.value === v ? 'on' : ''} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
