"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';

interface Font {
  id: number;
  name: string;
  format: string;
  created_at: string;
}

export default function FontsPage() {
  const [fonts, setFonts] = useState<Font[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);

  const router = useRouter();

  const fetchFonts = async () => {
    try {
      const res = await api.get('/fonts/');
      setFonts(res.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFonts();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);

    setUploading(true);
    try {
      await api.post('/fonts/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // Reset form and reload list
      setFile(null);
      setName('');
      setUploading(false);
      fetchFonts();
    } catch (err) {
      console.error(err);
      alert('Upload failed');
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
      if(!confirm("Are you sure?")) return;
      try {
          await api.delete(`/fonts/${id}`);
          fetchFonts();
      } catch (e) {
          console.error(e);
          alert('Delete failed');
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">My Fonts</h1>
                <p className="text-slate-500 mt-1">Manage custom fonts for text display</p>
            </div>
            <button 
                onClick={() => router.push('/dashboard')} 
                className="text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-2"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                Back to Dashboard
            </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Upload Card */}
            <div className="lg:col-span-1">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 sticky top-24">
                    <h2 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
                        <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Upload New Font
                    </h2>
                    <form onSubmit={handleUpload} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Font Name</label>
                            <input 
                                type="text" 
                                className="block w-full rounded-md border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 bg-slate-50 text-sm"
                                placeholder="e.g. Times New Roman Custom"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">File (.ttf, .otf, .woff)</label>
                            <input 
                                type="file" 
                                accept=".ttf,.otf,.woff"
                                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                onChange={e => setFile(e.target.files ? e.target.files[0] : null)}
                                required
                            />
                        </div>
                        <button 
                            type="submit" 
                            disabled={!file || !name || uploading}
                            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm font-medium flex justify-center items-center"
                        >
                            {uploading ? (
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : 'Upload Font'}
                        </button>
                    </form>
                </div>
            </div>

            {/* List */}
            <div className="lg:col-span-2">
                 <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <h2 className="font-bold text-lg text-slate-800">Available Fonts</h2>
                        <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded-full">{fonts.length} items</span>
                    </div>
                    
                    {loading ? (
                        <div className="p-8 text-center text-slate-400">Loading...</div>
                    ) : fonts.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">
                            <svg className="w-12 h-12 mx-auto mb-3 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                            <p>No custom fonts found. Upload one to get started.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {fonts.map(font => (
                                <div key={font.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                                            <span className="text-xs font-bold uppercase">{font.format}</span>
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors">{font.name}</h3>
                                            <p className="text-xs text-slate-500">
                                                Added {new Date(font.created_at).toLocaleDateString()} • ID: {font.id}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={() => handleDelete(font.id)}
                                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                            title="Delete font"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                 </div>
            </div>
        </div>
      </div>
    </div>
  );
}
