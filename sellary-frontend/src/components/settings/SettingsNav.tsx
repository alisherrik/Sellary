'use client';

import { useRef, type ComponentType, type KeyboardEvent, type SVGProps } from 'react';

export interface SettingsSectionDef {
  id: string;
  /** Nav label — short enough to survive the phone tab strip. */
  label: string;
  /** One line under the panel heading saying what lives in this section. */
  summary: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const tabDomId = (id: string) => `settings-tab-${id}`;
export const panelDomId = (id: string) => `settings-panel-${id}`;

/**
 * The section switcher. One tablist, two layouts: a scrolling strip pinned
 * under the page title on a phone (thumb-sized targets, no hidden sections)
 * and a sticky column on the left from `lg` up. Every section is visible at
 * once and any of them is one press away.
 *
 * Keyboard follows the tabs pattern: arrows move and activate, Home/End jump
 * to the ends, and only the selected tab is in the tab order.
 */
export default function SettingsNav({
  sections,
  activeId,
  onSelect,
}: {
  sections: SettingsSectionDef[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (delta: number) => {
    const index = sections.findIndex((section) => section.id === activeId);
    const next = sections[(index + delta + sections.length) % sections.length];
    if (!next) return;
    onSelect(next.id);
    buttonRefs.current[next.id]?.focus();
  };

  const jumpTo = (section: SettingsSectionDef | undefined) => {
    if (!section) return;
    onSelect(section.id);
    buttonRefs.current[section.id]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        jumpTo(sections[0]);
        break;
      case 'End':
        event.preventDefault();
        jumpTo(sections[sections.length - 1]);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Разделы настроек"
      onKeyDown={handleKeyDown}
      className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto border-b border-[var(--erp-divider)] bg-[var(--erp-bg)] px-4 scrollbar-hide lg:top-6 lg:z-0 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0 lg:px-0"
    >
      {sections.map((section) => {
        const isActive = section.id === activeId;
        const { Icon } = section;
        return (
          <button
            key={section.id}
            ref={(node) => {
              buttonRefs.current[section.id] = node;
            }}
            id={tabDomId(section.id)}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={panelDomId(section.id)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(section.id)}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] lg:w-full lg:justify-start lg:border-b-0 lg:border-l-2 lg:py-2.5 lg:text-left ${
              isActive
                ? 'border-[var(--erp-accent)] bg-white text-[var(--erp-accent)] lg:border-[var(--erp-accent)]'
                : 'border-transparent text-[var(--erp-muted)] hover:text-[var(--erp-text)] lg:border-transparent lg:hover:bg-white'
            }`}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
