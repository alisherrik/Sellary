'use client';

import { useMemo, useState } from 'react';
import {
  BuildingOffice2Icon,
  BuildingStorefrontIcon,
  CpuChipIcon,
  LockClosedIcon,
  ServerStackIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';

import AiConnectorSection from '@/components/settings/AiConnectorSection';
import CompanyAdminSection from '@/components/settings/CompanyAdminSection';
import CompanyProfileSection from '@/components/settings/CompanyProfileSection';
import MarketplaceSettingsSection from '@/components/settings/MarketplaceSettingsSection';
import ReconciliationSection from '@/components/settings/ReconciliationSection';
import SettingsNav, {
  panelDomId,
  tabDomId,
  type SettingsSectionDef,
} from '@/components/settings/SettingsNav';
import SystemStatusSection from '@/components/settings/SystemStatusSection';
import { useAuthStore, useModules } from '@/lib/store';
import { canAccessModule } from '@/lib/modules';

const COMPANY: SettingsSectionDef = {
  id: 'company',
  label: 'Компания',
  summary: 'Реквизиты рабочего пространства, валюта и печать чека.',
  Icon: BuildingOffice2Icon,
};

const MARKETPLACE: SettingsSectionDef = {
  id: 'marketplace',
  label: 'Магазин',
  summary: 'Витрина в Telegram-маркетплейсе и способы получения заказа.',
  Icon: BuildingStorefrontIcon,
};

const TEAM: SettingsSectionDef = {
  id: 'team',
  label: 'Сотрудники',
  summary: 'Кто работает в компании, с какой ролью и к каким модулям имеет доступ.',
  Icon: UsersIcon,
};

const RECONCILIATION: SettingsSectionDef = {
  id: 'reconciliation',
  label: 'Сверка',
  summary: 'Дата, с которой начинается открытый период. Документы до неё не изменяются.',
  Icon: LockClosedIcon,
};

const AI: SettingsSectionDef = {
  id: 'ai',
  label: 'ИИ-коннектор',
  summary: 'Подключение Claude и других агентов: адрес, кто подключён, отзыв доступа.',
  Icon: CpuChipIcon,
};

const SYSTEM: SettingsSectionDef = {
  id: 'system',
  label: 'Система',
  summary: 'Связь с сервером, версии и состав релиза.',
  Icon: ServerStackIcon,
};

/**
 * Settings is four separate jobs — company preferences, the storefront, staff
 * access, and system status — so it is four panels behind one switcher rather
 * than one long scroll. Every section is listed at once (a sticky column from
 * `lg` up, a pinned scrolling strip on a phone) and any of them is one press
 * away.
 */
export default function SettingsPage() {
  const currentCompany = useAuthStore((state) => state.currentCompany);
  const isAdmin = currentCompany?.role === 'admin';
  const modules = useModules();

  // Staff administration is admin-only; the tab would otherwise open onto a
  // panel that has nothing to show. So is the reconciliation: it spans stock
  // and cash and the server only lets an admin declare one. The connector tab
  // follows its module: with `ai` off there is no address to copy and nobody to
  // list, so the tab would open onto a 403.
  const sections = useMemo(() => {
    const list = isAdmin
      ? [COMPANY, MARKETPLACE, TEAM, RECONCILIATION]
      : [COMPANY, MARKETPLACE];
    if (canAccessModule(modules, 'ai')) list.push(AI);
    list.push(SYSTEM);
    return list;
  }, [isAdmin, modules]);

  const [activeId, setActiveId] = useState(COMPANY.id);
  const active = sections.find((section) => section.id === activeId) ?? sections[0];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-5 lg:px-8 lg:py-8">
      <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--erp-accent)] lg:tracking-[0.18em]">
        Компания · {(currentCompany?.name || '').toUpperCase()}
      </div>
      <h1 className="mt-1.5 text-[26px] font-extrabold tracking-tight text-[var(--erp-text)] lg:mt-2 lg:text-[34px]">
        Настройки
      </h1>
      <p className="mt-1 max-w-[60ch] text-[13px] leading-snug text-[var(--erp-muted)] lg:text-[15px]">
        Всё, что настраивается для этой компании: реквизиты и касса, витрина магазина,
        сотрудники и состояние системы.
      </p>

      <div className="mt-5 lg:mt-7 lg:grid lg:grid-cols-[228px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <SettingsNav sections={sections} activeId={active.id} onSelect={setActiveId} />

        {/* Panels are hidden, not unmounted. Remounting on every tab change
            threw away a half-filled storefront form or a new user's password —
            silently, with a stray click on another tab. */}
        <div className="mt-5 lg:mt-0">
          {sections.map((section) => (
            <div
              key={section.id}
              id={panelDomId(section.id)}
              role="tabpanel"
              aria-labelledby={tabDomId(section.id)}
              tabIndex={0}
              hidden={section.id !== active.id}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
            >
              <h2 className="text-[19px] font-extrabold tracking-tight text-[var(--erp-text)]">
                {section.label}
              </h2>
              <p className="mb-4 mt-1 max-w-[68ch] text-[13px] leading-snug text-[var(--erp-muted)]">
                {section.summary}
              </p>

              {section.id === COMPANY.id && <CompanyProfileSection />}
              {section.id === MARKETPLACE.id && <MarketplaceSettingsSection />}
              {section.id === TEAM.id && <CompanyAdminSection />}
              {section.id === RECONCILIATION.id && <ReconciliationSection />}
              {section.id === AI.id && <AiConnectorSection />}
              {section.id === SYSTEM.id && <SystemStatusSection />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
