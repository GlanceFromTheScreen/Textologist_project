"use client";

import api from '@/lib/api';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);

  // Simple auth check (token existence)
  useEffect(() => {
    // This runs on client mount. 
    // Ideally use a context, but localStorage check is fine for MVP.
    const token = localStorage.getItem('token');
    setIsLoggedIn(!!token);
    setIsAdmin(false);
    let cancelled = false;
    if (token && pathname !== '/login' && pathname !== '/register') {
      api.get('/auth/me').then(res => { if (!cancelled) setIsAdmin(res.data.role === 'admin'); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [pathname]); // Re-check on route change

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsLoggedIn(false);
    router.push('/login');
  };

  // Don't show navbar on login/register
  if (pathname === '/login' || pathname === '/register' || pathname === '/') {
      return null;
  }

  const navItems = [
    { name: 'Главная', href: '/dashboard' },
    { name: 'Тексты', href: '/texts' },
    { name: 'История', href: '/history' },
    { name: 'Матрица', href: '/matrix' },
    ...(isAdmin ? [{ name: 'Пользователи', href: '/users' }] : []),
  ];

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center cursor-pointer" onClick={() => router.push('/dashboard')}>
              <span className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                <span className="italic">Textologist+</span>
              </span>
            </div>
            <div className="hidden sm:ml-8 sm:flex sm:space-x-8">
              {navItems.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${
                    pathname === item.href
                      ? 'border-indigo-500 text-slate-900'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  {item.name}
                </a>
              ))}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              Выйти
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
