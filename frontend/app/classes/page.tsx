"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';

interface ClassItem {
  id: number;
  code: string;
  display_name: string;
  color_hex: string;
  is_global: boolean;
  hidden: boolean;
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Form state
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState('#e0e7ff'); // default blue-100
  const [creating, setCreating] = useState(false);

  const fetchClasses = () => {
    api.get('/classes/')
      .then(res => {
        setClasses(res.data);
        setLoading(false);
      })
      .catch(err => console.error(err));
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !displayName) return;

    setCreating(true);
    try {
      await api.post('/classes/', {
        code,
        display_name: displayName,
        color_hex: color
      });
      setCode('');
      setDisplayName('');
      setColor('#e0e7ff');
      fetchClasses();
    } catch (err) {
      console.error(err);
      alert('Failed to create class');
    } finally {
      setCreating(false);
    }
  };

  // Override logic (rename/color change for global classes) not fully implemented in UI here for MVP simplicity,
  // but we can add simple visibility toggle or local edit later.
  // Currently this page allows creating USER classes.

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Class Management</h1>
            <button onClick={() => router.push('/dashboard')} className="text-indigo-600 hover:underline">
                Back to Dashboard
            </button>
        </div>

        {/* Create Form */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-semibold mb-4">Create New Class</h2>
          <form onSubmit={handleCreate} className="flex gap-4 items-end flex-wrap">
            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input
                type="text"
                required
                placeholder="e.g. typo"
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                value={code}
                onChange={e => setCode(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Опечатка"
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
            </div>
            <div className="w-20">
              <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
              <input
                type="color"
                className="block w-full h-[38px] p-1 rounded-md border border-gray-300 cursor-pointer"
                value={color}
                onChange={e => setColor(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 h-[38px]"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </form>
        </div>

        {/* List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Color</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {classes.map(cls => (
                <tr key={cls.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div 
                        className="w-8 h-8 rounded border border-gray-200" 
                        style={{ backgroundColor: cls.color_hex }}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{cls.display_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{cls.code}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {cls.is_global ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                              Global
                          </span>
                      ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                              Personal
                          </span>
                      )}
                  </td>
                </tr>
              ))}
              {classes.length === 0 && !loading && (
                <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">No classes found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
