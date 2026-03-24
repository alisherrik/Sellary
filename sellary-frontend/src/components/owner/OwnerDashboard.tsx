'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowRightStartOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  BuildingOffice2Icon,
  ShieldCheckIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

import { ownerApi } from '@/lib/api';
import { useOwnerStore } from '@/lib/owner-store';
import { useAuthStore } from '@/lib/store';
import type { ManagedCompany, ManagedMembership, ManagedUser, UserRole } from '@/lib/types';

const roleOptions: UserRole[] = ['admin', 'manager', 'cashier'];

const emptyUserForm = {
  username: '',
  email: '',
  full_name: '',
  password: '',
  is_active: true,
};

const emptyCompanyForm = {
  name: '',
  slug: '',
  is_active: true,
};

const emptyMembershipForm = {
  user_id: '',
  company_id: '',
  role: 'cashier' as UserRole,
  is_default: false,
  is_active: true,
};

export default function OwnerDashboard() {
  const router = useRouter();
  const { user, logout } = useOwnerStore();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [companies, setCompanies] = useState<ManagedCompany[]>([]);
  const [memberships, setMemberships] = useState<ManagedMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const [userForm, setUserForm] = useState(emptyUserForm);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [membershipForm, setMembershipForm] = useState(emptyMembershipForm);

  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editingCompany, setEditingCompany] = useState<ManagedCompany | null>(null);
  const [editingMembership, setEditingMembership] = useState<ManagedMembership | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [usersResponse, companiesResponse, membershipsResponse] = await Promise.all([
        ownerApi.getUsers(),
        ownerApi.getCompanies(),
        ownerApi.getMemberships(),
      ]);
      setUsers(usersResponse.data);
      setCompanies(companiesResponse.data);
      setMemberships(membershipsResponse.data);
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Could not load owner data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await ownerApi.createUser(userForm);
      setUserForm(emptyUserForm);
      toast.success('User created.');
      await loadAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Could not create user.');
    }
  };

  const handleUpdateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingUser) return;

    try {
      await ownerApi.updateUser(editingUser.id, {
        username: editingUser.username,
        email: editingUser.email,
        full_name: editingUser.full_name || '',
        is_active: editingUser.is_active,
      });
      setEditingUser(null);
      toast.success('User updated.');
      await loadAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Could not update user.');
    }
  };

  const handleCreateCompany = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await ownerApi.createCompany(companyForm);
      setCompanyForm(emptyCompanyForm);
      toast.success('Company created.');
      await loadAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Could not create company.');
    }
  };

  const handleUpdateCompany = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCompany) return;

    try {
      await ownerApi.updateCompany(editingCompany.id, {
        name: editingCompany.name,
        slug: editingCompany.slug,
        is_active: editingCompany.is_active,
      });
      setEditingCompany(null);
      toast.success('Company updated.');
      await loadAll();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Could not update company.');
    }
  };

  const handleCreateMembership = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!membershipForm.user_id || !membershipForm.company_id) {
      toast.error('Choose both a user and a company.');
      return;
    }

    try {
      await ownerApi.createMembership({
        user_id: Number(membershipForm.user_id),
        company_id: Number(membershipForm.company_id),
        role: membershipForm.role,
        is_default: membershipForm.is_default,
        is_active: membershipForm.is_active,
      });
      setMembershipForm(emptyMembershipForm);
      toast.success('Membership created.');
      await loadAll();
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Could not create membership.',
      );
    }
  };

  const handleUpdateMembership = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingMembership) return;

    try {
      await ownerApi.updateMembership(editingMembership.id, {
        role: editingMembership.role,
        is_default: editingMembership.is_default,
        is_active: editingMembership.is_active,
      });
      setEditingMembership(null);
      toast.success('Membership updated.');
      await loadAll();
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Could not update membership.',
      );
    }
  };

  const handleEnterCompany = async (companyId: number) => {
    try {
      const response = await ownerApi.enterCompany(companyId);
      useAuthStore.getState().acceptCompanySession(response.data);
      toast.success('Company session opened.');
      router.push('/pos');
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Could not enter company.');
    }
  };

  const handleLogout = () => {
    logout();
    router.replace('/owner/login');
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
              Owner Panel
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">Sellary Control Center</h1>
            <p className="mt-1 text-sm text-slate-500">
              Signed in as {user?.full_name || user?.username || 'Owner'}
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowRightStartOnRectangleIcon className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <section className="grid gap-4 md:grid-cols-3">
          <SummaryCard title="Users" value={String(users.length)} description="Directory accounts" icon={UserGroupIcon} />
          <SummaryCard title="Companies" value={String(companies.length)} description="Tenant workspaces" icon={BuildingOffice2Icon} />
          <SummaryCard title="Memberships" value={String(memberships.length)} description="Company access assignments" icon={ShieldCheckIcon} />
        </section>

        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading owner data...
          </section>
        ) : (
          <>
            <UsersSection
              form={userForm}
              users={users}
              editingUser={editingUser}
              onFormChange={setUserForm}
              onCreate={handleCreateUser}
              onEditChange={setEditingUser}
              onSave={handleUpdateUser}
            />
            <CompaniesSection
              form={companyForm}
              companies={companies}
              editingCompany={editingCompany}
              onFormChange={setCompanyForm}
              onCreate={handleCreateCompany}
              onEditChange={setEditingCompany}
              onSave={handleUpdateCompany}
              onEnterCompany={handleEnterCompany}
            />
            <MembershipsSection
              form={membershipForm}
              users={users}
              companies={companies}
              memberships={memberships}
              editingMembership={editingMembership}
              onFormChange={setMembershipForm}
              onCreate={handleCreateMembership}
              onEditChange={setEditingMembership}
              onSave={handleUpdateMembership}
            />
          </>
        )}
      </main>
    </div>
  );
}

function UsersSection({
  form,
  users,
  editingUser,
  onFormChange,
  onCreate,
  onEditChange,
  onSave,
}: {
  form: typeof emptyUserForm;
  users: ManagedUser[];
  editingUser: ManagedUser | null;
  onFormChange: React.Dispatch<React.SetStateAction<typeof emptyUserForm>>;
  onCreate: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onEditChange: React.Dispatch<React.SetStateAction<ManagedUser | null>>;
  onSave: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <SectionCard title="Users" description="Create standard users and update their core profile state.">
      <form onSubmit={onCreate} className="grid gap-3 border-b border-slate-200 pb-5 md:grid-cols-5">
        <TextInput value={form.username} onChange={(value) => onFormChange((current) => ({ ...current, username: value }))} placeholder="Username" required />
        <TextInput value={form.email} onChange={(value) => onFormChange((current) => ({ ...current, email: value }))} placeholder="Email" required type="email" />
        <TextInput value={form.full_name} onChange={(value) => onFormChange((current) => ({ ...current, full_name: value }))} placeholder="Full name" />
        <TextInput value={form.password} onChange={(value) => onFormChange((current) => ({ ...current, password: value }))} placeholder="Password" required type="password" />
        <PrimaryButton label="Create user" />
      </form>

      <div className="overflow-x-auto pt-5">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Username</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Full name</th>
              <th className="px-3 py-2 font-medium">Global role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Memberships</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((managedUser) => {
              const isEditing = editingUser?.id === managedUser.id;
              return (
                <tr key={managedUser.id} className="border-t border-slate-100">
                  <td className="px-3 py-3">{isEditing ? <InlineInput value={editingUser.username} onChange={(value) => onEditChange((current) => current ? { ...current, username: value } : current)} /> : managedUser.username}</td>
                  <td className="px-3 py-3">{isEditing ? <InlineInput value={editingUser.email} onChange={(value) => onEditChange((current) => current ? { ...current, email: value } : current)} type="email" /> : managedUser.email}</td>
                  <td className="px-3 py-3">{isEditing ? <InlineInput value={editingUser.full_name || ''} onChange={(value) => onEditChange((current) => current ? { ...current, full_name: value } : current)} /> : managedUser.full_name || '—'}</td>
                  <td className="px-3 py-3">{managedUser.global_role}</td>
                  <td className="px-3 py-3">
                    {isEditing ? <Checkbox checked={editingUser.is_active} onChange={(checked) => onEditChange((current) => current ? { ...current, is_active: checked } : current)} label="Active" /> : managedUser.is_active ? 'Active' : 'Disabled'}
                  </td>
                  <td className="px-3 py-3">{managedUser.memberships.length}</td>
                  <td className="px-3 py-3">
                    {isEditing ? (
                      <form onSubmit={onSave} className="flex gap-2">
                        <ActionButton label="Save" tone="primary" />
                        <ActionButton label="Cancel" tone="secondary" type="button" onClick={() => onEditChange(null)} />
                      </form>
                    ) : (
                      <ActionButton label="Edit" tone="secondary" type="button" onClick={() => onEditChange(managedUser)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function CompaniesSection({
  form,
  companies,
  editingCompany,
  onFormChange,
  onCreate,
  onEditChange,
  onSave,
  onEnterCompany,
}: {
  form: typeof emptyCompanyForm;
  companies: ManagedCompany[];
  editingCompany: ManagedCompany | null;
  onFormChange: React.Dispatch<React.SetStateAction<typeof emptyCompanyForm>>;
  onCreate: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onEditChange: React.Dispatch<React.SetStateAction<ManagedCompany | null>>;
  onSave: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onEnterCompany: (companyId: number) => Promise<void>;
}) {
  return (
    <SectionCard title="Companies" description="Create companies, adjust slugs, deactivate tenants, and open a live company session.">
      <form onSubmit={onCreate} className="grid gap-3 border-b border-slate-200 pb-5 md:grid-cols-4">
        <TextInput value={form.name} onChange={(value) => onFormChange((current) => ({ ...current, name: value }))} placeholder="Company name" required />
        <TextInput value={form.slug} onChange={(value) => onFormChange((current) => ({ ...current, slug: value }))} placeholder="Slug (optional)" />
        <Checkbox checked={form.is_active} onChange={(checked) => onFormChange((current) => ({ ...current, is_active: checked }))} label="Active" />
        <PrimaryButton label="Create company" />
      </form>

      <div className="overflow-x-auto pt-5">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Slug</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => {
              const isEditing = editingCompany?.id === company.id;
              return (
                <tr key={company.id} className="border-t border-slate-100">
                  <td className="px-3 py-3">{isEditing ? <InlineInput value={editingCompany.name} onChange={(value) => onEditChange((current) => current ? { ...current, name: value } : current)} /> : company.name}</td>
                  <td className="px-3 py-3">{isEditing ? <InlineInput value={editingCompany.slug} onChange={(value) => onEditChange((current) => current ? { ...current, slug: value } : current)} /> : company.slug}</td>
                  <td className="px-3 py-3">{isEditing ? <Checkbox checked={editingCompany.is_active} onChange={(checked) => onEditChange((current) => current ? { ...current, is_active: checked } : current)} label="Active" /> : company.is_active ? 'Active' : 'Disabled'}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {isEditing ? (
                        <form onSubmit={onSave} className="flex gap-2">
                          <ActionButton label="Save" tone="primary" />
                          <ActionButton label="Cancel" tone="secondary" type="button" onClick={() => onEditChange(null)} />
                        </form>
                      ) : (
                        <ActionButton label="Edit" tone="secondary" type="button" onClick={() => onEditChange(company)} />
                      )}
                      <button
                        type="button"
                        onClick={() => void onEnterCompany(company.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700"
                      >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                        Enter company
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function MembershipsSection({
  form,
  users,
  companies,
  memberships,
  editingMembership,
  onFormChange,
  onCreate,
  onEditChange,
  onSave,
}: {
  form: typeof emptyMembershipForm;
  users: ManagedUser[];
  companies: ManagedCompany[];
  memberships: ManagedMembership[];
  editingMembership: ManagedMembership | null;
  onFormChange: React.Dispatch<React.SetStateAction<typeof emptyMembershipForm>>;
  onCreate: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onEditChange: React.Dispatch<React.SetStateAction<ManagedMembership | null>>;
  onSave: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <SectionCard title="Memberships" description="Attach users to companies, set tenant roles, and choose default companies.">
      <form onSubmit={onCreate} className="grid gap-3 border-b border-slate-200 pb-5 md:grid-cols-5">
        <select value={form.user_id} onChange={(event) => onFormChange((current) => ({ ...current, user_id: event.target.value }))} required className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
          <option value="">Choose user</option>
          {users.map((managedUser) => (
            <option key={managedUser.id} value={managedUser.id}>
              {managedUser.username}
            </option>
          ))}
        </select>
        <select value={form.company_id} onChange={(event) => onFormChange((current) => ({ ...current, company_id: event.target.value }))} required className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
          <option value="">Choose company</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <select value={form.role} onChange={(event) => onFormChange((current) => ({ ...current, role: event.target.value as UserRole }))} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <Checkbox checked={form.is_default} onChange={(checked) => onFormChange((current) => ({ ...current, is_default: checked }))} label="Default" />
          <Checkbox checked={form.is_active} onChange={(checked) => onFormChange((current) => ({ ...current, is_active: checked }))} label="Active" />
        </div>
        <PrimaryButton label="Create membership" />
      </form>

      <div className="overflow-x-auto pt-5">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Default</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((membership) => {
              const isEditing = editingMembership?.id === membership.id;
              return (
                <tr key={membership.id} className="border-t border-slate-100">
                  <td className="px-3 py-3">
                    {membership.user.username}
                    <div className="text-xs text-slate-500">{membership.user.email}</div>
                  </td>
                  <td className="px-3 py-3">{membership.company.name}</td>
                  <td className="px-3 py-3">
                    {isEditing ? (
                      <select value={editingMembership.role} onChange={(event) => onEditChange((current) => current ? { ...current, role: event.target.value as UserRole } : current)} className="h-10 rounded-lg border border-slate-200 px-3">
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      membership.role
                    )}
                  </td>
                  <td className="px-3 py-3">{isEditing ? <input type="checkbox" checked={editingMembership.is_default} onChange={(event) => onEditChange((current) => current ? { ...current, is_default: event.target.checked } : current)} /> : membership.is_default ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-3">{isEditing ? <input type="checkbox" checked={editingMembership.is_active} onChange={(event) => onEditChange((current) => current ? { ...current, is_active: event.target.checked } : current)} /> : membership.is_active ? 'Active' : 'Disabled'}</td>
                  <td className="px-3 py-3">
                    {isEditing ? (
                      <form onSubmit={onSave} className="flex gap-2">
                        <ActionButton label="Save" tone="primary" />
                        <ActionButton label="Cancel" tone="secondary" type="button" onClick={() => onEditChange(null)} />
                      </form>
                    ) : (
                      <ActionButton label="Edit" tone="secondary" type="button" onClick={() => onEditChange(membership)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-3 text-3xl font-bold text-slate-950">{value}</p>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </section>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  required,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      required={required}
      type={type}
      className="h-11 rounded-xl border border-slate-200 px-3 text-sm"
    />
  );
}

function InlineInput({
  value,
  onChange,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={type}
      className="h-10 w-full rounded-lg border border-slate-200 px-3"
    />
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      {label}
    </label>
  );
}

function PrimaryButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
    >
      {label}
    </button>
  );
}

function ActionButton({
  label,
  tone,
  type = 'submit',
  onClick,
}: {
  label: string;
  tone: 'primary' | 'secondary';
  type?: 'button' | 'submit';
  onClick?: () => void;
}) {
  const className =
    tone === 'primary'
      ? 'rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white'
      : 'rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700';

  return (
    <button type={type} onClick={onClick} className={className}>
      {label}
    </button>
  );
}
