/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileSearch,
  Info,
  LoaderCircle,
  Search,
} from 'lucide-react';
import { motion } from 'motion/react';

type GoogleBookResult = {
  id: string;
  title: string;
  authors: string[];
  publishedDate?: string;
  thumbnail?: string;
  previewLink?: string;
  infoLink?: string;
  snippet?: string;
};

type WorksheetResult = {
  rank: number;
  passage: string;
  translationPreview: string;
  sourceLines: string[];
};

type WorksheetSearchResponse = {
  query: string;
  resultCount: number;
  results: WorksheetResult[];
};

const GOOGLE_BOOKS_PAGE_URL = 'https://www.google.com/search?tbm=bks&q=';
const WORKSHEETMAKER_POST_URL = 'https://www.worksheetmaker.co.kr/user20/dataTexts/list.do';
const MIN_WORKSHEET_WORDS = 3;

const normalizePassage = (value: string) => value.replace(/\s+/g, ' ').trim();
const countWords = (value: string) => normalizePassage(value).split(' ').filter(Boolean).length;
const stripHtml = (value?: string) => (value ?? '').replace(/<[^>]+>/g, '').trim();

async function fetchGoogleBooks(query: string): Promise<GoogleBookResult[]> {
  const response = await fetch(`/api/google-books-search?q=${encodeURIComponent(query)}`);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `Google Books request failed with ${response.status}`);
  }

  const data = await response.json();

  return (data.results ?? []).map((item: any) => ({
    id: item.id,
    title: item.title ?? '제목 없음',
    authors: item.authors ?? [],
    publishedDate: item.publishedDate,
    thumbnail: item.thumbnail,
    previewLink: item.previewLink,
    infoLink: item.infoLink,
    snippet: stripHtml(item.snippet),
  }));
}

async function fetchWorksheetMaker(query: string): Promise<WorksheetSearchResponse> {
  const response = await fetch(`/api/worksheetmaker-search?q=${encodeURIComponent(query)}`);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `WorksheetMaker request failed with ${response.status}`);
  }

  return response.json();
}

function openWorksheetMakerSearch(query: string) {
  const normalized = normalizePassage(query);
  if (!normalized) return;

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = WORKSHEETMAKER_POST_URL;
  form.target = '_blank';
  form.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'searchText';
  input.value = normalized;

  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export default function App() {
  const [passage, setPassage] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [googleResults, setGoogleResults] = useState<GoogleBookResult[]>([]);
  const [worksheetResults, setWorksheetResults] = useState<WorksheetSearchResponse | null>(null);
  const [googleError, setGoogleError] = useState('');
  const [worksheetError, setWorksheetError] = useState('');
  const [worksheetNotice, setWorksheetNotice] = useState('');

  const normalizedPassage = useMemo(() => normalizePassage(passage), [passage]);
  const worksheetWordCount = useMemo(() => countWords(passage), [passage]);

  const handleUnifiedSearch = useCallback(async () => {
    if (!normalizedPassage) return;

    setIsSearching(true);
    setLastQuery(normalizedPassage);
    setGoogleResults([]);
    setWorksheetResults(null);
    setGoogleError('');
    setWorksheetError('');
    setWorksheetNotice('');

    const googleTask = fetchGoogleBooks(normalizedPassage)
      .then((results) => setGoogleResults(results))
      .catch((error) => {
        console.error(error);
        setGoogleError('Google Books 결과를 불러오지 못했습니다.');
      });

    let worksheetTask: Promise<void>;
    if (worksheetWordCount < MIN_WORKSHEET_WORDS) {
      setWorksheetNotice('WorksheetMaker 검색은 연속된 3단어 이상일 때만 실행됩니다.');
      worksheetTask = Promise.resolve();
    } else {
      worksheetTask = fetchWorksheetMaker(normalizedPassage)
        .then((results) => setWorksheetResults(results))
        .catch((error) => {
          console.error(error);
          setWorksheetError('WorksheetMaker 결과를 불러오지 못했습니다.');
        });
    }

    await Promise.allSettled([googleTask, worksheetTask]);
    setIsSearching(false);
  }, [normalizedPassage, worksheetWordCount]);

  const handleCopy = useCallback(() => {
    if (!normalizedPassage) return;
    navigator.clipboard.writeText(normalizedPassage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [normalizedPassage]);

  const openGoogleBooksPage = useCallback(() => {
    if (!normalizedPassage) return;
    window.open(`${GOOGLE_BOOKS_PAGE_URL}${encodeURIComponent(`"${normalizedPassage}"`)}`, '_blank');
  }, [normalizedPassage]);

  const openWorksheetMakerPage = useCallback(() => {
    openWorksheetMakerSearch(normalizedPassage);
  }, [normalizedPassage]);

  const hasAnyResultsView = lastQuery || isSearching;

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-900 font-sans selection:bg-indigo-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-lg shadow-indigo-200">
              <BookOpen size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">English Source Finder</h1>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Google Books + WorksheetMaker
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="space-y-8"
        >
          <section className="space-y-4 text-center">
            <h2 className="text-3xl font-bold text-slate-800">지문 원문 찾기</h2>
            <p className="mx-auto max-w-2xl text-slate-600">
              영어 지문의 특징적인 문구를 넣으면 Google Books 후보와 WorksheetMaker 검색 결과를 한 번에 확인할 수 있습니다.
            </p>
          </section>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-5 p-6">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="passage-input" className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  검색할 문구 입력
                  <div className="group relative">
                    <Info size={14} className="cursor-help text-slate-400" />
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-72 -translate-x-1/2 rounded-lg bg-slate-800 p-2 text-[10px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      Google Books는 고유한 문장이 길수록 유리하고, WorksheetMaker는 연속된 영어 3단어 이상이 필요합니다.
                    </div>
                  </div>
                </label>
                {normalizedPassage && (
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-xs text-slate-500 transition-colors hover:text-indigo-600"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? '복사됨' : '복사하기'}
                  </button>
                )}
              </div>

              <textarea
                id="passage-input"
                className="h-44 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 leading-relaxed text-slate-800 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                placeholder="예: are willing to give up in exchange for"
                value={passage}
                onChange={(event) => setPassage(event.target.value)}
              />

              <div className="flex flex-col gap-3 lg:flex-row">
                <button
                  onClick={handleUnifiedSearch}
                  disabled={!normalizedPassage || isSearching}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-4 font-semibold text-white shadow-lg shadow-indigo-200 transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSearching ? <LoaderCircle size={20} className="animate-spin" /> : <Search size={20} />}
                  {isSearching ? '검색 중...' : '통합 검색 시작'}
                </button>

                <button
                  onClick={openGoogleBooksPage}
                  disabled={!normalizedPassage}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  <ExternalLink size={18} />
                  Google Books 새 탭
                </button>

                <button
                  onClick={openWorksheetMakerPage}
                  disabled={!normalizedPassage || worksheetWordCount < MIN_WORKSHEET_WORDS}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  <ExternalLink size={18} />
                  WorksheetMaker 새 탭
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1">
                  <Check size={12} className="text-emerald-500" /> 실시간 통합 검색
                </span>
                <span className="flex items-center gap-1">
                  <Check size={12} className="text-emerald-500" /> Google Books 후보 확인
                </span>
                <span className="flex items-center gap-1">
                  <Check size={12} className="text-emerald-500" /> WorksheetMaker 출처 확인
                </span>
              </div>
              <div className="italic">검색어는 자동으로 정리된 뒤 사용됩니다.</div>
            </div>
          </section>

          {hasAnyResultsView && (
            <section className="space-y-4">
              <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">최근 검색어</p>
                  <p className="mt-1 break-all text-lg font-bold text-slate-900">{lastQuery || normalizedPassage}</p>
                </div>
                <p className="text-sm text-slate-500">왼쪽은 Google Books 후보, 오른쪽은 WorksheetMaker 검색 결과입니다.</p>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-xl bg-blue-100 p-2 text-blue-700">
                        <BookOpen size={18} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800">Google Books</h3>
                        <p className="text-xs text-slate-500">원전 또는 유사 도서 후보</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      {googleResults.length}건
                    </span>
                  </div>

                  {googleError && (
                    <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>{googleError}</span>
                    </div>
                  )}

                  {!googleError && (
                    <p className="text-xs text-slate-400">Google Books 데이터 제공</p>
                  )}

                  {!googleError && !isSearching && googleResults.length === 0 && lastQuery && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                      표시할 Google Books 후보가 없습니다. 새 탭 버튼으로 원래 검색 페이지를 바로 열어 확인해보세요.
                    </div>
                  )}

                  <div className="space-y-4">
                    {googleResults.map((result) => (
                      <article key={result.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex gap-4">
                          <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                            {result.thumbnail ? (
                              <img
                                src={result.thumbnail}
                                alt={result.title}
                                className="h-full w-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <BookOpen size={20} className="text-slate-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div>
                              <h4 className="line-clamp-2 text-base font-semibold text-slate-800">{result.title}</h4>
                              <p className="mt-1 text-sm text-slate-500">
                                {result.authors.length > 0 ? result.authors.join(', ') : '저자 정보 없음'}
                                {result.publishedDate ? ` · ${result.publishedDate}` : ''}
                              </p>
                            </div>
                            {result.snippet && (
                              <p className="line-clamp-3 text-sm leading-relaxed text-slate-600">{result.snippet}</p>
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                              {result.previewLink && (
                                <a
                                  href={result.previewLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                                >
                                  미리보기
                                </a>
                              )}
                              {result.infoLink && (
                                <a
                                  href={result.infoLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
                                >
                                  도서 정보
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
                        <FileSearch size={18} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800">WorksheetMaker</h3>
                        <p className="text-xs text-slate-500">국내 교재·모의고사 출처 결과</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      {worksheetResults?.resultCount ?? 0}건
                    </span>
                  </div>

                  {worksheetNotice && (
                    <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>{worksheetNotice}</span>
                    </div>
                  )}

                  {worksheetError && (
                    <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>{worksheetError}</span>
                    </div>
                  )}

                  {!worksheetNotice && !worksheetError && !isSearching && lastQuery && worksheetResults?.results?.length === 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                      WorksheetMaker에서 일치하는 결과가 보이지 않습니다. 새 탭 버튼으로 원본 검색 결과를 직접 확인할 수 있습니다.
                    </div>
                  )}

                  <div className="space-y-4">
                    {worksheetResults?.results.map((result) => (
                      <article key={`${result.rank}-${result.sourceLines.join('|')}`} className="rounded-2xl border border-slate-200 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            결과 {result.rank}
                          </span>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">영어 지문</p>
                            <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{result.passage}</p>
                          </div>

                          {result.sourceLines.length > 0 && (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">지문 출처</p>
                              <ul className="space-y-1 text-sm text-slate-600">
                                {result.sourceLines.map((line) => (
                                  <li key={line} className="rounded-xl bg-slate-50 px-3 py-2">
                                    {line}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {result.translationPreview && (
                            <details className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                              <summary className="cursor-pointer font-medium text-slate-700">해석 미리보기</summary>
                              <p className="mt-3 whitespace-pre-line leading-6">{result.translationPreview}</p>
                            </details>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <Search size={18} />
              </div>
              <h3 className="font-semibold text-sm">검색 팁</h3>
              <p className="text-xs leading-normal text-slate-500">
                너무 짧은 표현보다 고유한 문장을 넣을수록 Google Books와 WorksheetMaker 모두 정확도가 올라갑니다.
              </p>
            </div>
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <BookOpen size={18} />
              </div>
              <h3 className="font-semibold text-sm">Google Books</h3>
              <p className="text-xs leading-normal text-slate-500">
                원전 후보 도서와 미리보기 링크를 빠르게 확인할 수 있어 지문의 원래 맥락을 찾는 데 유용합니다.
              </p>
            </div>
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <FileSearch size={18} />
              </div>
              <h3 className="font-semibold text-sm">WorksheetMaker</h3>
              <p className="text-xs leading-normal text-slate-500">
                같은 문구가 실린 국내 모의고사·교재 정보를 함께 보여주므로 출처 확인이 훨씬 빨라집니다.
              </p>
            </div>
          </section>
        </motion.div>
      </main>

      <footer className="mx-auto mt-12 max-w-6xl border-t border-slate-200 px-6 py-12 text-center text-sm text-slate-400">
        <p>© 2026 English Passage Source Finder. All rights reserved.</p>
      </footer>
    </div>
  );
}
