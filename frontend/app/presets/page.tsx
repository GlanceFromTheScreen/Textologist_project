"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';

interface PresetRule {
    id: number;
    op_type: string;
    from_str: string;
    to_str: string;
    class_id: number | null;
}

interface Preset {
  id: number;
  name: string;
  description: string;
  created_at: string;
  rules: PresetRule[];
}

interface ClassItem {
    id: number;
    display_name: string;
    color_hex: string;
}

export default function PresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [classes, setClasses] = useState<Record<number, ClassItem>>({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const router = useRouter();

  const fetchData = async () => {
    try {
        const [presetsRes, classesRes] = await Promise.all([
            api.get('/presets/'),
            api.get('/classes/')
        ]);
        setPresets(presetsRes.data);
        
        const clsMap: Record<number, ClassItem> = {};
        classesRes.data.forEach((c: ClassItem) => { clsMap[c.id] = c; });
        setClasses(clsMap);
        
        setLoading(false);
    } catch (err) {
        console.error(err);
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this preset?')) return;
    try {
      await api.delete(`/presets/${id}`);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to delete preset');
    }
  };

  const getClassBadge = (classId: number | null) => {
      if (!classId) return <span className="text-gray-400">Unclassified</span>;
      const cls = classes[classId];
      if (!cls) return <span className="text-gray-400">Unknown class</span>;
      return (
          <span 
            className="px-2 py-0.5 rounded text-xs border"
            style={{ backgroundColor: cls.color_hex, borderColor: 'rgba(0,0,0,0.1)' }}
          >
              {cls.display_name}
          </span>
      );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Presets</h1>
            <button onClick={() => router.push('/dashboard')} className="text-indigo-600 hover:underline">
                Back to Dashboard
            </button>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rules</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {presets.map(preset => (
                <>
                    <tr key={preset.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{preset.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{preset.description}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {preset.rules.length} rules
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(preset.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                            onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                            className="text-indigo-600 hover:text-indigo-900 mr-4"
                        >
                            {expandedId === preset.id ? 'Hide Rules' : 'View Rules'}
                        </button>
                        <button 
                            onClick={() => handleDelete(preset.id)} 
                            className="text-red-600 hover:text-red-900"
                        >
                            Delete
                        </button>
                    </td>
                    </tr>
                    
                    {expandedId === preset.id && (
                        <tr className="bg-gray-50">
                            <td colSpan={5} className="px-6 py-4">
                                <div className="max-h-60 overflow-y-auto border rounded bg-white">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className="px-4 py-2 text-left">Operation</th>
                                                <th className="px-4 py-2 text-left">From</th>
                                                <th className="px-4 py-2 text-left">To</th>
                                                <th className="px-4 py-2 text-left">Assigned Class</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {preset.rules.map(rule => (
                                                <tr key={rule.id} className="border-t">
                                                    <td className="px-4 py-2 font-mono text-xs">{rule.op_type}</td>
                                                    <td className="px-4 py-2 font-mono">{rule.from_str || '∅'}</td>
                                                    <td className="px-4 py-2 font-mono">{rule.to_str || '∅'}</td>
                                                    <td className="px-4 py-2">
                                                        {getClassBadge(rule.class_id)}
                                                    </td>
                                                </tr>
                                            ))}
                                            {preset.rules.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-4 py-2 text-center text-gray-500">No rules in this preset.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </td>
                        </tr>
                    )}
                </>
              ))}
              {presets.length === 0 && !loading && (
                <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">No presets found. Create one from a comparison result.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
