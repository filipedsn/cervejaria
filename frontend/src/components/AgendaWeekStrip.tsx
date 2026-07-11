import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateKeyFromDate } from '../lib/evento-agenda';

const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const;
const WEEKS_PAST = 12;
const WEEKS_FUTURE = 12;

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addWeeks(weekStart: Date, weeks: number): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function buildWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
}

function formatMonthLabel(dateKey: string) {
  const label = new Date(`${dateKey}T12:00:00`).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function weekIndexForDate(weeks: { keys: string[] }[], dateKey: string): number {
  const index = weeks.findIndex((w) => w.keys.includes(dateKey));
  return index >= 0 ? index : WEEKS_PAST;
}

interface AgendaWeekStripProps {
  selectedDateKey: string;
  onSelectDate: (dateKey: string) => void;
}

export function AgendaWeekStrip({ selectedDateKey, onSelectDate }: AgendaWeekStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isProgrammaticScroll = useRef(false);
  const [visibleMonthKey, setVisibleMonthKey] = useState(selectedDateKey);

  const todayKey = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return dateKeyFromDate(today);
  }, []);

  const currentWeekStart = useMemo(() => {
    const today = new Date(`${todayKey}T12:00:00`);
    return startOfWeek(today);
  }, [todayKey]);

  const weeks = useMemo(() => {
    const result: { days: Date[]; keys: string[] }[] = [];
    for (let offset = -WEEKS_PAST; offset <= WEEKS_FUTURE; offset++) {
      const weekStart = addWeeks(currentWeekStart, offset);
      const days = buildWeekDays(weekStart);
      result.push({
        days,
        keys: days.map(dateKeyFromDate),
      });
    }
    return result;
  }, [currentWeekStart]);

  const scrollToWeek = useCallback((index: number, smooth: boolean) => {
    const el = weekRefs.current[index];
    if (!el) return;
    isProgrammaticScroll.current = true;
    el.scrollIntoView({ inline: 'start', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    window.setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, smooth ? 350 : 50);
  }, []);

  useEffect(() => {
    const index = weekIndexForDate(weeks, selectedDateKey);
    scrollToWeek(index, false);
    setVisibleMonthKey(selectedDateKey);
  }, [weeks, selectedDateKey, scrollToWeek]);

  const updateVisibleMonthFromScroll = useCallback(() => {
    if (isProgrammaticScroll.current) return;
    const container = scrollRef.current;
    if (!container) return;

    const scrollLeft = container.scrollLeft;
    const panelWidth = container.clientWidth;
    if (panelWidth <= 0) return;

    const index = Math.round(scrollLeft / panelWidth);
    const week = weeks[Math.min(Math.max(index, 0), weeks.length - 1)];
    if (week) {
      const midDay = week.keys[3] ?? week.keys[0];
      setVisibleMonthKey(midDay);
    }
  }, [weeks]);

  const handleScroll = useCallback(() => {
    updateVisibleMonthFromScroll();
  }, [updateVisibleMonthFromScroll]);

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink-soft">{formatMonthLabel(visibleMonthKey)}</p>
      <div
        ref={scrollRef}
        className="agenda-scroll -mx-4 flex px-4"
        onScroll={handleScroll}
        aria-label="Semanas da agenda"
      >
        {weeks.map((week, weekIndex) => (
          <div
            key={week.keys[0]}
            ref={(el) => {
              weekRefs.current[weekIndex] = el;
            }}
            className="agenda-week-panel grid shrink-0 grid-cols-7 gap-1"
            role="list"
            aria-label={`Semana de ${week.days[0].toLocaleDateString('pt-BR')}`}
          >
            {week.days.map((d) => {
              const key = dateKeyFromDate(d);
              const dow = d.getDay();
              const isSelected = key === selectedDateKey;
              const isToday = key === todayKey;

              return (
                <button
                  key={key}
                  type="button"
                  role="listitem"
                  onClick={() => onSelectDate(key)}
                  aria-label={d.toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                  aria-pressed={isSelected}
                  className="flex flex-col items-center gap-1.5 rounded-xl py-1 transition-colors active:bg-surface-lighter"
                >
                  <span
                    className={`text-[10px] font-semibold uppercase ${
                      isSelected ? 'text-brand-600' : 'text-ink-faint'
                    }`}
                  >
                    {WEEKDAYS[dow]}
                  </span>
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold tabular-nums ${
                      isSelected
                        ? 'bg-brand-600 text-white shadow-sm'
                        : isToday
                          ? 'text-brand-600 ring-2 ring-brand-200'
                          : 'text-ink-muted'
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
