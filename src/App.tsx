/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Search, BookOpen, ExternalLink, Info, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [passage, setPassage] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSearch = useCallback(() => {
    if (!passage.trim()) return;
    
    // Construct Google Books search URL with exact phrase matching
    const query = encodeURIComponent(`"${passage.trim()}"`);
    const searchUrl = `https://www.google.com/search?tbm=bks&q=${query}`;
    
    // Open in a new tab
    window.open(searchUrl, '_blank');
  }, [passage]);

  const handleCopy = useCallback(() => {
    if (!passage) return;
    navigator.clipboard.writeText(passage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [passage]);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-900 font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg text-white">
              <BookOpen size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">English Source Finder</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">CSAT & Mock Exam Assistant</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8"
        >
          {/* Hero Section */}
          <section className="text-center space-y-4">
            <h2 className="text-3xl font-bold text-slate-800">지문 원문 찾기</h2>
            <p className="text-slate-600 max-w-xl mx-auto">
              수능이나 모의고사 영어 지문의 특정 문구를 입력하세요. <br />
              Google Books를 통해 해당 지문이 수록된 원전(Original Source)을 찾아드립니다.
            </p>
          </section>

          {/* Search Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <label htmlFor="passage-input" className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  검색할 문구 입력
                  <div className="group relative">
                    <Info size={14} className="text-slate-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 bg-slate-800 text-white text-[10px] rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                      지문에서 가장 특징적인 1~2문장을 입력하면 검색 정확도가 올라갑니다.
                    </div>
                  </div>
                </label>
                {passage && (
                  <button 
                    onClick={handleCopy}
                    className="text-xs flex items-center gap-1 text-slate-500 hover:text-indigo-600 transition-colors"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? '복사됨' : '복사하기'}
                  </button>
                )}
              </div>
              
              <textarea
                id="passage-input"
                className="w-full h-48 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none resize-none text-slate-800 leading-relaxed"
                placeholder="예: The most important thing in life is to be yourself..."
                value={passage}
                onChange={(e) => setPassage(e.target.value)}
              />

              <div className="flex gap-3">
                <button
                  onClick={handleSearch}
                  disabled={!passage.trim()}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-200 active:scale-[0.98]"
                >
                  <Search size={20} />
                  Google Books에서 검색하기
                </button>
              </div>
            </div>
            
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1"><Check size={12} className="text-emerald-500" /> 정확한 문구 검색</span>
                <span className="flex items-center gap-1"><Check size={12} className="text-emerald-500" /> 원문 출처 확인</span>
              </div>
              <div className="flex items-center gap-1 italic">
                Powered by Google Books
              </div>
            </div>
          </div>

          {/* Tips Section */}
          <section className="grid md:grid-cols-3 gap-6">
            <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-2">
              <div className="w-8 h-8 bg-amber-100 text-amber-700 rounded-lg flex items-center justify-center mb-2">
                <Search size={18} />
              </div>
              <h3 className="font-semibold text-sm">검색 팁</h3>
              <p className="text-xs text-slate-500 leading-normal">
                너무 짧은 문구보다는 고유한 표현이 포함된 긴 문장을 입력하는 것이 좋습니다.
              </p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-2">
              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center mb-2">
                <BookOpen size={18} />
              </div>
              <h3 className="font-semibold text-sm">원문 활용</h3>
              <p className="text-xs text-slate-500 leading-normal">
                지문의 앞뒤 맥락을 파악하면 변형 문제 대비나 심화 학습에 큰 도움이 됩니다.
              </p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-2">
              <div className="w-8 h-8 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center mb-2">
                <ExternalLink size={18} />
              </div>
              <h3 className="font-semibold text-sm">자동 연결</h3>
              <p className="text-xs text-slate-500 leading-normal">
                버튼을 누르면 즉시 Google Books 검색 결과 페이지가 새 탭에서 열립니다.
              </p>
            </div>
          </section>
        </motion.div>
      </main>

      <footer className="max-w-4xl mx-auto px-6 py-12 text-center text-slate-400 text-sm border-t border-slate-200 mt-12">
        <p>© 2026 English Passage Source Finder. All rights reserved.</p>
      </footer>
    </div>
  );
}
