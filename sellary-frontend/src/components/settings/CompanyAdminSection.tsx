'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { adminApi } from '@/lib/api';
import type { ModuleKey, ModuleLevel, ModuleMap } from '@/lib/modules';
import { useAuthStore } from '@/lib/store';
import type { ManagedUser, ManagedUserMembershipSummary, UserRole } from '@/lib/types';

import {
  FormField,
  ROLE_LABELS,
  SettingsCard,
  StatusBadge,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
} from './SettingsUI';

const roleOptions: UserRole[] = ['admin', 'manager', 'cashier'];

const LEVEL_LABELS: Record<'' | 'user' | 'manager', string> = {
  '': 'Нет',
  user: 'Сотрудник',
  manager: 'Менеджер',
};

const MODULE_ROWS: { key: ModuleKey; label: string }[] = [
  { key: 'register', label: 'Касса' },
  { key: 'sales', label: 'Продажи' },
  { key: 'customers', label: 'Клиенты' },
  { key: 'inventory', label: 'Склад' },
  { key: 'purchasing', label: 'Закупки' },
  { key: 'shop', label: 'Магазин' },
  { key: 'reports', label: 'Отчеты' },
];

type ModuleDraft = Record<ModuleKey, '' | ModuleLevel>;

function toDraft(modules: ModuleMap): ModuleDraft {
  return {
    register: modules.register ?? '',
    sales: modules.sales ?? '',
    customers: modules.customers ?? '',
    inventory: modules.inventory ?? '',
    purchasing: modules.purchasing ?? '',
    shop: modules.shop ?? '',
    reports: modules.reports ?? '',
  };
}

/** A checkbox that reads as a row and takes a finger, not a pixel. */
function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="inline-flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 border border-[var(--erp-divider)] bg-white px-3 text-sm text-[var(--erp-text)] hover:border-[var(--erp-text)]"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-[18px] w-[18px] shrink-0 accent-[var(--erp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
      />
      {label}
    </label>
  );
}

function MembershipModulesEditor({
  membershipId,
  onDirtyChange,
}: {
  membershipId: number;
  /** Lets the parent refuse to collapse an editor holding unsaved grants. */
  onDirtyChange?: (membershipId: number, dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ModuleDraft>(() => toDraft({}));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['membership-modules', membershipId],
    queryFn: async () => {
      const response = await adminApi.getMembershipModules(membershipId);
      return response.data;
    },
  });

  useEffect(() => {
    if (data) setDraft(toDraft(data.modules));
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const saved = toDraft(data.modules);
    const dirty = MODULE_ROWS.some(({ key }) => draft[key] !== saved[key]);
    onDirtyChange?.(membershipId, dirty);
  }, [data, draft, membershipId, onDirtyChange]);

  const saveMutation = useMutation({
    mutationFn: (modules: ModuleMap) => adminApi.updateMembershipModules(membershipId, modules),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership-modules', membershipId] });
      toast.success('Доступ к модулям обновлён.');
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось сохранить доступ к модулям.',
      );
    },
  });

  const handleSave = () => {
    const modules: ModuleMap = {};
    MODULE_ROWS.forEach(({ key }) => {
      const level = draft[key];
      if (level) modules[key] = level;
    });
    saveMutation.mutate(modules);
  };

  if (isLoading) {
    return <p className="text-sm text-[var(--erp-muted)]">Загрузка доступа к модулям…</p>;
  }

  if (isError || !data) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-red-700">
          Не удалось загрузить доступы. Повторите попытку.
        </p>
        <button type="button" onClick={() => refetch()} className={secondaryButtonClass}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Уровень доступа к каждому модулю</caption>
          <thead>
            <tr className="border-b border-[var(--erp-divider)]">
              <th scope="col" className="py-2 pr-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--erp-muted)]">
                Модуль
              </th>
              {(['', 'user', 'manager'] as const).map((level) => (
                <th
                  key={level || 'none'}
                  scope="col"
                  className="py-2 pr-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--erp-muted)]"
                >
                  {LEVEL_LABELS[level]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_ROWS.map(({ key, label }) => (
              <tr key={key} className="border-b border-[var(--erp-divider)] last:border-b-0">
                <th scope="row" className="py-2 pr-4 text-left text-sm font-normal text-[var(--erp-text)]">
                  {label}
                </th>
                {(['', 'user', 'manager'] as const).map((level) => (
                  <td key={level || 'none'} className="pr-4">
                    {/* The label carries no text — it exists to grow a 20px
                        radio into a 44px target. Column meaning lives in a
                        <th> a radio can't reference, so each control names
                        itself: "Склад: Менеджер". */}
                    <label className="flex min-h-[44px] w-full min-w-[44px] cursor-pointer items-center justify-center">
                      <input
                        type="radio"
                        name={`module-${membershipId}-${key}`}
                        aria-label={`${label}: ${LEVEL_LABELS[level]}`}
                        checked={draft[key] === level}
                        onChange={() => setDraft((current) => ({ ...current, [key]: level }))}
                        className="h-5 w-5 accent-[var(--erp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saveMutation.isPending}
        className={primaryButtonClass}
      >
        {saveMutation.isPending ? 'Сохранение…' : 'Сохранить доступ'}
      </button>
    </div>
  );
}

const emptyUserForm = {
  username: '',
  email: '',
  full_name: '',
  password: '',
  role: 'cashier' as UserRole,
  is_active: true,
  is_default: true,
};

const emptyMembershipForm = {
  identifier: '',
  role: 'cashier' as UserRole,
  is_active: true,
  is_default: false,
};

export default function CompanyAdminSection() {
  const { currentCompany, user } = useAuthStore();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [membershipForm, setMembershipForm] = useState(emptyMembershipForm);
  const [editingMembership, setEditingMembership] = useState<ManagedUserMembershipSummary | null>(null);
  // Deactivating a member locks them out of the company, so it takes a
  // second, explicit press rather than riding along with a role edit.
  const [confirmDeactivation, setConfirmDeactivation] = useState(false);
  const [expandedModuleIds, setExpandedModuleIds] = useState<Set<number>>(new Set());
  // Without this a double-press fired two POSTs; the second came back a
  // duplicate-key error, so the admin saw a red toast for an operation that
  // had in fact succeeded.
  const [busy, setBusy] = useState(false);

  const isCompanyAdmin = currentCompany?.role === 'admin';

  const loadUsers = useCallback(async () => {
    if (!isCompanyAdmin) {
      return;
    }

    setLoading(true);
    try {
      const response = await adminApi.getUsers();
      setUsers(response.data);
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось загрузить пользователей компании.',
      );
    } finally {
      setLoading(false);
    }
  }, [isCompanyAdmin]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers, currentCompany?.id]);

  const visibleUsers = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((candidate) =>
      [candidate.full_name, candidate.username, candidate.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [filter, users]);

  // Collapsing the editor unmounts it, and the draft lives inside. Without
  // this an admin who set five radios and pressed "Скрыть модули" lost all of
  // them, with no warning and no visible difference from a saved state.
  const [dirtyModuleIds, setDirtyModuleIds] = useState<Set<number>>(new Set());

  // Stable identity, and it returns the same Set when nothing changed —
  // without both, the child's effect re-ran on every parent render and the
  // page span until React aborted with "Maximum update depth exceeded".
  const markModulesDirty = useCallback((membershipId: number, dirty: boolean) => {
    setDirtyModuleIds((current) => {
      if (current.has(membershipId) === dirty) {
        return current;
      }
      const next = new Set(current);
      if (dirty) next.add(membershipId);
      else next.delete(membershipId);
      return next;
    });
  }, []);

  if (!isCompanyAdmin) {
    return (
      <SettingsCard title="Сотрудники и доступ">
        <p className="text-sm text-[var(--erp-muted)]">
          Управлять сотрудниками может только администратор компании.
        </p>
      </SettingsCard>
    );
  }

  const toggleModules = (membershipId: number) => {
    setExpandedModuleIds((current) => {
      const next = new Set(current);
      if (next.has(membershipId)) {
        if (dirtyModuleIds.has(membershipId)) {
          toast.error('Есть несохранённые изменения доступа. Сохраните или обновите страницу.');
          return current;
        }
        next.delete(membershipId);
      } else {
        next.add(membershipId);
      }
      return next;
    });
  };

  const startEditing = (membership: ManagedUserMembershipSummary) => {
    setConfirmDeactivation(false);
    setEditingMembership(membership);
  };

  const cancelEditing = () => {
    setConfirmDeactivation(false);
    setEditingMembership(null);
  };

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.createUser(userForm);
      setUserForm(emptyUserForm);
      toast.success('Пользователь создан для этой компании.');
      await loadUsers();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Не удалось создать пользователя.');
    } finally {
      setBusy(false);
    }
  };

  const handleAttachUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.createMembership(membershipForm);
      setMembershipForm(emptyMembershipForm);
      toast.success('Существующий пользователь привязан к этой компании.');
      await loadUsers();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Не удалось привязать пользователя.');
    } finally {
      setBusy(false);
    }
  };

  const saveMembership = async (draft: ManagedUserMembershipSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.updateMembership(draft.id, {
        role: draft.role,
        is_default: draft.is_default,
        is_active: draft.is_active,
      });
      cancelEditing();
      toast.success('Участие обновлено.');
      await loadUsers();
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось обновить участие.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMembership = (
    event: React.FormEvent<HTMLFormElement>,
    original: ManagedUserMembershipSummary,
  ) => {
    event.preventDefault();
    if (!editingMembership) {
      return;
    }

    if (original.is_active && !editingMembership.is_active && !confirmDeactivation) {
      setConfirmDeactivation(true);
      return;
    }

    void saveMembership(editingMembership);
  };

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Сотрудники компании"
        description="Кто может входить в это рабочее пространство и на каком уровне."
        actions={
          <StatusBadge tone="idle">
            {loading ? 'Загрузка' : `Всего: ${users.length}`}
          </StatusBadge>
        }
      >
        {loading ? (
          <p className="text-sm text-[var(--erp-muted)]">Загрузка пользователей компании…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-[var(--erp-muted)]">
            К этой компании пока не привязан ни один пользователь.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="max-w-[22rem]">
              <label htmlFor="member-filter" className="sr-only">
                Поиск сотрудника
              </label>
              <input
                id="member-filter"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Поиск по имени или email"
                className={inputClass}
              />
            </div>

            {visibleUsers.length === 0 ? (
              <p className="text-sm text-[var(--erp-muted)]">
                Никто не найден по запросу «{filter}».
              </p>
            ) : (
              <ul className="space-y-2">
                {visibleUsers.map((member) => {
                  const membership = member.memberships[0];
                  const isEditing = Boolean(membership) && editingMembership?.id === membership.id;
                  const isSelf = user?.id === member.id;
                  const modulesOpen = Boolean(membership) && expandedModuleIds.has(membership.id);

                  return (
                    <li
                      key={member.id}
                      className="border border-[var(--erp-divider)] bg-white p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p className="text-[15px] font-extrabold tracking-tight text-[var(--erp-text)]">
                            {member.full_name || member.username}
                          </p>
                          <p className="mt-0.5 break-words text-[12px] text-[var(--erp-muted)]">
                            {member.email} · @{member.username}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isSelf ? <StatusBadge tone="idle">Это вы</StatusBadge> : null}
                          {membership?.is_default ? (
                            <StatusBadge tone="idle">По умолчанию</StatusBadge>
                          ) : null}
                          {membership ? (
                            membership.is_active ? (
                              <StatusBadge tone="ok">Активен</StatusBadge>
                            ) : (
                              <StatusBadge tone="danger">Неактивен</StatusBadge>
                            )
                          ) : (
                            <StatusBadge tone="idle">Нет участия</StatusBadge>
                          )}
                        </div>
                      </div>

                      {!membership ? null : isEditing && editingMembership ? (
                        <form
                          onSubmit={(event) => handleUpdateMembership(event, membership)}
                          className="mt-3 border-t border-[var(--erp-divider)] pt-3"
                        >
                          <div className="grid gap-3 sm:grid-cols-3">
                            <FormField id={`role-${membership.id}`} label="Роль">
                              <select
                                id={`role-${membership.id}`}
                                value={editingMembership.role}
                                onChange={(event) =>
                                  setEditingMembership((current) =>
                                    current
                                      ? { ...current, role: event.target.value as UserRole }
                                      : current,
                                  )
                                }
                                className={selectClass}
                              >
                                {roleOptions.map((role) => (
                                  <option key={role} value={role}>
                                    {ROLE_LABELS[role] ?? role}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                            <div className="flex items-end">
                              <CheckboxField
                                id={`default-${membership.id}`}
                                label="Компания по умолчанию"
                                checked={editingMembership.is_default}
                                onChange={(next) =>
                                  setEditingMembership((current) =>
                                    current ? { ...current, is_default: next } : current,
                                  )
                                }
                              />
                            </div>
                            <div className="flex items-end">
                              <CheckboxField
                                id={`active-${membership.id}`}
                                label="Доступ разрешён"
                                checked={editingMembership.is_active}
                                onChange={(next) => {
                                  setConfirmDeactivation(false);
                                  setEditingMembership((current) =>
                                    current ? { ...current, is_active: next } : current,
                                  );
                                }}
                              />
                            </div>
                          </div>

                          {confirmDeactivation ? (
                            <div
                              role="alert"
                              className="mt-3 border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-3"
                            >
                              <p className="text-[13px] font-semibold text-[var(--erp-text)]">
                                Отключить доступ для «{member.full_name || member.username}»?
                              </p>
                              <p className="mt-1 text-[12px] leading-snug text-[var(--erp-muted)]">
                                {isSelf
                                  ? 'Это ваша учётная запись — вы потеряете доступ к этой компании.'
                                  : 'Сотрудник не сможет войти в эту компанию, пока доступ не вернут.'}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button type="submit" disabled={busy} className={dangerButtonClass}>
                                  Отключить доступ
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeactivation(false)}
                                  className={secondaryButtonClass}
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button type="submit" disabled={busy} className={primaryButtonClass}>
                                Сохранить участие
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditing}
                                className={secondaryButtonClass}
                              >
                                Отмена
                              </button>
                            </div>
                          )}
                        </form>
                      ) : (
                        <>
                          <p className="mt-2 text-[13px] text-[var(--erp-muted)]">
                            Роль:{' '}
                            <span className="font-semibold text-[var(--erp-text)]">
                              {ROLE_LABELS[membership.role] ?? membership.role}
                            </span>
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEditing(membership)}
                              className={secondaryButtonClass}
                            >
                              Изменить участие
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleModules(membership.id)}
                              aria-expanded={modulesOpen}
                              aria-controls={`modules-${membership.id}`}
                              className={secondaryButtonClass}
                            >
                              {modulesOpen ? 'Скрыть модули' : 'Доступ к модулям'}
                            </button>
                          </div>
                        </>
                      )}

                      {membership && modulesOpen ? (
                        <div
                          id={`modules-${membership.id}`}
                          className="mt-3 border border-[var(--erp-divider)] bg-[var(--erp-surface)] p-4"
                        >
                          <h4 className="mb-3 text-[13px] font-extrabold text-[var(--erp-text)]">
                            Доступ к модулям
                          </h4>
                          {membership.role === 'admin' ? (
                            <p className="text-sm text-[var(--erp-text)]">
                              Полный доступ ко всем модулям (администратор).
                            </p>
                          ) : (
                            <MembershipModulesEditor
                              membershipId={membership.id}
                              onDirtyChange={markModulesDirty}
                            />
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Добавить сотрудника"
        description="Создайте нового пользователя для этой компании или привяжите существующего по имени пользователя либо email."
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <form
            onSubmit={handleCreateUser}
            className="space-y-3 border border-[var(--erp-divider)] p-4"
          >
            <h4 className="text-[13px] font-extrabold text-[var(--erp-text)]">
              Новый пользователь
            </h4>
            {/* Labels, not placeholders: a placeholder disappears on the first
                keystroke and screen readers announce these fields as blank. */}
            <FormField id="new-user-username" label="Имя пользователя">
              <input
                id="new-user-username"
                value={userForm.username}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, username: event.target.value }))
                }
                autoComplete="off"
                autoCapitalize="none"
                required
                className={inputClass}
              />
            </FormField>
            <FormField id="new-user-email" label="Email">
              <input
                id="new-user-email"
                type="email"
                value={userForm.email}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, email: event.target.value }))
                }
                autoComplete="off"
                required
                className={inputClass}
              />
            </FormField>
            <FormField id="new-user-fullname" label="Полное имя">
              <input
                id="new-user-fullname"
                value={userForm.full_name}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, full_name: event.target.value }))
                }
                className={inputClass}
              />
            </FormField>
            <FormField
              id="new-user-password"
              label="Пароль"
              hint="Сотрудник войдёт с этим паролем — передайте его лично."
            >
              <input
                id="new-user-password"
                type="password"
                value={userForm.password}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, password: event.target.value }))
                }
                // new-password, or the browser offers to fill the admin's own.
                autoComplete="new-password"
                aria-describedby="new-user-password-hint"
                required
                className={inputClass}
              />
            </FormField>
            <FormField id="new-user-role" label="Роль">
              <select
                id="new-user-role"
                value={userForm.role}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, role: event.target.value as UserRole }))
                }
                className={selectClass}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role] ?? role}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid gap-2 sm:grid-cols-2">
              <CheckboxField
                id="new-user-active"
                label="Доступ разрешён"
                checked={userForm.is_active}
                onChange={(next) => setUserForm((current) => ({ ...current, is_active: next }))}
              />
              <CheckboxField
                id="new-user-default"
                label="Компания по умолчанию"
                checked={userForm.is_default}
                onChange={(next) => setUserForm((current) => ({ ...current, is_default: next }))}
              />
            </div>
            <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full sm:w-auto`}>
              {busy ? 'Сохранение…' : 'Создать пользователя компании'}
            </button>
          </form>

          <form
            onSubmit={handleAttachUser}
            className="space-y-3 border border-[var(--erp-divider)] p-4"
          >
            <h4 className="text-[13px] font-extrabold text-[var(--erp-text)]">
              Существующий пользователь
            </h4>
            <FormField
              id="attach-identifier"
              label="Имя пользователя или email"
              hint="Учётная запись уже есть в Sellary — вы даёте ей доступ к этой компании."
            >
              <input
                id="attach-identifier"
                value={membershipForm.identifier}
                onChange={(event) =>
                  setMembershipForm((current) => ({ ...current, identifier: event.target.value }))
                }
                aria-describedby="attach-identifier-hint"
                required
                className={inputClass}
              />
            </FormField>
            <FormField id="attach-role" label="Роль">
              <select
                id="attach-role"
                value={membershipForm.role}
                onChange={(event) =>
                  setMembershipForm((current) => ({
                    ...current,
                    role: event.target.value as UserRole,
                  }))
                }
                className={selectClass}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role] ?? role}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid gap-2 sm:grid-cols-2">
              <CheckboxField
                id="attach-active"
                label="Доступ разрешён"
                checked={membershipForm.is_active}
                onChange={(next) =>
                  setMembershipForm((current) => ({ ...current, is_active: next }))
                }
              />
              <CheckboxField
                id="attach-default"
                label="Компания по умолчанию"
                checked={membershipForm.is_default}
                onChange={(next) =>
                  setMembershipForm((current) => ({ ...current, is_default: next }))
                }
              />
            </div>
            <button type="submit" disabled={busy} className={`${secondaryButtonClass} w-full sm:w-auto`}>
              Привязать существующего пользователя
            </button>
          </form>
        </div>
      </SettingsCard>
    </div>
  );
}
