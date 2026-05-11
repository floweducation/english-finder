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
  Download,
  ExternalLink,
  FileSearch,
  Info,
  LoaderCircle,
  Search,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Analytics } from '@vercel/analytics/react';

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

type TextToken = {
  value: string;
  start: number;
  end: number;
};

type PhraseContext = {
  text: string;
  before: string[];
  after: string[];
  found: boolean;
};

type GoogleBookMatchReview = {
  level: 'match' | 'warning' | 'mismatch';
  label: string;
  message: string;
  score: number;
  sourceContext: string;
  googleContext: string;
};

type VisitorStats = {
  enabled: boolean;
  total: number;
  today: number;
  yesterday: number;
  timezone: string;
  updatedAt: string;
};

type BatchInputItem = {
  id: string;
  text: string;
};

type BatchSearchResult = BatchInputItem & {
  status: 'idle' | 'searching' | 'done' | 'error';
  query: string;
  googleQuery: string;
  worksheetQuery: string;
  attempts: string[];
  googleAttempts: string[];
  worksheetAttempts: string[];
  googleResults: GoogleBookResult[];
  googleError: string;
  worksheetResults: WorksheetSearchResponse | null;
  worksheetError: string;
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
const ALL_MODE = 'all';
const MAX_GOOGLE_BATCH_QUERY_ATTEMPTS = 10;
const MAX_WORKSHEET_BATCH_QUERY_ATTEMPTS = 4;
const BATCH_GOOGLE_QUERY_MIN_WORDS = 10;
const BATCH_GOOGLE_QUERY_MAX_WORDS = 12;
const BATCH_WORKSHEET_QUERY_MIN_WORDS = 6;
const BATCH_WORKSHEET_QUERY_MAX_WORDS = 7;
const VISITOR_COUNTER_TIME_ZONE = 'Asia/Seoul';
const VISITOR_COUNTER_STORAGE_PREFIX = 'english-finder:visitor-counted';

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

function formatDisplayParagraph(value?: string) {
  return formatCopyAsParagraphs(value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value?: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightHtml(text: string, query: string, style: string) {
  const cleanText = formatDisplayParagraph(text);
  const cleanQuery = sanitizeSearchQuery(query);
  const tokens = cleanQuery.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) ?? [];

  if (!cleanText || tokens.length === 0) {
    return escapeHtml(cleanText);
  }

  const separatorPattern = String.raw`(?:[\s,;:!?()[\]{}"“”‘’—–-]+)`;
  const regex = new RegExp(tokens.map((token) => escapeRegex(token)).join(separatorPattern), 'ig');
  let lastIndex = 0;
  let output = '';

  cleanText.replace(regex, (match, offset: number) => {
    output += escapeHtml(cleanText.slice(lastIndex, offset));
    output += `<mark style="${style}">${escapeHtml(match)}</mark>`;
    lastIndex = offset + match.length;
    return match;
  });

  output += escapeHtml(cleanText.slice(lastIndex));
  return output;
}

function buildTistoryGoogleBookHtml(result: BatchSearchResult) {
  const query = getBatchGoogleDisplayQuery(result);
  const googleSearchUrl = buildGoogleBooksSearchUrl(query);
  const book = result.googleResults[0];

  if (result.status === 'searching') {
    return '<p style="margin:0;color:#64748b;font-size:14px;line-height:1.7;">Google Books 검색 중입니다.</p>';
  }

  if (result.googleError) {
    return `<p style="margin:0;color:#e11d48;font-size:14px;line-height:1.7;">${escapeHtml(result.googleError)}</p>`;
  }

  if (!book) {
    return [
      '<p style="margin:0 0 10px;color:#64748b;font-size:14px;line-height:1.7;">Google Books 후보가 없습니다.</p>',
      `<a href="${escapeHtml(googleSearchUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;border-radius:999px;background:#eef2ff;color:#4338ca;text-decoration:none;font-size:13px;font-weight:700;padding:7px 12px;">Google Books 원본 검색</a>`,
    ].join('\n');
  }

  const review = assessGoogleBookMatch(book, result.text, query);
  const reviewColor = review.level === 'match' ? '#047857' : review.level === 'warning' ? '#b45309' : '#be123c';
  const reviewBg = review.level === 'match' ? '#ecfdf5' : review.level === 'warning' ? '#fffbeb' : '#fff1f2';
  const authorLine = [formatAuthors(book.authors), book.publishedDate].filter(Boolean).join(' · ');

  return [
    '<div style="overflow:hidden;">',
    book.thumbnail
      ? `<img src="${escapeHtml(book.thumbnail)}" alt="${escapeHtml(book.title)}" style="float:left;width:72px;height:108px;object-fit:cover;border-radius:10px;background:#f1f5f9;margin:0 14px 10px 0;" />`
      : '',
    `<p style="margin:0 0 6px;color:#1e293b;font-size:18px;line-height:1.45;font-weight:800;">${escapeHtml(book.title)}</p>`,
    `<p style="margin:0 0 10px;color:#64748b;font-size:14px;line-height:1.6;">${escapeHtml(authorLine)}</p>`,
    book.snippet
      ? `<p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.75;">${highlightHtml(book.snippet, query, 'background:#fde68a;color:inherit;border-radius:4px;padding:0 2px;')}</p>`
      : '',
    `<p style="clear:both;margin:0 0 12px;border-radius:12px;background:${reviewBg};color:${reviewColor};font-size:13px;line-height:1.65;padding:10px 12px;"><strong>${escapeHtml(review.label)}</strong><br />${escapeHtml(review.message)}</p>`,
    '<p style="margin:0;">',
    `<a href="${escapeHtml(googleSearchUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 6px 6px 0;border-radius:999px;background:#eef2ff;color:#4338ca;text-decoration:none;font-size:13px;font-weight:700;padding:7px 12px;">Google Books 열기</a>`,
    `<a href="${escapeHtml(book.previewLink || googleSearchUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 6px 6px 0;border-radius:999px;background:#f5f3ff;color:#6d28d9;text-decoration:none;font-size:13px;font-weight:700;padding:7px 12px;">미리보기</a>`,
    `<a href="${escapeHtml(book.infoLink || googleSearchUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 0 6px 0;border-radius:999px;background:#f1f5f9;color:#334155;text-decoration:none;font-size:13px;font-weight:700;padding:7px 12px;">도서 정보</a>`,
    '</p>',
    '</div>',
  ].join('\n');
}

function buildTistoryExportHtml(results: BatchSearchResult[]) {
  const exportedAt = new Date().toLocaleString('ko-KR', {
    timeZone: VISITOR_COUNTER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const cards = results
    .map((result) => {
      const query = getBatchGoogleDisplayQuery(result);

      return [
        '<article style="box-sizing:border-box;margin:0 0 18px;padding:18px;border:1px solid #dbe3ef;border-radius:16px;background:#ffffff;">',
        `<h3 style="margin:0 0 14px;color:#1e293b;font-size:19px;line-height:1.45;font-weight:800;">${escapeHtml(result.id)}</h3>`,
        '<div style="margin:0 0 16px;">',
        '<p style="margin:0 0 6px;color:#64748b;font-size:13px;font-weight:800;letter-spacing:.04em;">본문텍스트 / 검색 문구</p>',
        `<p style="margin:0;color:#334155;font-size:14px;line-height:1.8;">${highlightHtml(result.text, query, 'background:#fde68a;color:inherit;border-radius:4px;padding:0 2px;')}</p>`,
        query
          ? `<p style="margin:10px 0 0;border-radius:12px;background:#fffbeb;color:#92400e;font-size:13px;line-height:1.65;padding:9px 11px;">Google Books 검색 문구: <strong>${escapeHtml(query)}</strong></p>`
          : '',
        '</div>',
        '<div>',
        '<p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:800;letter-spacing:.04em;">Google Books</p>',
        buildTistoryGoogleBookHtml(result),
        '</div>',
        '</article>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<div style="box-sizing:border-box;max-width:760px;margin:0 auto;color:#334155;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Apple SD Gothic Neo,Noto Sans KR,Malgun Gothic,sans-serif;">',
    '<h2 style="margin:0 0 8px;color:#111827;font-size:24px;line-height:1.35;font-weight:900;">English Finder 일괄검색 결과</h2>',
    `<p style="margin:0 0 18px;color:#94a3b8;font-size:13px;line-height:1.6;">생성 시각: ${escapeHtml(exportedAt)}</p>`,
    cards || '<p style="margin:0;color:#64748b;font-size:14px;line-height:1.7;">내보낼 결과가 없습니다.</p>',
    '</div>',
  ].join('\n');
}

function downloadHtmlFile(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildComparisonPromptTemplate() {
  return [
    '다음 형식으로 출력해줘.',
    '',
    '[출력 형식]',
    '- 반드시 preview 가능한 HTML 코드 블록으로만 출력할 것',
    '- 채팅 본문에 일반 표로 직접 렌더링하지 말고, HTML 코드만 제공할 것',
    '- <table> 태그를 사용해 표를 구성할 것',
    '- CSS는 inline style 방식으로 작성할 것',
    '',
    '[표 형식]',
    '- 표의 열은 다음과 같이 구성할 것:',
    '  번호 | 문제 지문 | 원문 지문',
    '- 번호 열의 폭은 너무 넓지 않게, 다른 열보다 확실히 좁게 설정할 것',
    '- 번호 칸의 숫자는 가로 가운데 정렬뿐 아니라 세로 가운데 정렬도 적용할 것',
    '- 문제 지문 또는 원문 지문이 없는 경우에는 ( - ) 로 표기할 것',
    '- 이 ( - ) 표기도 해당 셀 안에서 가로/세로 가운데 정렬되도록 할 것',
    '- 표 전체는 가독성이 좋도록 border-collapse, padding, line-height 등을 적절히 적용할 것',
    '- 긴 문장도 표 안에서 자연스럽게 줄바꿈되도록 할 것',
    '',
    '[대조 원칙]',
    '- 첨부 이미지를 직접 읽어 원문 지문을 파악할 것',
    '- 이미지에 실제로 보이는 범위 안에서만 원문을 재구성할 것',
    '- 문제 지문과 원문 지문을 문장 단위로 가장 자연스럽게 대응시킬 것',
    '- 대응되는 문장은 같은 번호로 맞출 것',
    '- 문제 지문에만 있는 문장, 원문 지문에만 있는 문장도 각각 독립 행으로 유지할 것',
    '- 어휘 변형, 삭제, 추가, 문장 분할/통합, 표현 완화/강화가 드러나게 정리할 것',
    '- 이미지 판독이 불명확한 부분은 추측하지 말 것',
    '',
    '[강조 방식]',
    '- 변형된 핵심 부분은 굵게 표시할 것',
    '- 동시에 밝은 색상으로 하이라이트할 것',
    '- mark 태그나 b 태그가 문자 그대로 보이지 않도록 처리할 것',
    '- 강조는 span style 방식으로 자연스럽게 렌더링되게 작성할 것',
    '',
    '[표 아래 추가 정리]',
    '- 표 아래에는 정보 박스를 다음 순서로 배치할 것:',
    '  1. 원문 변형 어휘',
    '  2. 원문 책 정보',
    '',
    '[원문 변형 어휘]',
    '- 표의 문장 대조에서 확인되는 핵심 변형 어휘/표현만 따로 뽑아 정리할 것',
    '- 단순히 같은 문장을 반복하지 말고, 실제로 바뀐 어휘·구·표현만 추려서 제시할 것',
    '- 반드시 다음 형식으로 제시할 것:',
    '  **[원문 어휘]**: [한글 뜻] (= [문제 어휘])',
    '- 예시:',
    '  **utilize**: 활용하다 (= use)',
    '  **rational faculty**: 이성적 능력 (= reasoning skill)',
    '  **realm**: 영역 (= area)',
    '  **perspective**: 관점 (= viewpoint)',
    '- 원문 어휘는 반드시 볼드체로 표시할 것',
    '- 명사와 동사는 반드시 원형(lemma)으로 표기할 것',
    '  - 명사는 가능하면 단수 원형으로',
    '  - 동사는 동사원형으로',
    '- 필요하면 형용사/부사도 불필요한 굴절형 없이 기본형으로 정리할 것',
    '- 원문 어휘와 문제 어휘가 구 단위 표현이면, 가능한 한 대응되는 핵심 표현의 기본형으로 정리할 것',
    '- 변형 어휘가 거의 없으면 ‘의미상 동일, 표현 차이 미미’라고 간단히 표시할 것',
    '- 이 항목은 ‘원문 참고 어휘’가 아니라, 반드시 ‘원문이 문제 지문에서 어떻게 변형되었는지’를 보여주는 용도로 작성할 것',
    '',
    '[원문 책 정보]',
    '- 제목, 저자, 검색 문구를 보기 좋게 정리할 것',
    '',
    '[기타]',
    '- 불필요한 설명 없이 HTML 코드 블록만 출력할 것',
    '- 미리보기 버튼으로 바로 렌더링 가능한 형태여야 할 것',
    '',
    '[문제 지문]',
    '{{WORKSHEETMAKER_PASSAGE}}',
    '',
    '[참고 정보]',
    '- Google Books 제목: {{GOOGLE_BOOKS_TITLE}}',
    '- 저자: {{GOOGLE_BOOKS_AUTHORS}}',
    '- 검색 문구: {{SEARCH_QUERY}}',
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
    '다음 형식으로 출력해줘.',
    '',
    '[출력 형식]',
    '- 반드시 preview 가능한 HTML 코드 블록으로만 출력할 것',
    '- 채팅 본문에 일반 표로 직접 렌더링하지 말고, HTML 코드만 제공할 것',
    '- <table> 태그를 사용해 표를 구성할 것',
    '- CSS는 inline style 방식으로 작성할 것',
    '',
    '[표 형식]',
    '- 표의 열은 다음과 같이 구성할 것:',
    '  번호 | 문제 지문 | 원문 지문',
    '- 번호 열의 폭은 너무 넓지 않게, 다른 열보다 확실히 좁게 설정할 것',
    '- 번호 칸의 숫자는 가로 가운데 정렬뿐 아니라 세로 가운데 정렬도 적용할 것',
    '- 문제 지문 또는 원문 지문이 없는 경우에는 ( - ) 로 표기할 것',
    '- 이 ( - ) 표기도 해당 셀 안에서 가로/세로 가운데 정렬되도록 할 것',
    '- 표 전체는 가독성이 좋도록 border-collapse, padding, line-height 등을 적절히 적용할 것',
    '- 긴 문장도 표 안에서 자연스럽게 줄바꿈되도록 할 것',
    '',
    '[대조 원칙]',
    '- 첨부 이미지를 직접 읽어 원문 지문을 파악할 것',
    '- 이미지에 실제로 보이는 범위 안에서만 원문을 재구성할 것',
    '- 문제 지문과 원문 지문을 문장 단위로 가장 자연스럽게 대응시킬 것',
    '- 대응되는 문장은 같은 번호로 맞출 것',
    '- 문제 지문에만 있는 문장, 원문 지문에만 있는 문장도 각각 독립 행으로 유지할 것',
    '- 어휘 변형, 삭제, 추가, 문장 분할/통합, 표현 완화/강화가 드러나게 정리할 것',
    '- 이미지 판독이 불명확한 부분은 추측하지 말 것',
    '',
    '[강조 방식]',
    '- 변형된 핵심 부분은 굵게 표시할 것',
    '- 동시에 밝은 색상으로 하이라이트할 것',
    '- mark 태그나 b 태그가 문자 그대로 보이지 않도록 처리할 것',
    '- 강조는 span style 방식으로 자연스럽게 렌더링되게 작성할 것',
    '',
    '[표 아래 추가 정리]',
    '- 표 아래에는 정보 박스를 다음 순서로 배치할 것:',
    '  1. 원문 변형 어휘',
    '  2. 원문 책 정보',
    '',
    '[원문 변형 어휘]',
    '- 표의 문장 대조에서 확인되는 핵심 변형 어휘/표현만 따로 뽑아 정리할 것',
    '- 단순히 같은 문장을 반복하지 말고, 실제로 바뀐 어휘·구·표현만 추려서 제시할 것',
    '- 반드시 다음 형식으로 제시할 것:',
    '  **[원문 어휘]**: [한글 뜻] (= [문제 어휘])',
    '- 예시:',
    '  **utilize**: 활용하다 (= use)',
    '  **rational faculty**: 이성적 능력 (= reasoning skill)',
    '  **realm**: 영역 (= area)',
    '  **perspective**: 관점 (= viewpoint)',
    '- 원문 어휘는 반드시 볼드체로 표시할 것',
    '- 명사와 동사는 반드시 원형(lemma)으로 표기할 것',
    '  - 명사는 가능하면 단수 원형으로',
    '  - 동사는 동사원형으로',
    '- 필요하면 형용사/부사도 불필요한 굴절형 없이 기본형으로 정리할 것',
    '- 원문 어휘와 문제 어휘가 구 단위 표현이면, 가능한 한 대응되는 핵심 표현의 기본형으로 정리할 것',
    '- 변형 어휘가 거의 없으면 ‘의미상 동일, 표현 차이 미미’라고 간단히 표시할 것',
    '- 이 항목은 ‘원문 참고 어휘’가 아니라, 반드시 ‘원문이 문제 지문에서 어떻게 변형되었는지’를 보여주는 용도로 작성할 것',
    '',
    '[원문 책 정보]',
    '- 제목, 저자, 검색 문구를 보기 좋게 정리할 것',
    '',
    '[기타]',
    '- 불필요한 설명 없이 HTML 코드 블록만 출력할 것',
    '- 미리보기 버튼으로 바로 렌더링 가능한 형태여야 할 것',
    '',
    '[문제 지문]',
    formatCopyAsParagraphs(passage),
    '',
    '[참고 정보]',
    `- Google Books 제목: ${title || '제목 정보 없음'}`,
    `- 저자: ${formatAuthors(authors)}`,
    `- 검색 문구: ${query || '검색 문구 없음'}`,
  ].join('\n');
}

async function fetchGoogleBooks(query: string): Promise<GoogleBookResult[]> {
  const response = await fetch(`/api/google-books-search?q=${encodeURIComponent(query)}&v=2`);

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

function getVisitorCounterDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VISITOR_COUNTER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getVisitorCounterStorageKey() {
  return `${VISITOR_COUNTER_STORAGE_PREFIX}:${getVisitorCounterDateKey()}`;
}

function formatVisitorStatsTimestamp(value: string, timezone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: timezone || VISITOR_COUNTER_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\.\s?/g, '-')
    .replace(/-\s/, ' ')
    .replace(/-$/, '');
}

function parseBatchInput(value: string): BatchInputItem[] {
  const seenIds = new Map<string, number>();

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => {
      if (index !== 0) return true;
      return !/^(지문\s*번호|번호|no\.?|id)\s*(\t|,)/i.test(line);
    })
    .map((line, index) => {
      const tabParts = line.split('\t').map((part) => part.trim()).filter(Boolean);

      let id = '';
      let text = '';

      if (tabParts.length >= 2) {
        [id] = tabParts;
        text = tabParts.slice(1).join(' ');
      } else {
        const matched = line.match(/^(.+?\d+\s*번)\s+(.+)$/);
        if (matched) {
          id = matched[1].trim();
          text = matched[2].trim();
        } else {
          id = `${index + 1}번`;
          text = line;
        }
      }

      const cleanId = id || `${index + 1}번`;
      const cleanText = sanitizeSearchQuery(text || line);
      const duplicateIndex = seenIds.get(cleanId) ?? 0;
      seenIds.set(cleanId, duplicateIndex + 1);

      return {
        id: duplicateIndex > 0 ? `${cleanId} (${duplicateIndex + 1})` : cleanId,
        text: cleanText,
      };
    })
    .filter((item) => item.text);
}

function scoreFallbackQueryWindow(words: string[]) {
  const uncommonWords = words.filter((word) => {
    const lower = word.toLowerCase();
    return !STOP_WORDS.has(lower) && lower.length >= 5;
  });
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  const averageLength = words.reduce((sum, word) => sum + word.length, 0) / Math.max(words.length, 1);
  const startsWithStopWord = STOP_WORDS.has(words[0]?.toLowerCase() ?? '');
  const endsWithStopWord = STOP_WORDS.has(words[words.length - 1]?.toLowerCase() ?? '');

  return uncommonWords.length * 3 + uniqueWords.size * 0.7 + averageLength - (startsWithStopWord ? 0.7 : 0) - (endsWithStopWord ? 0.7 : 0);
}

function normalizeExtractedSearchQuery(value: string) {
  const withoutPossessives = value.replace(/\b([A-Za-z]+)['’]s\b/g, '$1');
  return (withoutPossessives.replace(/['’]/g, '').match(/[A-Za-z0-9]+/g) ?? []).join(' ').trim();
}

function uniqueSearchQueries(queries: string[]) {
  return Array.from(
    new Map(
      queries
        .map(normalizeExtractedSearchQuery)
        .filter(Boolean)
        .map((query) => [query.toLowerCase(), query]),
    ).values(),
  );
}

function getPureSearchWordSegments(text: string) {
  return normalizeQuotes(stripHtml(text))
    .replace(/\b[A-Za-z0-9]+['’][A-Za-z0-9]+\b/g, ' | ')
    .split(/[^A-Za-z0-9\s]+/)
    .map((segment) => segment.match(/[A-Za-z0-9]+/g) ?? [])
    .filter((words) => words.length > 0);
}

function scorePureSearchWindow(words: string[], start: number, totalWords: number) {
  const uncommonWords = words.filter((word) => {
    const lower = word.toLowerCase();
    return !STOP_WORDS.has(lower) && lower.length >= 5;
  });
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  const averageLength = words.reduce((sum, word) => sum + word.length, 0) / Math.max(words.length, 1);
  const startsWithStopWord = STOP_WORDS.has(words[0]?.toLowerCase() ?? '');
  const endsWithStopWord = STOP_WORDS.has(words[words.length - 1]?.toLowerCase() ?? '');
  const edgePenalty = start === 0 || start + words.length === totalWords ? 0.35 : 0;

  return uncommonWords.length * 3 + uniqueWords.size * 0.7 + averageLength - (startsWithStopWord ? 0.7 : 0) - (endsWithStopWord ? 0.7 : 0) - edgePenalty;
}

function extractPureWordSearchQueries(
  text: string,
  {
    minWords,
    maxWords,
    limit,
  }: {
    minWords: number;
    maxWords: number;
    limit: number;
  },
) {
  const normalizedText = stripHtml(text).replace(/\s+/g, ' ').trim();
  const sentenceTexts = normalizedText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const pools = sentenceTexts.length > 0 ? sentenceTexts : [normalizedText];
  const wordSegments = pools.flatMap((pool) => getPureSearchWordSegments(pool));

  type Candidate = {
    text: string;
    tokens: string[];
    score: number;
  };

  const candidates: Candidate[] = [];

  wordSegments.forEach((words) => {
    for (let windowSize = maxWords; windowSize >= minWords; windowSize -= 1) {
      if (words.length < windowSize) continue;

      for (let start = 0; start <= words.length - windowSize; start += 1) {
        const windowWords = words.slice(start, start + windowSize);
        const uncommonCount = windowWords.filter((word) => {
          const lower = word.toLowerCase();
          return !STOP_WORDS.has(lower) && lower.length >= 5;
        }).length;

        if (uncommonCount < 2) {
          continue;
        }

        const textValue = normalizeExtractedSearchQuery(windowWords.join(' '));

        if (!textValue) {
          continue;
        }

        candidates.push({
          text: textValue,
          tokens: windowWords.map((word) => word.toLowerCase()),
          score: scorePureSearchWindow(windowWords, start, words.length),
        });
      }
    }
  });

  if (candidates.length === 0) {
    const fallbackWords = wordSegments
      .filter((words) => words.length >= minWords)
      .sort((left, right) => right.length - left.length)[0];
    const fallback = normalizeExtractedSearchQuery(fallbackWords?.slice(0, maxWords).join(' ') ?? '');
    return fallback ? [fallback] : [];
  }

  const deduped = Array.from(
    new Map(
      candidates
        .sort((a, b) => b.score - a.score)
        .map((candidate) => [candidate.text.toLowerCase(), candidate]),
    ).values(),
  );

  const selected: Candidate[] = [];
  const overlapRatio = (left: string[], right: string[]) => {
    const rightSet = new Set(right);
    const sharedCount = left.filter((token) => rightSet.has(token)).length;
    return sharedCount / Math.max(Math.min(left.length, right.length), 1);
  };

  for (const candidate of deduped) {
    const isTooSimilar = selected.some((picked) => {
      if (picked.text.toLowerCase().includes(candidate.text.toLowerCase())) return true;
      if (candidate.text.toLowerCase().includes(picked.text.toLowerCase())) return true;
      return overlapRatio(picked.tokens, candidate.tokens) >= 0.62;
    });

    if (!isTooSimilar) {
      selected.push(candidate);
    }

    if (selected.length >= limit) {
      break;
    }
  }

  return selected.map((candidate) => candidate.text);
}

function extractBatchSearchQueries(text: string) {
  const googleAttempts = extractPureWordSearchQueries(text, {
    minWords: BATCH_GOOGLE_QUERY_MIN_WORDS,
    maxWords: BATCH_GOOGLE_QUERY_MAX_WORDS,
    limit: MAX_GOOGLE_BATCH_QUERY_ATTEMPTS,
  });
  const worksheetAttempts = extractPureWordSearchQueries(text, {
    minWords: BATCH_WORKSHEET_QUERY_MIN_WORDS,
    maxWords: BATCH_WORKSHEET_QUERY_MAX_WORDS,
    limit: MAX_WORKSHEET_BATCH_QUERY_ATTEMPTS,
  });

  return {
    googleAttempts,
    worksheetAttempts,
    attempts: uniqueSearchQueries([...googleAttempts, ...worksheetAttempts]),
  };
}

function tokenizeForReview(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const matcher = /[A-Za-z0-9]+/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    tokens.push({
      value: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

function extractPhraseContext(text: string, phrase: string, displayRadius = 14, compareRadius = 8): PhraseContext {
  const tokens = tokenizeForReview(text);
  const phraseTokens = tokenizeForReview(phrase).map((token) => token.value);

  if (tokens.length === 0 || phraseTokens.length === 0 || tokens.length < phraseTokens.length) {
    return {
      text: '',
      before: [],
      after: [],
      found: false,
    };
  }

  let phraseStart = -1;

  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    const matches = phraseTokens.every((phraseToken, phraseIndex) => tokens[index + phraseIndex]?.value === phraseToken);

    if (matches) {
      phraseStart = index;
      break;
    }
  }

  if (phraseStart === -1) {
    return {
      text: '',
      before: [],
      after: [],
      found: false,
    };
  }

  const phraseEnd = phraseStart + phraseTokens.length;
  const displayStart = Math.max(0, phraseStart - displayRadius);
  const displayEnd = Math.min(tokens.length - 1, phraseEnd + displayRadius - 1);
  const rawContext = text.slice(tokens[displayStart].start, tokens[displayEnd].end).replace(/\s+/g, ' ').trim();

  return {
    text: `${displayStart > 0 ? '... ' : ''}${rawContext}${displayEnd < tokens.length - 1 ? ' ...' : ''}`,
    before: tokens.slice(Math.max(0, phraseStart - compareRadius), phraseStart).map((token) => token.value),
    after: tokens.slice(phraseEnd, Math.min(tokens.length, phraseEnd + compareRadius)).map((token) => token.value),
    found: true,
  };
}

function isUsefulReviewToken(token: string) {
  return token.length >= 4 && !STOP_WORDS.has(token) && !/^\d+$/.test(token);
}

function countSharedReviewTokens(left: string[], right: string[]) {
  const rightSet = new Set(right.filter(isUsefulReviewToken));
  return new Set(left.filter(isUsefulReviewToken).filter((token) => rightSet.has(token))).size;
}

function countUsefulReviewTokens(tokens: string[]) {
  return tokens.filter(isUsefulReviewToken).length;
}

function assessGoogleBookMatch(result: GoogleBookResult, sourceText: string, query: string): GoogleBookMatchReview {
  const sourceContext = extractPhraseContext(sourceText, query);
  const googleContext = extractPhraseContext(result.snippet || '', query);

  if (!sourceContext.found) {
    return {
      level: 'warning',
      label: '검색 문구 확인 필요',
      message: '입력 본문에서 선택된 검색 문구를 다시 찾지 못했습니다.',
      score: 1,
      sourceContext: sourceText.slice(0, 220),
      googleContext: result.snippet || 'Google Books 스니펫 없음',
    };
  }

  if (!result.snippet) {
    return {
      level: 'warning',
      label: '스니펫 확인 필요',
      message: 'Google Books가 주변 문맥 스니펫을 제공하지 않아 책 정보를 직접 열어 확인해야 합니다.',
      score: 2,
      sourceContext: sourceContext.text,
      googleContext: 'Google Books 스니펫 없음',
    };
  }

  if (!googleContext.found) {
    return {
      level: 'warning',
      label: '스니펫 확인 필요',
      message: 'Google Books 결과는 있었지만 스니펫에서 정확한 검색 문구를 확인하지 못했습니다.',
      score: 2,
      sourceContext: sourceContext.text,
      googleContext: result.snippet,
    };
  }

  const beforeOverlap = countSharedReviewTokens(sourceContext.before, googleContext.before);
  const afterOverlap = countSharedReviewTokens(sourceContext.after, googleContext.after);
  const sharedContextCount = beforeOverlap + afterOverlap;
  const comparableContextCount =
    countUsefulReviewTokens(sourceContext.before) +
    countUsefulReviewTokens(sourceContext.after) +
    countUsefulReviewTokens(googleContext.before) +
    countUsefulReviewTokens(googleContext.after);

  if (sharedContextCount >= 2) {
    return {
      level: 'match',
      label: '전후문맥 일부 일치',
      message: '검색 문구뿐 아니라 주변 단어도 입력 본문과 일부 겹칩니다.',
      score: 10 + sharedContextCount,
      sourceContext: sourceContext.text,
      googleContext: googleContext.text,
    };
  }

  if (sharedContextCount === 1 || comparableContextCount < 4) {
    return {
      level: 'warning',
      label: '추가 확인 권장',
      message: '검색 문구는 확인됐지만 주변 문맥 비교 근거가 충분하지 않습니다.',
      score: 5 + sharedContextCount,
      sourceContext: sourceContext.text,
      googleContext: googleContext.text,
    };
  }

  return {
    level: 'mismatch',
    label: '문맥 검토 필요',
    message: '검색 문구는 일치하지만 앞뒤 단어가 입력 본문과 거의 겹치지 않습니다.',
    score: 0,
    sourceContext: sourceContext.text,
    googleContext: googleContext.text,
  };
}

function rankGoogleResultsForSource(results: GoogleBookResult[], sourceText: string, query: string) {
  return [...results].sort((left, right) => {
    const leftScore = assessGoogleBookMatch(left, sourceText, query).score;
    const rightScore = assessGoogleBookMatch(right, sourceText, query).score;
    return rightScore - leftScore;
  });
}

function getReliableGoogleResults(results: GoogleBookResult[], sourceText: string, query: string) {
  return rankGoogleResultsForSource(results, sourceText, query).filter((result) => assessGoogleBookMatch(result, sourceText, query).score >= 5);
}

function getPassageContextPreview(text: string, query: string, displayRadius = 18) {
  const context = extractPhraseContext(text, query, displayRadius);

  if (context.found) {
    return context.text;
  }

  const cleanText = text.replace(/\s+/g, ' ').trim();
  return `${cleanText.slice(0, 260)}${cleanText.length > 260 ? '...' : ''}`;
}

function getGoogleReviewStyles(level: GoogleBookMatchReview['level']) {
  if (level === 'match') {
    return {
      box: 'bg-emerald-50 text-emerald-800',
      icon: 'text-emerald-600',
    };
  }

  if (level === 'warning') {
    return {
      box: 'bg-amber-50 text-amber-800',
      icon: 'text-amber-600',
    };
  }

  return {
    box: 'bg-rose-50 text-rose-800',
    icon: 'text-rose-600',
  };
}

function extractDistinctSearchQueries(text: string, limit = MAX_WORKSHEET_BATCH_QUERY_ATTEMPTS) {
  const enhancedQueries = uniqueSearchQueries(extractEnhancementQueries(text, ''));

  if (enhancedQueries.length > 0) {
    return enhancedQueries.slice(0, limit);
  }

  const words = (sanitizeSearchQuery(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).map((word) => word.trim());
  const candidates: Array<{ text: string; score: number; tokens: string[] }> = [];

  [7, 6, 5, 4].forEach((windowSize) => {
    if (words.length < windowSize) return;

    for (let start = 0; start <= words.length - windowSize; start += 1) {
      const windowWords = words.slice(start, start + windowSize);
      const uncommonCount = windowWords.filter((word) => {
        const lower = word.toLowerCase();
        return !STOP_WORDS.has(lower) && lower.length >= 5;
      }).length;

      if (uncommonCount < 2) {
        continue;
      }

      candidates.push({
        text: normalizeExtractedSearchQuery(windowWords.join(' ')),
        score: scoreFallbackQueryWindow(windowWords),
        tokens: windowWords.map((word) => word.toLowerCase()),
      });
    }
  });

  const selected: Array<{ text: string; tokens: string[] }> = [];
  const deduped = Array.from(
    new Map(
      candidates
        .sort((a, b) => b.score - a.score)
        .map((candidate) => [candidate.text.toLowerCase(), candidate]),
    ).values(),
  );

  const overlapRatio = (left: string[], right: string[]) => {
    const rightSet = new Set(right);
    const sharedCount = left.filter((token) => rightSet.has(token)).length;
    return sharedCount / Math.max(Math.min(left.length, right.length), 1);
  };

  for (const candidate of deduped) {
    const isTooSimilar = selected.some((picked) => {
      if (picked.text.toLowerCase().includes(candidate.text.toLowerCase())) return true;
      if (candidate.text.toLowerCase().includes(picked.text.toLowerCase())) return true;
      return overlapRatio(picked.tokens, candidate.tokens) >= 0.66;
    });

    if (!isTooSimilar) {
      selected.push(candidate);
    }

    if (selected.length >= limit) {
      break;
    }
  }

  if (selected.length > 0) {
    return selected.map((candidate) => candidate.text);
  }

  return uniqueSearchQueries([words.slice(0, Math.min(words.length, 8)).join(' ')]).filter(Boolean);
}

function createEmptyBatchResult(item: BatchInputItem): BatchSearchResult {
  return {
    ...item,
    status: 'idle',
    query: '',
    googleQuery: '',
    worksheetQuery: '',
    attempts: [],
    googleAttempts: [],
    worksheetAttempts: [],
    googleResults: [],
    googleError: '',
    worksheetResults: null,
    worksheetError: '',
  };
}

function GoogleBooksMiniResult({ result, query, sourceText }: { result?: GoogleBookResult; query: string; sourceText: string }) {
  if (!result) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-6 text-slate-500">후보가 없습니다.</p>
        {query && (
          <a href={buildGoogleBooksSearchUrl(query)} target="_blank" rel="noreferrer" className="inline-flex rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
            Google Books 원본 검색
          </a>
        )}
      </div>
    );
  }

  const review = assessGoogleBookMatch(result, sourceText, query);
  const reviewStyles = getGoogleReviewStyles(review.level);

  return (
    <div className="rounded-2xl border border-slate-200 p-3">
      <div className="flex gap-3">
        <div className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
          {result.thumbnail ? (
            <img
              src={result.thumbnail}
              alt={result.title}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <BookOpen size={18} className="text-slate-400" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="line-clamp-2 text-base font-semibold leading-6 text-slate-800">
              {highlightTextWithPatterns(result.title, [{ text: query, className: 'bg-amber-200/80' }])}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {result.authors.length > 0 ? result.authors.join(', ') : '저자 정보 없음'}
              {result.publishedDate ? ` · ${result.publishedDate}` : ''}
            </p>
          </div>
          {result.snippet && (
            <p className="line-clamp-4 text-sm leading-6 text-slate-600">
              {highlightTextWithPatterns(result.snippet, [{ text: query, className: 'bg-amber-200/80' }])}
            </p>
          )}
          <div className={`space-y-2 rounded-xl px-3 py-2 text-xs leading-5 ${reviewStyles.box}`}>
            <div className="flex items-start gap-2">
              {review.level === 'match' ? (
                <Check size={14} className={`mt-0.5 shrink-0 ${reviewStyles.icon}`} />
              ) : (
                <AlertCircle size={14} className={`mt-0.5 shrink-0 ${reviewStyles.icon}`} />
              )}
              <div>
                <p className="font-semibold">{review.label}</p>
                <p>{review.message}</p>
              </div>
            </div>
            <details>
              <summary className="cursor-pointer font-semibold">원문 / Google 스니펫 비교</summary>
              <div className="mt-2 space-y-2">
                <p>
                  <span className="font-semibold">입력 본문: </span>
                  {highlightTextWithPatterns(review.sourceContext, [{ text: query, className: 'bg-amber-200/80' }])}
                </p>
                <p>
                  <span className="font-semibold">Google: </span>
                  {highlightTextWithPatterns(review.googleContext, [{ text: query, className: 'bg-amber-200/80' }])}
                </p>
              </div>
            </details>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={buildGoogleBooksSearchUrl(query)} target="_blank" rel="noreferrer" className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
              Google Books 열기
            </a>
            <a href={result.previewLink || buildGoogleBooksSearchUrl(query)} target="_blank" rel="noreferrer" className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100">
              미리보기
            </a>
            <a href={result.infoLink || buildGoogleBooksSearchUrl(query)} target="_blank" rel="noreferrer" className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
              도서 정보
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorksheetMakerMiniResult({ result, query }: { result?: WorksheetResult; query: string }) {
  if (!result) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-6 text-slate-500">후보가 없습니다.</p>
        {query && (
          <button
            onClick={() => openWorksheetMakerSearch(query)}
            className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
          >
            WorksheetMaker 원본 검색
          </button>
        )}
      </div>
    );
  }

  const passagePreview = getPassageContextPreview(result.passage, query);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">영어 지문</p>
        <p className="text-sm leading-6 text-slate-700">{highlightTextWithPatterns(passagePreview, [{ text: query, className: 'bg-sky-200/85 text-sky-950' }])}</p>
      </div>
      {result.sourceLines.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">지문 출처</p>
          <ul className="space-y-1 text-sm text-slate-600">
            {result.sourceLines.slice(0, 3).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        onClick={() => openWorksheetMakerSearch(query)}
        className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
      >
        WorksheetMaker 전체 결과
      </button>
    </div>
  );
}

async function findBatchGoogleResult(attempts: string[], sourceText: string) {
  let googleError = '';
  let hadSuccessfulRequest = false;

  for (const query of attempts) {
    try {
      const googleResults = getReliableGoogleResults(await fetchGoogleBooks(query), sourceText, query);
      hadSuccessfulRequest = true;
      googleError = '';

      if (googleResults.length > 0) {
        return {
          query,
          results: googleResults,
          error: '',
        };
      }
    } catch {
      googleError = 'Google Books 결과를 불러오지 못했습니다.';
    }
  }

  return {
    query: '',
    results: [] as GoogleBookResult[],
    error: hadSuccessfulRequest ? '' : googleError,
  };
}

async function findBatchWorksheetResult(attempts: string[]) {
  let worksheetError = '';
  let hadSuccessfulRequest = false;
  let fallbackResults: WorksheetSearchResponse | null = null;

  for (const query of attempts) {
    if (countWords(query) < BATCH_WORKSHEET_QUERY_MIN_WORDS) {
      continue;
    }

    try {
      const worksheetResults = await fetchWorksheetMaker(query);
      hadSuccessfulRequest = true;
      worksheetError = '';
      fallbackResults = worksheetResults;

      if ((worksheetResults.resultCount ?? 0) > 0) {
        return {
          query,
          results: worksheetResults,
          error: '',
        };
      }
    } catch {
      worksheetError = 'WorksheetMaker 결과를 불러오지 못했습니다.';
    }
  }

  return {
    query: '',
    results: fallbackResults,
    error: hadSuccessfulRequest ? '' : worksheetError,
  };
}

function getBatchGoogleDisplayQuery(result: BatchSearchResult) {
  return result.googleQuery || result.googleAttempts[0] || result.query;
}

function getBatchWorksheetDisplayQuery(result: BatchSearchResult) {
  return result.worksheetQuery || result.worksheetAttempts[0] || result.query;
}

function BatchFinderApp() {
  const [rawInput, setRawInput] = useState('');
  const [results, setResults] = useState<BatchSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [copiedTistoryHtml, setCopiedTistoryHtml] = useState(false);

  const parsedItems = useMemo(() => parseBatchInput(rawInput), [rawInput]);
  const completedCount = results.filter((result) => result.status === 'done' || result.status === 'error').length;
  const tistoryHtml = useMemo(() => buildTistoryExportHtml(results), [results]);

  const updateResult = useCallback((id: string, updater: (result: BatchSearchResult) => BatchSearchResult) => {
    setResults((currentResults) => currentResults.map((result) => (result.id === id ? updater(result) : result)));
  }, []);

  const handleBatchSearch = useCallback(async () => {
    if (parsedItems.length === 0 || isSearching) {
      return;
    }

    setIsSearching(true);
    setResults(parsedItems.map(createEmptyBatchResult));

    for (const item of parsedItems) {
      const { googleAttempts, worksheetAttempts, attempts } = extractBatchSearchQueries(item.text);

      updateResult(item.id, (result) => ({
        ...result,
        status: 'searching',
        query: googleAttempts[0] ?? worksheetAttempts[0] ?? '',
        attempts,
        googleAttempts,
        worksheetAttempts,
      }));

      const [googleSearch, worksheetSearch] = await Promise.all([
        findBatchGoogleResult(googleAttempts, item.text),
        findBatchWorksheetResult(worksheetAttempts),
      ]);
      const selectedQuery = googleSearch.query || worksheetSearch.query || googleAttempts[0] || worksheetAttempts[0] || '';

      updateResult(item.id, (result) => ({
        ...result,
        status: googleSearch.error && worksheetSearch.error ? 'error' : 'done',
        query: selectedQuery,
        googleQuery: googleSearch.query,
        worksheetQuery: worksheetSearch.query,
        googleResults: googleSearch.results,
        googleError: googleSearch.error,
        worksheetResults: worksheetSearch.results,
        worksheetError: worksheetSearch.error,
      }));
    }

    setIsSearching(false);
  }, [isSearching, parsedItems, updateResult]);

  const handleCopyTistoryHtml = useCallback(async () => {
    if (!tistoryHtml || results.length === 0) return;

    await navigator.clipboard.writeText(tistoryHtml);
    setCopiedTistoryHtml(true);
    window.setTimeout(() => setCopiedTistoryHtml(false), 2000);
  }, [results.length, tistoryHtml]);

  const handleDownloadTistoryHtml = useCallback(() => {
    if (!tistoryHtml || results.length === 0) return;

    downloadHtmlFile(`english-finder-tistory-${new Date().toISOString().slice(0, 10)}.html`, tistoryHtml);
  }, [results.length, tistoryHtml]);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-900 font-sans selection:bg-indigo-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4 px-6 py-4">
          <a href={`${APP_HOME_URL}?mode=${ALL_MODE}`} className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-lg shadow-indigo-200">
              <BookOpen size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">English Source Finder All</h1>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Batch source search</p>
            </div>
          </a>
          <a href={APP_HOME_URL} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            단일 검색
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-6 py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-2xl font-bold text-slate-800">지문별 원문 일괄 검색</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              엑셀에서 지문번호와 본문 텍스트 두 열을 그대로 붙여넣으면, 각 지문에서 특징적인 검색 문구를 추출해 Google Books와 WorksheetMaker 후보를 함께 확인합니다.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label htmlFor="batch-input" className="text-sm font-semibold text-slate-700">지문번호 / 본문 텍스트 붙여넣기</label>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{parsedItems.length}개 지문 감지</span>
              </div>
              <textarea
                id="batch-input"
                value={rawInput}
                onChange={(event) => setRawInput(event.target.value)}
                className="h-56 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                placeholder={'[고3] 2026년 5월 - 18번\tDear Organizing Committee,...\n[고3] 2026년 5월 - 19번\tPaul was standing in front of...'}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500">
                  {results.length > 0 ? `${completedCount}/${results.length}개 처리 완료` : '각 지문당 최대 3개 특징 문구를 순차적으로 시도합니다.'}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => {
                      setRawInput('');
                      setResults([]);
                    }}
                    disabled={isSearching || (!rawInput && results.length === 0)}
                    className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    초기화
                  </button>
                  <button
                    onClick={handleBatchSearch}
                    disabled={parsedItems.length === 0 || isSearching}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isSearching ? <LoaderCircle size={18} className="animate-spin" /> : <Search size={18} />}
                    {isSearching ? '일괄 검색 중...' : '일괄 검색 시작'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {results.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 max-xl:hidden">
                <div className="px-3 py-3">지문번호</div>
                <div className="border-l border-slate-200 px-4 py-3">본문텍스트 / 검색 문구</div>
                <div className="border-l border-slate-200 px-4 py-3">Google Books</div>
                <div className="border-l border-slate-200 px-4 py-3">WorksheetMaker</div>
              </div>

              <div className="divide-y divide-slate-200">
                {results.map((result) => (
                  <article key={result.id} className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] max-xl:block">
                    <div className="px-3 py-4 text-center max-xl:border-b max-xl:border-slate-100">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 xl:hidden">지문번호</p>
                      <p className="mt-1 break-words text-sm font-semibold leading-6 text-slate-800">{result.id}</p>
                      <p className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                        {result.status === 'searching' ? '검색 중' : result.status === 'done' ? '완료' : result.status === 'error' ? '오류' : '대기'}
                      </p>
                    </div>

                    <div className="border-l border-slate-200 px-4 py-4 max-xl:border-l-0 max-xl:border-b max-xl:border-slate-100">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 xl:hidden">본문텍스트 / 검색 문구</p>
                      <div className="max-h-72 overflow-y-auto pr-1 text-sm leading-6 text-slate-700">
                        {result.query
                          ? highlightTextWithPatterns(result.text, [
                              { text: getBatchGoogleDisplayQuery(result), className: 'bg-amber-200/80' },
                              { text: getBatchWorksheetDisplayQuery(result), className: 'bg-sky-200/85 text-sky-950' },
                            ])
                          : result.text}
                      </div>
                      {result.query && (
                        <div className="mt-3 space-y-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5">
                          <p className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">
                            Google Books:{' '}
                            <span className="font-semibold">{getBatchGoogleDisplayQuery(result)}</span>
                          </p>
                          <p className="rounded-lg bg-sky-50 px-2 py-1 text-sky-800">
                            WorksheetMaker:{' '}
                            <span className="font-semibold">{getBatchWorksheetDisplayQuery(result)}</span>
                          </p>
                        </div>
                      )}
                      {(result.googleAttempts.length > 1 || result.worksheetAttempts.length > 1) && (
                        <details className="mt-2 text-xs text-slate-500">
                          <summary className="cursor-pointer">시도한 문구 Google {result.googleAttempts.length}개 / WorksheetMaker {result.worksheetAttempts.length}개</summary>
                          <p className="mt-2 font-semibold text-slate-600">Google Books</p>
                          <ul className="mt-1 space-y-1">
                            {result.googleAttempts.map((attempt) => (
                              <li key={`google-${attempt}`}>• {attempt}</li>
                            ))}
                          </ul>
                          <p className="mt-3 font-semibold text-slate-600">WorksheetMaker</p>
                          <ul className="mt-1 space-y-1">
                            {result.worksheetAttempts.map((attempt) => (
                              <li key={`worksheet-${attempt}`}>• {attempt}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>

                    <div className="border-l border-slate-200 px-4 py-4 max-xl:border-l-0 max-xl:border-b max-xl:border-slate-100">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 xl:hidden">Google Books</p>
                      {result.status === 'searching' ? (
                        <p className="inline-flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={14} className="animate-spin" /> 검색 중</p>
                      ) : result.googleError ? (
                        <p className="text-sm leading-6 text-rose-600">{result.googleError}</p>
                      ) : (
                        <GoogleBooksMiniResult result={result.googleResults[0]} query={getBatchGoogleDisplayQuery(result)} sourceText={result.text} />
                      )}
                    </div>

                    <div className="border-l border-slate-200 px-4 py-4 max-xl:border-l-0">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 xl:hidden">WorksheetMaker</p>
                        {result.worksheetResults && (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{result.worksheetResults.resultCount}건</span>
                        )}
                      </div>
                      {result.status === 'searching' ? (
                        <p className="inline-flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={14} className="animate-spin" /> 검색 중</p>
                      ) : result.worksheetError ? (
                        <p className="text-sm leading-6 text-rose-600">{result.worksheetError}</p>
                      ) : (
                        <WorksheetMakerMiniResult result={result.worksheetResults?.results[0]} query={getBatchWorksheetDisplayQuery(result)} />
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {results.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-slate-800">티스토리용 HTML</h3>
                  <p className="text-sm leading-6 text-slate-500">
                    티스토리 HTML 모드에 붙여넣기 좋게 카드형 HTML로 정리합니다. WorksheetMaker 열은 제외하고 지문번호, 본문텍스트/검색 문구, Google Books 결과만 포함합니다.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={handleCopyTistoryHtml}
                    disabled={results.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-100 transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {copiedTistoryHtml ? <Check size={16} /> : <Copy size={16} />}
                    {copiedTistoryHtml ? '복사됨' : 'HTML 복사'}
                  </button>
                  <button
                    onClick={handleDownloadTistoryHtml}
                    disabled={results.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <Download size={16} />
                    HTML 다운로드
                  </button>
                </div>
              </div>
              <textarea
                value={tistoryHtml}
                readOnly
                className="mt-4 h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-700 outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                aria-label="티스토리용 HTML 코드"
              />
            </section>
          )}
        </motion.div>
      </main>

      <Analytics />
    </div>
  );
}

function SingleFinderApp() {
  const initialUrlQueryRef = useRef('');
  const hasInitializedFromUrlRef = useRef(false);
  const [passage, setPassage] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  const [googleQueryUsed, setGoogleQueryUsed] = useState('');
  const [googleResults, setGoogleResults] = useState<GoogleBookResult[]>([]);
  const [worksheetResults, setWorksheetResults] = useState<WorksheetSearchResponse | null>(null);
  const [googleError, setGoogleError] = useState('');
  const [worksheetError, setWorksheetError] = useState('');
  const [worksheetNotice, setWorksheetNotice] = useState('');
  const [copiedFlowAction, setCopiedFlowAction] = useState('');
  const [visitorStats, setVisitorStats] = useState<VisitorStats | null>(null);

  const normalizedPassage = useMemo(() => sanitizeSearchQuery(passage), [passage]);
  const isFlowLlmMode = useMemo(() => getModeFromUrl() === FLOW_LLM_MODE, []);
  const worksheetWordCount = useMemo(() => countWords(passage), [passage]);
  const visitorStatsFormatter = useMemo(() => new Intl.NumberFormat('ko-KR'), []);

  useEffect(() => {
    if (hasInitializedFromUrlRef.current) return;
    hasInitializedFromUrlRef.current = true;

    const urlQuery = getQueryFromUrl();
    if (!urlQuery) return;

    initialUrlQueryRef.current = urlQuery;
    setPassage(urlQuery);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadVisitorStats = async () => {
      let shouldCountVisit = true;
      let storageKey = '';

      try {
        storageKey = getVisitorCounterStorageKey();
        shouldCountVisit = window.localStorage.getItem(storageKey) !== '1';
      } catch {
        shouldCountVisit = true;
      }

      const response = await fetch('/api/visitor-count', {
        method: shouldCountVisit ? 'POST' : 'GET',
        headers: shouldCountVisit ? { 'Content-Type': 'application/json' } : undefined,
        body: shouldCountVisit ? JSON.stringify({ countVisit: true }) : undefined,
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as VisitorStats;

      if (isCancelled || !data.enabled) {
        return;
      }

      setVisitorStats(data);

      if (shouldCountVisit && storageKey) {
        try {
          window.localStorage.setItem(storageKey, '1');
        } catch {
          // Ignore storage failures; the counter will still work as a visit counter.
        }
      }
    };

    void loadVisitorStats().catch((error) => {
      console.error('visitor stats error:', error);
    });

    return () => {
      isCancelled = true;
    };
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

    let nextGoogleResults: GoogleBookResult[] = [];
    let nextGoogleQuery = normalizedPassage;
    let nextWorksheetResults: WorksheetSearchResponse | null = null;
    let nextGoogleError = '';
    let nextWorksheetError = '';
    let nextWorksheetNotice = '';

    const googleTask = fetchGoogleBooks(normalizedPassage)
      .then((results) => {
        nextGoogleResults = getReliableGoogleResults(results, normalizedPassage, normalizedPassage);
      })
      .catch((error) => {
        console.error(error);
        nextGoogleError = 'Google Books 결과를 불러오지 못했습니다.';
      });

    let worksheetTask: Promise<void>;
    if (worksheetWordCount < MIN_WORKSHEET_WORDS) {
      nextWorksheetNotice = 'WorksheetMaker 검색은 연속된 3단어 이상일 때만 실행됩니다.';
      worksheetTask = Promise.resolve();
    } else {
      worksheetTask = fetchWorksheetMaker(normalizedPassage)
        .then((results) => {
          nextWorksheetResults = results;
        })
        .catch((error) => {
          console.error(error);
          nextWorksheetError = 'WorksheetMaker 결과를 불러오지 못했습니다.';
        });
    }

    await Promise.allSettled([googleTask, worksheetTask]);

    if (!nextGoogleError && nextGoogleResults.length === 0 && nextWorksheetResults?.results[0]?.passage) {
      const worksheetPassage = nextWorksheetResults.results[0].passage;
      const enhancementQueries = extractEnhancementQueries(worksheetPassage, normalizedPassage);

      for (const query of enhancementQueries.slice(0, MAX_ENHANCEMENT_RETRIES)) {
        try {
          const results = getReliableGoogleResults(await fetchGoogleBooks(query), worksheetPassage, query);

          if (results.length > 0) {
            nextGoogleResults = results;
            nextGoogleQuery = query;
            break;
          }
        } catch (error) {
          console.error(error);
        }
      }
    }

    setGoogleResults(nextGoogleResults);
    setGoogleQueryUsed(nextGoogleQuery);
    setWorksheetResults(nextWorksheetResults);
    setGoogleError(nextGoogleError);
    setWorksheetError(nextWorksheetError);
    setWorksheetNotice(nextWorksheetNotice);
    setIsSearching(false);
  }, [normalizedPassage, worksheetWordCount]);

  useEffect(() => {
    const pendingQuery = initialUrlQueryRef.current;

    if (!pendingQuery || normalizedPassage !== pendingQuery || isSearching) {
      return;
    }

    initialUrlQueryRef.current = '';
    void handleUnifiedSearch();
  }, [handleUnifiedSearch, isSearching, normalizedPassage]);

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
  const googleReviewSourceText = currentGoogleQuery !== lastQuery ? firstWorksheetResult?.passage ?? lastQuery : lastQuery;
  const flowLlmHelperVisible = isFlowLlmMode && !!firstWorksheetResult?.passage;
  const worksheetHighlightPatterns = useMemo(() => {
    const patterns: HighlightPattern[] = [];

    if (lastQuery) {
      patterns.push({ text: lastQuery, className: 'bg-sky-200/85 text-sky-950' });
    }

    return patterns;
  }, [lastQuery]);
  const googleHighlightPatterns = useMemo(() => {
    const patterns: HighlightPattern[] = [];

    if (currentGoogleQuery) {
      patterns.push({ text: currentGoogleQuery, className: 'bg-amber-200/80' });
    }

    return patterns;
  }, [currentGoogleQuery]);

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
          <a href={`${APP_HOME_URL}?mode=${ALL_MODE}`} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            일괄 검색
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

                  {!googleError && !isSearching && googleResults.length === 0 && lastQuery && (
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                      <p>표시할 Google Books 후보가 없습니다. 새 탭 버튼으로 원래 검색 페이지를 바로 열어 확인해보세요.</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    {googleResults.map((result) => {
                      const googleResultQuery = currentGoogleQuery || lastQuery;
                      const review = assessGoogleBookMatch(result, googleReviewSourceText || lastQuery || normalizedPassage, googleResultQuery);
                      const reviewStyles = getGoogleReviewStyles(review.level);

                      return (
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
                              <div className={`space-y-2 rounded-2xl px-4 py-3 text-xs leading-5 ${reviewStyles.box}`}>
                                <div className="flex items-start gap-2">
                                  {review.level === 'match' ? (
                                    <Check size={14} className={`mt-0.5 shrink-0 ${reviewStyles.icon}`} />
                                  ) : (
                                    <AlertCircle size={14} className={`mt-0.5 shrink-0 ${reviewStyles.icon}`} />
                                  )}
                                  <div>
                                    <p className="font-semibold">{review.label}</p>
                                    <p>{review.message}</p>
                                  </div>
                                </div>
                                <details>
                                  <summary className="cursor-pointer font-semibold">원문 / Google 스니펫 비교</summary>
                                  <div className="mt-2 space-y-2">
                                    <p>
                                      <span className="font-semibold">입력 본문: </span>
                                      {highlightTextWithPatterns(review.sourceContext, [{ text: googleResultQuery, className: 'bg-amber-200/80' }])}
                                    </p>
                                    <p>
                                      <span className="font-semibold">Google: </span>
                                      {highlightTextWithPatterns(review.googleContext, [{ text: googleResultQuery, className: 'bg-amber-200/80' }])}
                                    </p>
                                  </div>
                                </details>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <a
                                  href={buildGoogleBooksSearchUrl(googleResultQuery)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                                >
                                  Google Books 열기
                                </a>
                                <a
                                  href={result.previewLink || buildGoogleBooksSearchUrl(googleResultQuery)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100"
                                >
                                  미리보기
                                </a>
                                <a
                                  href={result.infoLink || buildGoogleBooksSearchUrl(googleResultQuery)}
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
                      );
                    })}
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
                            <p className="text-sm leading-7 text-slate-700">
                              {highlightTextWithPatterns(formatDisplayParagraph(result.passage), worksheetHighlightPatterns)}
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
                              <p className="mt-3 leading-7">{formatDisplayParagraph(result.translationPreview)}</p>
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
        {visitorStats && (
          <section className="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>Total {visitorStatsFormatter.format(visitorStats.total)}</span>
            <span aria-hidden="true">·</span>
            <span>Today {visitorStatsFormatter.format(visitorStats.today)}</span>
            <span aria-hidden="true">·</span>
            <span>Yesterday {visitorStatsFormatter.format(visitorStats.yesterday)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatVisitorStatsTimestamp(visitorStats.updatedAt, visitorStats.timezone)}</span>
          </section>
        )}
        <p>
          © 2026{' '}
          <a href={FLOW_BLOG_URL} target="_blank" rel="noreferrer" className={BRAND_LINK_CLASS}>
            Flow 영어연구소
          </a>
          . All rights reserved.
        </p>
      </footer>
      <Analytics />
    </div>
  );
}

export default function App() {
  return getModeFromUrl() === ALL_MODE ? <BatchFinderApp /> : <SingleFinderApp />;
}
