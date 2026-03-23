const WORKSHEET_URL = 'https://www.worksheetmaker.co.kr/user20/dataTexts/list.do';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const query = String(req.query.q ?? '').trim();
  if (!query) {
    res.status(400).json({ error: '검색어가 비어 있습니다.' });
    return;
  }

  try {
    const cookie = await bootstrapWorksheetMakerCookie();
    const html = await requestWorksheetMakerSearch(query, cookie);
    const parsed = parseWorksheetMakerHtml(html);

    res.status(200).json({
      query,
      resultCount: parsed.resultCount,
      results: parsed.results,
    });
  } catch (error) {
    console.error('worksheetmaker-search error:', error);
    res.status(500).json({
      error: 'WorksheetMaker 결과를 가져오지 못했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function bootstrapWorksheetMakerCookie() {
  const response = await fetch(WORKSHEET_URL, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': DEFAULT_USER_AGENT,
    },
  });

  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    return '';
  }

  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((cookiePart) => cookiePart.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function requestWorksheetMakerSearch(query, cookie) {
  const body = new URLSearchParams({ searchText: query });

  const response = await fetch(WORKSHEET_URL, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://www.worksheetmaker.co.kr',
      Referer: WORKSHEET_URL,
      'User-Agent': DEFAULT_USER_AGENT,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`WorksheetMaker request failed with ${response.status}`);
  }

  return response.text();
}

function parseWorksheetMakerHtml(html) {
  const countMatch = html.match(/총\s*<span>(\d+)<\/span>개\s*검색/i);
  const tableSections = html.split(/<table class="tb_mt_0">/i).slice(1);

  const results = tableSections
    .map((section) => {
      const rank = Number(section.match(/<tr>\s*<th>(\d+)<\/th>/i)?.[1] ?? 0);
      const passage = normalizeWhitespace(decodeHtml(extractTableCell(section, '영어 지문')));
      const translationPreview = normalizeWhitespace(
        decodeHtml(removeOverlay(extractTableCell(section, '해석'))),
      );
      const sourceLines = normalizeWhitespace(decodeHtml(extractTableCell(section, '지문출처')))
        .split('\n')
        .map((line) => line.replace(/^[-•]\s*/, '').trim())
        .filter(Boolean);

      return {
        rank,
        passage,
        translationPreview,
        sourceLines,
      };
    })
    .filter((result) => result.passage || result.sourceLines.length > 0);

  return {
    resultCount: Number(countMatch?.[1] ?? results.length),
    results,
  };
}

function extractTableCell(section, heading) {
  const pattern = new RegExp(
    `<tr>\\s*<th>${escapeRegex(heading)}<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>\\s*<\\/tr>`,
    'i',
  );
  return section.match(pattern)?.[1] ?? '';
}

function removeOverlay(value) {
  return value.replace(/<div class="modal_table">[\s\S]*?<\/div>/i, '');
}

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#10;/gi, '\n')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function normalizeWhitespace(value) {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
