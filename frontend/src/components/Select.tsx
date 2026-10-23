import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

/** Select-only combobox, using the same surface/brand tokens as app menus. */
export function Select({ id, value, options, disabled = false, onChange }: {
  id: string;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });
  const selected = options.find((option) => option.value === value);
  const expanded = open && !disabled;

  function show() {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }
  function choose(index: number) {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 240 && above > below;
      const height = Math.max(0, Math.min(320, up ? above : below));
      const width = Math.min(rect.width, window.innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: up ? rect.top - height - 4 : rect.bottom + 4, width, maxHeight: height });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [expanded]);
  useEffect(() => {
    if (expanded) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded]);

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!expanded) { show(); return; }
      if (event.key === 'Enter' || event.key === ' ') { choose(active); return; }
      setActive((index) => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key, time: now };
      const index = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(search.current.text.toLocaleLowerCase()));
      if (!expanded) show();
      if (index >= 0) setActive(index);
    }
  }
  return <>
    <button ref={trigger} id={id} type="button" role="combobox" value={value}
      aria-expanded={expanded} aria-haspopup="listbox" aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
      disabled={disabled} onKeyDown={keyDown} onBlur={() => setOpen(false)}
      onClick={() => expanded ? setOpen(false) : show()}
      className="input flex items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50 hover:border-brand-400">
      <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">
        <span className="block font-medium">{selected?.label}</span>
        {selected?.description && <span className="mt-1 block text-sm text-ink-muted">{selected.description}</span>}
      </span>
      <svg className="h-5 w-5 shrink-0 text-ink-muted" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
    </button>
    {expanded && createPortal(<ul ref={list} id={listId} role="listbox" aria-labelledby={id}
      style={position} className="fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 shadow-lg">
      {options.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={option.value === value} data-value={option.value}
        onPointerDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}
        className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-base text-ink ${index === active ? 'bg-surface-lighter outline-2 -outline-offset-2 outline-brand-400' : 'hover:bg-surface-lighter'} ${option.value === value ? 'bg-brand-50 font-semibold' : ''}`}>
        <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">
          <span className="block">{option.label}</span>
          {option.description && <span className="mt-1 block text-sm font-normal text-ink-muted">{option.description}</span>}
        </span>
        <span className="w-5 shrink-0 text-brand-400" aria-hidden="true">{option.value === value ? '✓' : ''}</span>
      </li>)}
    </ul>, document.body)}
  </>;
}
