/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Sparkles,
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
  viewability?: string;
  accessViewStatus?: string;
  webReaderLink?: string;
  previewAvailable: boolean;
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

type HighlightPattern = {
  text: string;
  className: string;
};

const GOOGLE_BOOKS_PAGE_URL = 'https://www.google.com/search?tbm=bks&q=';
const WORKSHEETMAKER_POST_URL = 'https://www.worksheetmaker.co.kr/user20/dataTexts/list.do';
const WORKSHEETMAKER_HOME_URL = 'https://www.worksheetmaker.co.kr/';
const FLOW_BLOG_URL = 'https://flowedu.tistory.com';
const APP_HOME_URL = 'https://english-finder.vercel.app/';
const BRAND_LINK_CLASS = 'inline-flex items-center rounded-md px-1.5 py-0.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-50 hover:text-sky-800';
const MIN_WORKSHEET_WORDS = 3;
const MAX_ENHANCEMENT_RETRIES = 4;
const FLOW_LLM_MODE = 'flow-llm';

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'almost', 'along', 'already', 'also', 'am', 'an',
  'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
  'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'even', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor',
  'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you',
  'your', 'yours', 'yourself', 'yourselves',
]);

const normalizePassage = (value: string) => value.replace(/\s+/g, ' ').trim();
const normalizeQuotes = (value: string) => value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const sanitizeSearchQuery = (value: string) => {
  const normalized = normalizePassage(normalizeQuotes(value));
  return normalized.replace(/^["'`]+|["'`]+$/g, '').trim();
};
const countWords = (value: string) => sanitizeSearchQuery(value).split(' ').filter(Boolean).length;
const decodeHtmlEntities = (value: string) => {
  let current = value ?? '';

  if (!current) {
    return '';
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');

    for (let index = 0; index < 5; index += 1) {
      const previous = current;
      textarea.innerHTML = current;
      current = textarea.value;

      if (current === previous) {
        break;
      }
    }
  }

  return current
    .replace(/&apos;/gi, "'")
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
const stripHtml = (value?: string) => {
  const decoded = decodeHtmlEntities(value ?? '');
  return decodeHtmlEntities(decoded.replace(/<[^>]+>/g, ' ')).trim();
};
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getQueryFromUrl = () => {
  if (typeof window === 'undefined') return '';

  const params = new URLSearchParams(window.location.search);
  return sanitizeSearchQuery(params.get('q') ?? '');
};

const getModeFromUrl = () => {
  if (typeof window === 'undefined') return '';

  const params = new URLSearchParams(window.location.search);
  return sanitizeSearchQuery(params.get('mode') ?? '');
};

function highlightText(text: string, query: string) {
  const cleanText = text ?? '';
  const cleanQuery = sanitizeSearchQuery(query);

  if (!cleanText || !cleanQuery) {
    return cleanText;
  }

  const regex = new RegExp(`(${escapeRegex(cleanQuery).replace(/ /g, '\\s+')})`, 'ig');
  const parts = cleanText.split(regex);

  if (parts.length === 1) {
    return cleanText;
  }

  return parts.map((part, index) =>
    part.match(regex) ? (
      <mark key={`${part}-${index}`} className="rounded bg-amber-200/80 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    ),
  );
}

function highlightTextWithPatterns(text: string, patterns: HighlightPattern[]) {
  const cleanText = text ?? '';
  const normalizedPatterns = Array.from(
    new Map(
      patterns
        .map((pattern) => ({ ...pattern, text: sanitizeSearchQuery(pattern.text) }))
        .filter((pattern) => pattern.text)
        .sort((a, b) => b.text.length - a.text.length)
        .map((pattern) => [pattern.text.toLowerCase(), pattern]),
    ).values(),
  );

  if (!cleanText || normalizedPatterns.length === 0) {
    return cleanText;
  }

  const separatorPattern = String.raw`(?:[\s,;:!?()[\]{}"“”‘’—–-]+)`;
  const compiledPatterns = normalizedPatterns
    .map((pattern) => {
      const tokens = pattern.text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) ?? [];
      if (tokens.length === 0) return null;

      const regexBody = tokens.map((token) => escapeRegex(token)).join(separatorPattern);
      return {
        ...pattern,
        regexBody,
        regex: new RegExp(`^${regexBody}$`, 'i'),
      };
    })
    .filter(Boolean) as Array<HighlightPattern & { regexBody: string; regex: RegExp }>;

  if (compiledPatterns.length === 0) {
    return cleanText;
  }

  const regex = new RegExp(`(${compiledPatterns.map((pattern) => pattern.regexBody).join('|')})`, 'ig');
  const parts = cleanText.split(regex);

  if (parts.length === 1) {
    return cleanText;
  }

  return parts.map((part, index) => {
    const matchedPattern = compiledPatterns.find((pattern) => pattern.regex.test(part));

    if (matchedPattern) {
      return (
        <mark key={`${part}-${index}`} className={`rounded px-0.5 text-inherit ${matchedPattern.className}`}>
          {part}
        </mark>
      );
    }

    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

function renderQueryWithPatterns(text: string, patterns: HighlightPattern[]) {
  return <span className="break-words">{highlightTextWithPatterns(text, patterns)}</span>;
}

function extractEnhancementQueries(passage: string, originalQuery: string) {
  const originalNormalized = sanitizeSearchQuery(originalQuery).toLowerCase();
  const normalizedPassage = stripHtml(passage)
    .replace(/[＄$€£¥]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedPassage) {
    return [];
  }

  const sentences = normalizedPassage
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  type Candidate = {
    text: string;
    tokens: string[];
    sentenceIndex: number;
    score: number;
    hasApostrophe: boolean;
  };

  const candidates: Candidate[] = [];

  const scoreWords = (words: string[]) => {
    const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
    const uncommonWords = words.filter((word) => {
      const lower = word.toLowerCase();
      return !STOP_WORDS.has(lower) && lower.length >= 5;
    });

    const startsWithStopWord = STOP_WORDS.has(words[0]?.toLowerCase() ?? '');
    const endsWithStopWord = STOP_WORDS.has(words[words.length - 1]?.toLowerCase() ?? '');
    const averageLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const apostrophePenalty = words.some((word) => word.includes("'")) ? 2.4 : 0;

    return (
      uncommonWords.length * 3 +
      uniqueWords.size * 0.7 +
      averageLength -
      (startsWithStopWord ? 0.8 : 0) -
      (endsWithStopWord ? 0.8 : 0) -
      apostrophePenalty
    );
  };

  sentences.forEach((sentence, sentenceIndex) => {
    const clauses = sentence
      .split(/[,:;()\[\]{}—–-]+/)
      .map((clause) => clause.trim())
      .filter(Boolean);

    clauses.forEach((clause) => {
      const words = (clause.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).map((word) => word.trim());

      if (words.length < 6) {
        return;
      }

      [7, 6].forEach((windowSize) => {
        if (words.length < windowSize) return;

        for (let start = 0; start <= words.length - windowSize; start += 1) {
          const windowWords = words.slice(start, start + windowSize);
          const text = sanitizeSearchQuery(windowWords.join(' '));
          const lowerText = text.toLowerCase();

          if (!text || lowerText === originalNormalized) {
            continue;
          }

          const uncommonCount = windowWords.filter((word) => {
            const lower = word.toLowerCase();
            return !STOP_WORDS.has(lower) && lower.length >= 5;
          }).length;

          if (uncommonCount < 2) {
            continue;
          }

          const clauseMiddleBonus = start > 0 && start + windowSize < words.length ? 0.5 : 0;
          const sentencePenalty = sentenceIndex * 0.12;
          const hasApostrophe = windowWords.some((word) => word.includes("'"));

          candidates.push({
            text,
            tokens: windowWords.map((word) => word.toLowerCase()),
            sentenceIndex,
            score: scoreWords(windowWords) + clauseMiddleBonus - sentencePenalty,
            hasApostrophe,
          });
        }
      });
    });
  });

  const deduped = Array.from(
    new Map(
      candidates
        .sort((a, b) => {
          if (a.hasApostrophe !== b.hasApostrophe) {
            return Number(a.hasApostrophe) - Number(b.hasApostrophe);
          }
          return b.score - a.score;
        })
        .map((candidate) => [candidate.text.toLowerCase(), candidate]),
    ).values(),
  );

  const overlapRatio = (left: string[], right: string[]) => {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const intersection = Array.from(leftSet).filter((token) => rightSet.has(token)).length;
    return intersection / Math.max(Math.min(leftSet.size, rightSet.size), 1);
  };

  const pushCandidate = (selected: Candidate[], candidate: Candidate) => {
    const alreadySelected = selected.some((picked) => picked.text.toLowerCase() === candidate.text.toLowerCase());
    const tooSimilar = selected.some((picked) => {
      if (picked.text.toLowerCase().includes(candidate.text.toLowerCase())) return true;
      if (candidate.text.toLowerCase().includes(picked.text.toLowerCase())) return true;
      return overlapRatio(picked.tokens, candidate.tokens) >= 0.66;
    });

    if (alreadySelected || tooSimilar) {
      return false;
    }

    selected.push(candidate);
    return true;
  };

  const selected: Candidate[] = [];
  const apostropheFreeCandidates = deduped.filter((candidate) => !candidate.hasApostrophe);
  const apostropheCandidates = deduped.filter((candidate) => candidate.hasApostrophe);

  const selectFromPool = (pool: Candidate[], preferUniqueSentences: boolean) => {
    const usedSentences = new Set(selected.map((candidate) => candidate.sentenceIndex));

    for (const candidate of pool) {
      if (preferUniqueSentences && usedSentences.has(candidate.sentenceIndex)) {
        continue;
      }

      if (pushCandidate(selected, candidate)) {
        usedSentences.add(candidate.sentenceIndex);
      }

      if (selected.length === MAX_ENHANCEMENT_RETRIES) {
        break;
      }
    }
  };

  selectFromPool(apostropheFreeCandidates, true);
  if (selected.length < MAX_ENHANCEMENT_RETRIES) selectFromPool(apostropheFreeCandidates, false);
  if (selected.length < MAX_ENHANCEMENT_RETRIES) selectFromPool(apostropheCandidates, true);
  if (selected.length < MAX_ENHANCEMENT_RETRIES) selectFromPool(apostropheCandidates, false);

  return selected.slice(0, MAX_ENHANCEMENT_RETRIES).map((candidate) => candidate.text);
}


function formatAuthors(authors?: string[]) {
  return authors?.filter(Boolean).join(', ') || '저자 정보 없음';
}

function formatCopyAsParagraphs(value?: string) {
  return decodeHtmlEntities(value ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ /g, ' ')
    .trim();
}

function buildComparisonPromptTemplate() {
  return [
    '다음 작업을 수행해줘.',
    '',
    '[작업 목표]',
    '첨부한 Google Books 이미지 속 원문 지문과 아래 문제 지문을 문장 단위로 정밀 대조해줘.',
    '',
    '[중요 지시]',
    '1. 첨부한 이미지를 직접 읽어 원문 지문을 파악하라.',
    '2. 이미지에 실제로 보이는 범위 안에서만 원문 지문을 재구성하라.',
    '3. 아래 문제 지문과 원문 지문을 의미상 가장 자연스럽게 대응시켜라.',
    '4. 대응되는 문장은 같은 번호로 맞춰라.',
    '5. 문제 지문에만 있는 문장, 원문 지문에만 있는 문장도 각각 독립 행으로 유지하라.',
    '6. 어휘 변형, 삭제, 추가, 문장 분할/통합, 표현 완화/강화가 있으면 그 차이가 드러나게 정리하라.',
    '7. 변형된 핵심 부분을 굵게 표시하고 밝은 색상으로 양쪽 모두 하이라이트하라.',
    '8. 출력은 반드시 표 형식으로 하라.',
    '9. 표 아래에 원문 책 정보를 표시하라.',
    '',
    '[출력 형식]',
    '번호 | 문제 지문 | 원문 지문',
    '',
    '[문제 지문]',
    '{{WORKSHEETMAKER_PASSAGE}}',
    '',
    '[참고 정보]',
    '- Google Books 제목: {{GOOGLE_BOOKS_TITLE}}',
    '- 저자: {{GOOGLE_BOOKS_AUTHORS}}',
    '- 검색 문구: {{SEARCH_QUERY}}',
    '',
    '[추가 규칙]',
    '- 이미지 판독이 불명확한 부분은 추측하지 말고 자연스럽게 보이는 범위까지만 반영하라.',
    '- 문제 지문과 원문 지문의 문장 수가 다르면 빈칸 없이 가장 자연스럽게 대응시켜라.',
    '- 동일 의미지만 표현만 달라진 경우도 그대로 대응시켜라.',
  ].join('\n');
}

function buildLlmInputPackage({
  passage,
  title,
  authors,
  query,
}: {
  passage: string;
  title?: string;
  authors?: string[];
  query: string;
}) {
  return [
    '다음 작업을 수행해줘.',
    '',
    '[작업 목표]',
    '첨부한 Google Books 이미지 속 원문 지문과 아래 문제 지문을 문장 단위로 정밀 대조해줘.',
    '',
    '[중요 지시]',
    '1. 첨부한 이미지를 직접 읽어 원문 지문을 파악하라.',
    '2. 이미지에 실제로 보이는 범위 안에서만 원문 지문을 재구성하라.',
    '3. 아래 문제 지문과 원문 지문을 의미상 가장 자연스럽게 대응시켜라.',
    '4. 대응되는 문장은 같은 번호로 맞춰라.',
    '5. 문제 지문에만 있는 문장, 원문 지문에만 있는 문장도 각각 독립 행으로 유지하라.',
    '6. 어휘 변형, 삭제, 추가, 문장 분할/통합, 표현 완화/강화가 있으면 그 차이가 드러나게 정리하라.',
    '7. 변형된 핵심 부분을 굵게 표시하고 밝은 색상으로 양쪽 모두 하이라이트하라.',
    '8. 출력은 반드시 표 형식으로 하라.',
    '9. 표 아래에 원문 책 정보를 표시하라.',
    '',
    '[출력 형식]',
    '번호 | 문제 지문 | 원문 지문',
    '',
    '[문제 지문]',
    formatCopyAsParagraphs(passage),
    '',
    '[참고 정보]',
    `- Google Books 제목: ${title || '제목 정보 없음'}`,
    `- 저자: ${formatAuthors(authors)}`,
    `- 검색 문구: ${query || '검색 문구 없음'}`,
    '',
    '[추가 규칙]',
    '- 이미지 판독이 불명확한 부분은 추측하지 말고 자연스럽게 보이는 범위까지만 반영하라.',
    '- 문제 지문과 원문 지문의 문장 수가 다르면 빈칸 없이 가장 자연스럽게 대응시켜라.',
    '- 동일 의미지만 표현만 달라진 경우도 그대로 대응시켜라.',
  ].join('\n');
}

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
    viewability: item.viewability,
    accessViewStatus: item.accessViewStatus,
    webReaderLink: item.webReaderLink,
    previewAvailable: Boolean(item.previewAvailable),
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

function buildGoogleBooksSearchUrl(query: string) {
  const normalized = sanitizeSearchQuery(query);
  return `${GOOGLE_BOOKS_PAGE_URL}${encodeURIComponent(`"${normalized}"`)}`;
}

function openWorksheetMakerSearch(query: string) {
  const normalized = sanitizeSearchQuery(query);
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
  const initialUrlQueryRef = useRef('');
  const hasInitializedFromUrlRef = useRef(false);
  const [passage, setPassage] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [googleQueryUsed, setGoogleQueryUsed] = useState('');
  const [googleResults, setGoogleResults] = useState<GoogleBookResult[]>([]);
  const [worksheetResults, setWorksheetResults] = useState<WorksheetSearchResponse | null>(null);
  const [googleError, setGoogleError] = useState('');
  const [worksheetError, setWorksheetError] = useState('');
  const [worksheetNotice, setWorksheetNotice] = useState('');
  const [enhancementMessage, setEnhancementMessage] = useState('');
  const [enhancementAttempts, setEnhancementAttempts] = useState<string[]>([]);
  const [copiedFlowAction, setCopiedFlowAction] = useState('');

  const normalizedPassage = useMemo(() => sanitizeSearchQuery(passage), [passage]);
  const isFlowLlmMode = useMemo(() => getModeFromUrl() === FLOW_LLM_MODE, []);
  const worksheetWordCount = useMemo(() => countWords(passage), [passage]);

  useEffect(() => {
    if (hasInitializedFromUrlRef.current) return;
    hasInitializedFromUrlRef.current = true;

    const urlQuery = getQueryFromUrl();
    if (!urlQuery) return;

    initialUrlQueryRef.current = urlQuery;
    setPassage(urlQuery);
  }, []);

  const handleUnifiedSearch = useCallback(async () => {
    if (!normalizedPassage) return;

    setIsSearching(true);
    setLastQuery(normalizedPassage);
    setGoogleQueryUsed(normalizedPassage);
    setGoogleResults([]);
    setWorksheetResults(null);
    setGoogleError('');
    setWorksheetError('');
    setWorksheetNotice('');
    setEnhancementMessage('');
    setEnhancementAttempts([]);

    const googleTask = fetchGoogleBooks(normalizedPassage)
      .then((results) => {
        setGoogleResults(results);
        setGoogleQueryUsed(normalizedPassage);
      })
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

  useEffect(() => {
    const pendingQuery = initialUrlQueryRef.current;

    if (!pendingQuery || normalizedPassage !== pendingQuery || isSearching || isEnhancing) {
      return;
    }

    initialUrlQueryRef.current = '';
    void handleUnifiedSearch();
  }, [handleUnifiedSearch, isEnhancing, isSearching, normalizedPassage]);

  const handleAutoEnhance = useCallback(async () => {
    if (
      isSearching ||
      isEnhancing ||
      googleResults.length > 0 ||
      !!googleError ||
      (worksheetResults?.resultCount ?? 0) < 1 ||
      !worksheetResults.results[0]?.passage
    ) {
      return;
    }

    const enhancementQueries = extractEnhancementQueries(worksheetResults.results[0].passage, lastQuery);

    if (enhancementQueries.length === 0) {
      setEnhancementMessage('자동 보강 검색에 사용할 특징 문구를 추출하지 못했습니다.');
      setEnhancementAttempts([]);
      return;
    }

    setIsEnhancing(true);
    setEnhancementMessage('');
    setEnhancementAttempts([]);

    let foundResults: GoogleBookResult[] = [];
    let matchedQuery = '';
    const triedQueries: string[] = [];

    for (const query of enhancementQueries.slice(0, MAX_ENHANCEMENT_RETRIES)) {
      triedQueries.push(query);
      setEnhancementAttempts([...triedQueries]);

      try {
        const results = await fetchGoogleBooks(query);
        if (results.length > 0) {
          foundResults = results;
          matchedQuery = query;
          break;
        }
      } catch (error) {
        console.error(error);
      }
    }

    if (foundResults.length > 0 && matchedQuery) {
      setGoogleResults(foundResults);
      setGoogleQueryUsed(matchedQuery);
      setEnhancementMessage('WorksheetMaker 1번 지문을 바탕으로 자동 보강 검색을 수행해 Google Books 후보를 찾았습니다.');
    } else {
      setEnhancementMessage(`자동 보강 검색 ${Math.min(enhancementQueries.length, MAX_ENHANCEMENT_RETRIES)}회 내에서는 Google Books 후보를 찾지 못했습니다.`);
    }

    setIsEnhancing(false);
  }, [googleError, googleResults.length, isEnhancing, isSearching, lastQuery, worksheetResults]);

  const handleCopy = useCallback(() => {
    if (!normalizedPassage) return;
    navigator.clipboard.writeText(normalizedPassage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [normalizedPassage]);

  const copyFlowText = useCallback((textToCopy: string, action: string) => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopiedFlowAction(action);
    window.setTimeout(() => setCopiedFlowAction(''), 2000);
  }, []);

  const firstWorksheetResult = worksheetResults?.results[0] ?? null;
  const firstGoogleResult = googleResults[0] ?? null;

  const handleCopyWorksheetPassage = useCallback(() => {
    if (!firstWorksheetResult?.passage) return;
    copyFlowText(formatCopyAsParagraphs(firstWorksheetResult.passage), 'passage');
  }, [copyFlowText, firstWorksheetResult]);

  const handleCopyWorksheetTranslation = useCallback(() => {
    if (!firstWorksheetResult?.translationPreview) return;
    copyFlowText(formatCopyAsParagraphs(firstWorksheetResult.translationPreview), 'translation');
  }, [copyFlowText, firstWorksheetResult]);

  const handleCopyComparisonPrompt = useCallback(() => {
    copyFlowText(buildComparisonPromptTemplate(), 'prompt');
  }, [copyFlowText]);

  const handleCopyLlmPackage = useCallback(() => {
    if (!firstWorksheetResult?.passage) return;
    copyFlowText(
      buildLlmInputPackage({
        passage: firstWorksheetResult.passage,
        title: firstGoogleResult?.title,
        authors: firstGoogleResult?.authors,
        query: googleQueryUsed || lastQuery || normalizedPassage,
      }),
      'package',
    );
  }, [copyFlowText, firstGoogleResult, firstWorksheetResult, googleQueryUsed, lastQuery, normalizedPassage]);

  const openGoogleBooksPage = useCallback(() => {
    if (!normalizedPassage) return;
    window.open(buildGoogleBooksSearchUrl(normalizedPassage), '_blank');
  }, [normalizedPassage]);

  const openWorksheetMakerPage = useCallback(() => {
    openWorksheetMakerSearch(normalizedPassage);
  }, [normalizedPassage]);

  const displayedWorksheetResults = useMemo(() => worksheetResults?.results.slice(0, 1) ?? [], [worksheetResults]);
  const hasAnyResultsView = lastQuery || isSearching;
  const currentGoogleQuery = googleQueryUsed || lastQuery || normalizedPassage;
  const flowLlmHelperVisible = isFlowLlmMode && !!firstWorksheetResult?.passage;
  const enhancementMatchedQuery = currentGoogleQuery && lastQuery && currentGoogleQuery !== lastQuery ? currentGoogleQuery : '';
  const worksheetHighlightPatterns = useMemo(() => {
    const patterns: HighlightPattern[] = [];

    if (lastQuery) {
      patterns.push({ text: lastQuery, className: 'bg-amber-200/80' });
    }

    if (enhancementMatchedQuery) {
      patterns.push({ text: enhancementMatchedQuery, className: 'bg-sky-200/85 text-sky-950' });
    }

    return patterns;
  }, [enhancementMatchedQuery, lastQuery]);
  const googleHighlightPatterns = worksheetHighlightPatterns;
  const canShowEnhancementButton =
    !isSearching &&
    !isEnhancing &&
    !googleError &&
    !!lastQuery &&
    googleResults.length === 0 &&
    (worksheetResults?.resultCount ?? 0) >= 1 &&
    !!worksheetResults.results[0]?.passage;

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-900 font-sans selection:bg-indigo-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href={APP_HOME_URL} className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-lg shadow-indigo-200">
              <BookOpen size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">English Source Finder</h1>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Google Books + WorksheetMaker
              </p>
            </div>
          </a>
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
            <div className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
              <h2 className="text-3xl font-bold text-slate-800">지문 원문 찾기</h2>
              <div className="inline-flex items-baseline gap-1">
                <span className="text-sm font-medium text-slate-500">by</span>
                <a href={FLOW_BLOG_URL} target="_blank" rel="noreferrer" className={BRAND_LINK_CLASS}>
                  Flow 영어연구소
                </a>
              </div>
            </div>
            <p className="mx-auto max-w-2xl text-slate-600">
              찾고 싶은 영어 지문의 특정 문구를 입력해 주세요. Google Books 및 WorksheetMaker 검색 결과를 한 번에 확인할 수 있습니다.
            </p>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
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
                  disabled={!normalizedPassage || isSearching || isEnhancing}
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
              <div className="italic">입력한 검색어는 자동으로 정리되어 검색에 사용됩니다.</div>
            </div>
          </section>

          {hasAnyResultsView && (
            <section className="space-y-4">
              <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">최근 검색어</p>
                  <p className="mt-1 break-all text-lg font-bold text-slate-900">{lastQuery || normalizedPassage}</p>
                </div>
                <p className="text-sm text-slate-500">왼쪽은 Google Books, 오른쪽은 WorksheetMaker 검색 결과입니다.</p>
              </div>

              {flowLlmHelperVisible && (
                <section className="rounded-3xl border border-sky-200 bg-sky-50/70 p-5 shadow-sm">
                  <div className="flex flex-col gap-4">
                    <p className="inline-flex w-fit items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
                      Flow LLM 비교 도구
                    </p>

                    <div className="grid w-full grid-cols-2 gap-3 max-[560px]:grid-cols-1 2xl:grid-cols-4">
                      <button
                        onClick={handleCopyWorksheetPassage}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Copy size={16} />
                        {copiedFlowAction === 'passage' ? '1번 지문 복사됨' : '1번 지문 전체 복사'}
                      </button>
                      <button
                        onClick={handleCopyWorksheetTranslation}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Copy size={16} />
                        {copiedFlowAction === 'translation' ? '1번 해석 복사됨' : '1번 해석 전체 복사'}
                      </button>
                      <button
                        onClick={handleCopyComparisonPrompt}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Copy size={16} />
                        {copiedFlowAction === 'prompt' ? '프롬프트 복사됨' : '비교 프롬프트 복사'}
                      </button>
                      <button
                        onClick={handleCopyLlmPackage}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
                      >
                        <Copy size={16} />
                        {copiedFlowAction === 'package' ? '입력 패키지 복사됨' : 'LLM 입력 패키지 복사'}
                      </button>
                    </div>
                  </div>
                </section>
              )}

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <a
                      href={currentGoogleQuery ? buildGoogleBooksSearchUrl(currentGoogleQuery) : 'https://books.google.com/'}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-2"
                    >
                      <div className="rounded-xl bg-blue-100 p-2 text-blue-700 transition-colors group-hover:bg-blue-200">
                        <BookOpen size={18} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800 group-hover:text-blue-700">Google Books</h3>
                        <p className="text-xs text-slate-500">원전 또는 유사 도서 후보</p>
                      </div>
                    </a>
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

                  {!googleError && <p className="text-xs text-slate-400">Google Books 데이터 제공</p>}

                  {enhancementMessage && !googleError && (
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-700">
                      <div className="flex items-start gap-2">
                        <Sparkles size={16} className="mt-0.5 shrink-0" />
                        <div className="space-y-2">
                          <p>{enhancementMessage}</p>
                          {enhancementAttempts.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500">시도한 검색 문구</p>
                              <ul className="mt-1 space-y-1 text-xs text-indigo-600">
                                {enhancementAttempts.map((attempt) => (
                                  <li key={attempt}>• {attempt}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {!googleError && !isSearching && googleResults.length === 0 && lastQuery && (
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                      <p>표시할 Google Books 후보가 없습니다. 새 탭 버튼으로 원래 검색 페이지를 바로 열어 확인해보세요.</p>

                      {canShowEnhancementButton && (
                        <div className="rounded-2xl border border-indigo-200 bg-white p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-slate-700">자동 보강 검색</p>
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                WorksheetMaker 1번 지문에서 더 짧고 특징적인 구간을 추출해 Google Books를 최대 {MAX_ENHANCEMENT_RETRIES}회 추가 검색합니다.
                              </p>
                            </div>
                            <button
                              onClick={handleAutoEnhance}
                              disabled={isEnhancing}
                              className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              {isEnhancing ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                              {isEnhancing ? '보강 검색 중...' : '자동 보강 검색'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {googleResults.length > 0 && currentGoogleQuery && currentGoogleQuery !== lastQuery && (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-xs text-slate-600">
                      현재 Google Books 결과는 자동 보강 검색 문구로 찾았습니다:{' '}
                      <span className="font-semibold text-sky-700">{currentGoogleQuery}</span>
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
                              <h4 className="line-clamp-2 text-base font-semibold text-slate-800">{highlightTextWithPatterns(result.title, googleHighlightPatterns)}</h4>
                              <p className="mt-1 text-sm text-slate-500">
                                {result.authors.length > 0 ? result.authors.join(', ') : '저자 정보 없음'}
                                {result.publishedDate ? ` · ${result.publishedDate}` : ''}
                              </p>
                            </div>
                            {result.snippet && (
                              <p className="line-clamp-3 text-sm leading-relaxed text-slate-600">{highlightTextWithPatterns(result.snippet, googleHighlightPatterns)}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <a
                                href={buildGoogleBooksSearchUrl(currentGoogleQuery || lastQuery)}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                              >
                                Google Books 열기
                              </a>
                              <a
                                href={result.previewLink || buildGoogleBooksSearchUrl(currentGoogleQuery || lastQuery)}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100"
                              >
                                미리보기
                              </a>
                              <a
                                href={result.infoLink || buildGoogleBooksSearchUrl(currentGoogleQuery || lastQuery)}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
                              >
                                도서 정보
                              </a>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <a
                      href={WORKSHEETMAKER_HOME_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-2"
                    >
                      <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700 transition-colors group-hover:bg-emerald-200">
                        <FileSearch size={18} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800 group-hover:text-emerald-700">WorksheetMaker</h3>
                        <p className="text-xs text-slate-500">국내 교재·모의고사 출처 결과</p>
                      </div>
                    </a>
                    <div className="flex items-center gap-2">
                      {lastQuery && !worksheetNotice && (
                        <button
                          onClick={openWorksheetMakerPage}
                          className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                        >
                          전체 결과 새 창
                        </button>
                      )}
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                        {worksheetResults?.resultCount ?? 0}건
                      </span>
                    </div>
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

                  {worksheetResults?.results && worksheetResults.results.length > 1 && (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <span>처음 1개 결과만 표시합니다. 전체 결과는 WorksheetMaker 새 창에서 확인하세요.</span>
                      <button
                        onClick={openWorksheetMakerPage}
                        className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        전체 결과 열기
                      </button>
                    </div>
                  )}

                  <div className="space-y-4">
                    {displayedWorksheetResults.map((result) => (
                      <article key={`${result.rank}-${result.sourceLines.join('|')}`} className="rounded-2xl border border-slate-200 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            결과 {result.rank}
                          </span>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">영어 지문</p>
                            <p className="whitespace-pre-line text-sm leading-6 text-slate-700">
                              {highlightTextWithPatterns(result.passage, worksheetHighlightPatterns)}
                            </p>
                          </div>

                          {result.sourceLines.length > 0 && (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">지문 출처</p>
                              <ul className="space-y-1 text-sm text-slate-600">
                                {result.sourceLines.map((line) => (
                                  <li key={line} className="rounded-xl bg-slate-50 px-3 py-2">
                                    {highlightTextWithPatterns(line, worksheetHighlightPatterns)}
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
        <p>
          © 2026{' '}
          <a href={FLOW_BLOG_URL} target="_blank" rel="noreferrer" className={BRAND_LINK_CLASS}>
            Flow 영어연구소
          </a>
          . All rights reserved.
        </p>
      </footer>
    </div>
  );
}
