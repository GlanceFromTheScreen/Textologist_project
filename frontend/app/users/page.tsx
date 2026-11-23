"use client";

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/errors';

interface Account { id: number; username: string; role: 'admin' | 'user'; created_at: string; }
const PAGE_SIZE = 100;

export default function UsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<Account | null>(null);
  const [users, setUsers] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editing, setEditing] = useState<Account | null>(null);
  const [editLogin, setEditLogin] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const loadUsers = async (targetPage: number) => {
    const response = await api.get('/users/', {params: {skip: targetPage * PAGE_SIZE, limit: PAGE_SIZE}});
    setUsers(response.data); setPage(targetPage); setHasNext(response.data.length === PAGE_SIZE);
  };
  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.get('/auth/me');
        setMe(response.data);
        if (response.data.role === 'admin') await loadUsers(0);
      } catch (err) { setError(apiErrorMessage(err, 'Не удалось загрузить пользователей.')); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const response = await api.post('/users/', {username: newLogin.trim(), password: newPassword});
      setNewLogin(''); setNewPassword('');
      setSuccess(`Пользователь «${response.data.username}» создан с ролью «Пользователь».`);
      await loadUsers(0);
    } catch (err) { setError(apiErrorMessage(err, 'Не удалось создать аккаунт.')); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editing || busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const data: {username?: string; password?: string} = {};
      if (editLogin.trim() !== editing.username) data.username = editLogin.trim();
      if (editPassword) data.password = editPassword;
      await api.patch(`/users/${editing.id}`, data);
      setEditPassword(''); setEditing(null);
      if (editing.id === me?.id) {
        localStorage.removeItem('token'); router.replace('/login'); return;
      }
      setSuccess('Данные аккаунта обновлены. Пользователю нужно войти заново.');
      await loadUsers(page);
    } catch (err) { setError(apiErrorMessage(err, 'Не удалось обновить аккаунт.')); }
    finally { setBusy(false); }
  };
  const changePage = async (target: number) => {
    setBusy(true); setError('');
    try { await loadUsers(target); } catch (err) { setError(apiErrorMessage(err, 'Не удалось загрузить страницу.')); }
    finally { setBusy(false); }
  };

  if (loading) return <p role="status" className="p-8">Загрузка…</p>;
  if (me?.role !== 'admin') return <div className="p-8"><h1 className="text-2xl font-bold">Доступ только для администратора</h1><p role="alert" className="mt-3">{error || 'Управление аккаунтами недоступно для роли «Пользователь».'}</p><a href="/dashboard" className="text-indigo-600 underline mt-4 inline-block">На главную</a></div>;

  const inputStyle = 'w-full rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50';
  const buttonStyle = 'rounded-lg bg-indigo-600 text-white px-4 py-2 hover:bg-indigo-700 disabled:opacity-50';
  return <div className="min-h-screen bg-slate-50 p-8"><div className="max-w-6xl mx-auto space-y-6">
    <header className="flex items-center justify-between gap-4"><div><h1 className="text-3xl font-bold">Пользователи</h1><p className="text-slate-500 mt-2">Управление аккаунтами · {me.username} · Администратор</p></div><a href="/dashboard" className="text-indigo-600 hover:underline">На главную</a></header>
    {error && <p role="alert" className="p-3 bg-red-50 rounded-lg text-red-700">{error}</p>}
    {success && <p role="status" className="p-3 bg-emerald-50 rounded-lg text-emerald-800">{success}</p>}
    <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h2 className="text-xl font-semibold mb-2">Создать аккаунт</h2><p className="text-sm text-slate-500 mb-4">Новый аккаунт получает роль «Пользователь».</p>
      <form onSubmit={create} className="grid md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
        <div><label htmlFor="new-login" className="block text-sm font-medium mb-1">Логин нового пользователя</label><input id="new-login" required maxLength={100} autoComplete="off" disabled={busy} value={newLogin} onChange={event => setNewLogin(event.target.value)} className={inputStyle}/></div>
        <div><label htmlFor="new-password" className="block text-sm font-medium mb-1">Пароль нового пользователя</label><input id="new-password" type="password" required maxLength={256} autoComplete="new-password" disabled={busy} value={newPassword} onChange={event => setNewPassword(event.target.value)} className={inputStyle}/></div>
        <button type="submit" disabled={busy || !newLogin.trim() || !newPassword} className={buttonStyle}>Создать пользователя</button>
      </form>
    </section>
    {editing && <section aria-label={`Редактирование ${editing.username}`} className="bg-white rounded-xl border border-indigo-200 p-6 shadow-sm">
      <h2 className="text-xl font-semibold mb-2">Изменить аккаунт «{editing.username}»</h2>
      <p className="text-sm text-slate-500 mb-4">Пустое поле нового пароля сохраняет прежний пароль. После изменения данных потребуется повторный вход{editing.id === me.id ? ' в ваш аккаунт' : ' в этот аккаунт'}.</p>
      <form onSubmit={save} className="space-y-4"><div className="grid md:grid-cols-2 gap-4">
        <div><label htmlFor="edit-login" className="block text-sm font-medium mb-1">Логин</label><input id="edit-login" required maxLength={100} autoComplete="off" disabled={busy} value={editLogin} onChange={event => setEditLogin(event.target.value)} className={inputStyle}/></div>
        <div><label htmlFor="edit-password" className="block text-sm font-medium mb-1">Новый пароль (необязательно)</label><input id="edit-password" type="password" maxLength={256} autoComplete="new-password" disabled={busy} value={editPassword} onChange={event => setEditPassword(event.target.value)} className={inputStyle}/></div>
      </div><div className="flex gap-3"><button type="submit" disabled={busy || !editLogin.trim() || (editLogin.trim() === editing.username && !editPassword)} className={buttonStyle}>Сохранить изменения</button><button type="button" disabled={busy} onClick={() => {setEditing(null); setEditPassword('');}} className="px-4 py-2 text-slate-600">Отмена</button></div></form>
    </section>}
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <h2 className="text-xl font-semibold px-6 pt-6 pb-4">Аккаунты</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-500"><tr><th className="px-6 py-3">Логин</th><th className="px-6 py-3">Роль</th><th className="px-6 py-3">Создан</th><th className="px-6 py-3"><span className="sr-only">Действия</span></th></tr></thead>
        <tbody>{users.map(user => <tr key={user.id} className="border-t border-slate-100"><td className="px-6 py-4 font-medium">{user.username}{user.id === me.id && <span className="ml-2 text-slate-400 font-normal">(вы)</span>}</td><td className="px-6 py-4"><span className={`rounded px-2 py-1 ${user.role === 'admin' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'}`}>{user.role === 'admin' ? 'Администратор' : 'Пользователь'}</span></td><td className="px-6 py-4 text-slate-500">{new Date(user.created_at).toLocaleDateString('ru-RU')}</td><td className="px-6 py-4 text-right"><button type="button" disabled={busy} aria-label={`Изменить аккаунт ${user.username}`} onClick={() => {setEditing(user); setEditLogin(user.username); setEditPassword(''); setError(''); setSuccess('');}} className="text-indigo-600 hover:underline">Изменить</button></td></tr>)}</tbody>
      </table></div>
      {(page > 0 || hasNext) && <div className="p-4 flex gap-4 items-center"><button disabled={busy || page === 0} onClick={() => changePage(page - 1)} className="text-indigo-600 disabled:opacity-40">Назад</button><span>Страница {page + 1}</span><button disabled={busy || !hasNext} onClick={() => changePage(page + 1)} className="text-indigo-600 disabled:opacity-40">Далее</button></div>}
    </section>
  </div></div>;
}
