"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    // Fetch user info
    api.get('/auth/me')
      .then(res => {
        setUser(res.data);
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  const handleCleanup = async () => {
      if(!confirm("Delete all unsaved comparison drafts? This cannot be undone.")) return;
      try {
          const res = await api.delete('/comparisons/cleanup');
          alert(`Cleaned ${res.data.deleted} unsaved comparisons.`);
      } catch (e) {
          console.error(e);
          alert('Cleanup failed');
      }
  };

  if (!user) return <div className="p-8">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Welcome, {user.username}</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">My Texts</h2>
            <p className="text-gray-600 mb-4">Upload and manage your texts.</p>
            <button 
              onClick={() => router.push('/texts')}
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
            >
              Go to Texts
            </button>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Comparisons</h2>
            <p className="text-gray-600 mb-4">Create new or view saved.</p>
            <div className="flex gap-2">
                <button 
                  onClick={() => router.push('/compare')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  New
                </button>
                <button 
                  onClick={() => router.push('/history')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Saved
                </button>
            </div>
          </div>
          
           <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Analysis & Tools</h2>
            <p className="text-gray-600 mb-4">Matrix, presets, classifications.</p>
            <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => router.push('/matrix')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Matrix
                </button>
                <button 
                  onClick={() => router.push('/classes')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Classes
                </button>
                <button 
                  onClick={() => router.push('/presets')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Presets
                </button>
                <button 
                  onClick={() => router.push('/fonts')}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
                >
                  Fonts
                </button>
                 <button 
                  onClick={handleCleanup}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition-colors"
                  title="Remove unsaved drafts"
                >
                  Clean Unused
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
