"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';

interface Comparison {
  id: number;
  base_text_id: number;
  other_text_id: number;
  base_text_title?: string;
  other_text_title?: string;
  created_at: string;
  weights: any;
  saved: boolean;
}

export default function HistoryPage() {
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const loadHistory = () => {
      api.get('/comparisons/?saved_only=true')
      .then(res => {
        setComparisons(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleDelete = async (id: number) => {
      if(!confirm("Are you sure you want to delete this saved comparison?")) return;
      try {
          await api.delete(`/comparisons/${id}`);
          loadHistory(); // Reload list
      } catch (e) {
          console.error(e);
          alert('Delete failed');
      }
  };

  if (loading) return <div className="p-8">Loading history...</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white p-8 rounded shadow">
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Comparison History</h1>
            <button onClick={() => router.push('/dashboard')} className="text-blue-500 hover:underline">Back to Dashboard</button>
        </div>
        
        {comparisons.length === 0 ? (
            <p className="text-gray-500">No saved comparisons found.</p>
        ) : (
            <div className="space-y-4">
                {comparisons.map(comp => (
                    <div key={comp.id} className="border p-4 rounded hover:bg-gray-50 flex justify-between items-center group">
                        <div 
                            className="cursor-pointer flex-1"
                            onClick={() => router.push(`/compare/${comp.id}`)}
                        >
                            <div className="font-semibold text-lg flex items-center gap-2">
                                <span>Result #{comp.id}</span>
                                <span className="text-gray-400 font-normal text-sm mx-2">|</span>
                                <span className="font-medium text-gray-800 text-base">
                                    {comp.base_text_title || `Text ${comp.base_text_id}`} <span className="text-gray-400 mx-1">vs</span> {comp.other_text_title || `Text ${comp.other_text_id}`}
                                </span>
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                                Created: {new Date(comp.created_at).toLocaleString()}
                            </div>
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(comp.id); }}
                            className="text-gray-400 hover:text-red-600 p-2 rounded hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete comparison"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
}
