'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { adminApi } from '@/lib/api';
import type { ModuleKey, ModuleLevel, ModuleMap } from '@/lib/modules';
import { useAuthStore } from '@/lib/store';
import type { ManagedUser, ManagedUserMembershipSummary, UserRole } from '@/lib/types';

const roleOptions: UserRole[] = ['admin', 'manager', 'cashier'];

const MODULE_ROWS: { key: ModuleKey; label: string }[] = [
  { key: 'pos', label: 'Касса' },
  { key: 'inventory', label: 'Склад' },
  { key: 'purchasing', label: 'Закупки' },
  { key: 'shop', label: 'Магазин' },
  { key: 'reports', label: 'Отчеты' },
];

type ModuleDraft = Record<ModuleKey, '' | ModuleLevel>;

function toDraft(modules: ModuleMap): ModuleDraft {
  return {
    pos: modules.pos ?? '',
    inventory: modules.inventory ?? '',
    purchasing: modules.purchasing ?? '',
    shop: modules.shop ?? '',
    reports: modules.reports ?? '',
  };
}

function MembershipModulesEditor({ membershipId }: { membershipId: number }) {
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
    return <p className="text-sm text-slate-500">Загрузка доступа к модулям...</p>;
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-red-600">Не удалось загрузить доступы. Повторите попытку.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
        >
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <table className="min-w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-4 font-medium">Модуль</th>
            <th className="py-1 pr-4 font-medium">Нет</th>
            <th className="py-1 pr-4 font-medium">Сотрудник</th>
            <th className="py-1 pr-4 font-medium">Менеджер</th>
          </tr>
        </thead>
        <tbody>
          {MODULE_ROWS.map(({ key, label }) => (
            <tr key={key} className="border-t border-slate-100">
              <td className="py-2 pr-4">{label}</td>
              {(['', 'user', 'manager'] as const).map((level) => (
                <td key={level || 'none'} className="py-2 pr-4">
                  <input
                    type="radio"
                    name={`module-${membershipId}-${key}`}
                    checked={draft[key] === level}
                    onChange={() => setDraft((current) => ({ ...current, [key]: level }))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={handleSave}
        disabled={saveMutation.isPending}
        className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {saveMutation.isPending ? 'Сохранение...' : 'Сохранить'}
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
  const { currentCompany } = useAuthStore();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [membershipForm, setMembershipForm] = useState(emptyMembershipForm);
  const [editingMembership, setEditingMembership] = useState<ManagedUserMembershipSummary | null>(null);
  const [expandedModuleIds, setExpandedModuleIds] = useState<Set<number>>(new Set());

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

  if (!isCompanyAdmin) {
    return null;
  }

  const toggleModules = (membershipId: number) => {
    setExpandedModuleIds((current) => {
      const next = new Set(current);
      if (next.has(membershipId)) {
        next.delete(membershipId);
      } else {
        next.add(membershipId);
      }
      return next;
    });
  };

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await adminApi.createUser(userForm);
      setUserForm(emptyUserForm);
      toast.success('Пользователь создан для этой компании.');
      await loadUsers();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Не удалось создать пользователя.');
    }
  };

  const handleAttachUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await adminApi.createMembership(membershipForm);
      setMembershipForm(emptyMembershipForm);
      toast.success('Существующий пользователь привязан к этой компании.');
      await loadUsers();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Не удалось привязать пользователя.');
    }
  };

  const handleUpdateMembership = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingMembership) {
      return;
    }

    try {
      await adminApi.updateMembership(editingMembership.id, {
        role: editingMembership.role,
        is_default: editingMembership.is_default,
        is_active: editingMembership.is_active,
      });
      setEditingMembership(null);
      toast.success('Участие обновлено.');
      await loadUsers();
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось обновить участие.',
      );
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600">
          Администратор компании
        </p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">Управление доступом команды</h2>
        <p className="mt-1 text-sm text-slate-500">
          Создавайте пользователей для этой компании или привязывайте существующего пользователя по имени пользователя или email.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handleCreateUser} className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Создать пользователя</h3>
          <input
            value={userForm.username}
            onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))}
            placeholder="Имя пользователя"
            required
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
          />
          <input
            type="email"
            value={userForm.email}
            onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="Email"
            required
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
          />
          <input
            value={userForm.full_name}
            onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))}
            placeholder="Полное имя"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
          />
          <input
            type="password"
            value={userForm.password}
            onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="Пароль"
            required
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
          />
          <div className="grid grid-cols-3 gap-3">
            <select
              value={userForm.role}
              onChange={(event) =>
                setUserForm((current) => ({ ...current, role: event.target.value as UserRole }))
              }
              className="h-11 rounded-xl border border-slate-200 px-3 text-sm"
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={userForm.is_active}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, is_active: event.target.checked }))
                }
              />
              Активен
            </label>
            <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={userForm.is_default}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, is_default: event.target.checked }))
                }
              />
              По умолчанию
            </label>
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Создать пользователя компании
          </button>
        </form>

        <form onSubmit={handleAttachUser} className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Привязать существующего пользователя</h3>
          <input
            value={membershipForm.identifier}
            onChange={(event) =>
              setMembershipForm((current) => ({ ...current, identifier: event.target.value }))
            }
            placeholder="Имя пользователя или email"
            required
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
          />
          <div className="grid grid-cols-3 gap-3">
            <select
              value={membershipForm.role}
              onChange={(event) =>
                setMembershipForm((current) => ({
                  ...current,
                  role: event.target.value as UserRole,
                }))
              }
              className="h-11 rounded-xl border border-slate-200 px-3 text-sm"
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={membershipForm.is_active}
                onChange={(event) =>
                  setMembershipForm((current) => ({ ...current, is_active: event.target.checked }))
                }
              />
              Активен
            </label>
            <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={membershipForm.is_default}
                onChange={(event) =>
                  setMembershipForm((current) => ({ ...current, is_default: event.target.checked }))
                }
              />
              По умолчанию
            </label>
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Привязать существующего пользователя
          </button>
        </form>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Пользователь</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Роль</th>
              <th className="px-3 py-2 font-medium">По умолчанию</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-slate-500">
                  Загрузка пользователей компании...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-slate-500">
                  К этой компании пока не привязан ни один пользователь.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const membership = user.memberships[0];
                const isEditing = editingMembership?.id === membership?.id;

                return (
                  <Fragment key={user.id}>
                    <tr className="border-t border-slate-100">
                    <td className="px-3 py-3">{user.full_name || user.username}</td>
                    <td className="px-3 py-3">{user.email}</td>
                    <td className="px-3 py-3">
                      {membership ? (
                        isEditing ? (
                          <select
                            value={editingMembership.role}
                            onChange={(event) =>
                              setEditingMembership((current) =>
                                current ? { ...current, role: event.target.value as UserRole } : current,
                              )
                            }
                            className="h-10 rounded-lg border border-slate-200 px-3"
                          >
                            {roleOptions.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        ) : (
                          membership.role
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {membership ? (
                        isEditing ? (
                          <input
                            type="checkbox"
                            checked={editingMembership.is_default}
                            onChange={(event) =>
                              setEditingMembership((current) =>
                                current ? { ...current, is_default: event.target.checked } : current,
                              )
                            }
                          />
                        ) : membership.is_default ? (
                          'Да'
                        ) : (
                          'Нет'
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {membership ? (
                        isEditing ? (
                          <input
                            type="checkbox"
                            checked={editingMembership.is_active}
                            onChange={(event) =>
                              setEditingMembership((current) =>
                                current ? { ...current, is_active: event.target.checked } : current,
                              )
                            }
                          />
                        ) : membership.is_active ? (
                          'Активен'
                        ) : (
                          'Неактивен'
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {membership ? (
                        isEditing ? (
                          <form onSubmit={handleUpdateMembership} className="flex gap-2">
                            <button
                              type="submit"
                              className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                            >
                              Сохранить
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingMembership(null)}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              Отмена
                            </button>
                          </form>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingMembership(membership)}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              Изменить участие
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleModules(membership.id)}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              {expandedModuleIds.has(membership.id)
                                ? 'Скрыть модули'
                                : 'Доступ к модулям'}
                            </button>
                          </div>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                  {membership && expandedModuleIds.has(membership.id) && (
                    <tr className="border-t border-slate-100 bg-slate-50">
                      <td colSpan={6} className="px-3 py-4">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                          Доступ к модулям
                        </p>
                        {membership.role === 'admin' ? (
                          <p className="text-sm text-slate-700">Полный доступ (администратор)</p>
                        ) : (
                          <MembershipModulesEditor membershipId={membership.id} />
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
