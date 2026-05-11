export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const query = String(req.query.q || '').trim();

  if (!query) {
    return res.status(400).json({ error: '검색어가 비어 있습니다.' });
  }

  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

  try {
    const searchResponse = await requestGoogleBooks({
      query,
      apiKey,
      exactOnly: req.query.mode === 'exact' || req.query.exact === '1',
    });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      query,
      searchMode: searchResponse.searchMode,
      resultCount: searchResponse.results.length,
      results: searchResponse.results,
    });
  } catch (error) {
    const quotaExceeded = isGoogleBooksQuotaError(error);

    return res.status(quotaExceeded ? 429 : 500).json({
      error: error instanceof Error ? error.message : 'Google Books 검색 중 오류가 발생했습니다.',
      code: quotaExceeded ? 'google-books-quota-exceeded' : 'google-books-error',
    });
  }
}

async function requestGoogleBooks({ query, apiKey, exactOnly = false }) {
  let exactResults = [];

  try {
    exactResults = await requestGoogleBooksApiWithPublicFallback({
      apiKey,
      searchQuery: `"${query}"`,
    });
  } catch (error) {
    if (!isRecoverableGoogleBooksError(error)) {
      throw error;
    }
    exactResults = [];
  }

  if (exactResults.length > 0) {
    return {
      searchMode: 'exact',
      results: exactResults,
    };
  }

  if (exactOnly) {
    return {
      searchMode: 'exact',
      results: [],
    };
  }

  let broadResults = [];

  try {
    broadResults = await requestGoogleBooksApiWithPublicFallback({
      apiKey,
      searchQuery: query,
    });
  } catch (error) {
    if (!isRecoverableGoogleBooksError(error)) {
      throw error;
    }
    broadResults = [];
  }

  return {
    searchMode: broadResults.length > 0 ? 'broad-fallback' : 'exact',
    results: broadResults,
  };
}

async function requestGoogleBooksApiWithPublicFallback({ searchQuery, apiKey }) {
  let primaryError = null;

  if (apiKey) {
    try {
      const keyedResults = await requestGoogleBooksApi({
        apiKey,
        searchQuery,
      });

      if (keyedResults.length > 0) {
        return keyedResults;
      }
    } catch (error) {
      primaryError = error;
    }
  }

  try {
    return await requestGoogleBooksApi({
      searchQuery,
    });
  } catch (error) {
    if (primaryError) {
      throw primaryError;
    }
    throw error;
  }
}

async function requestGoogleBooksApi({ searchQuery, apiKey }) {
  const params = new URLSearchParams({
    q: searchQuery,
    maxResults: '5',
    langRestrict: 'en',
    printType: 'books',
  });

  if (apiKey) {
    params.set('key', apiKey);
  }

  const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || 'Google Books 요청에 실패했습니다.');
  }

  return (data.items || []).map((item) => {
    const viewability = item.accessInfo?.viewability || 'UNKNOWN';
    const accessViewStatus = item.accessInfo?.accessViewStatus || 'NONE';
    const webReaderLink = item.accessInfo?.webReaderLink;
    const publicDomain = Boolean(item.accessInfo?.publicDomain);
    const previewLink = item.volumeInfo?.previewLink;
    const previewAvailable =
      accessViewStatus === 'FULL_PUBLIC_DOMAIN' ||
      (publicDomain && viewability === 'ALL_PAGES' && Boolean(webReaderLink) && Boolean(previewLink));

    return {
      id: item.id,
      title: item.volumeInfo?.title || '제목 없음',
      authors: item.volumeInfo?.authors || [],
      publishedDate: item.volumeInfo?.publishedDate,
      thumbnail: item.volumeInfo?.imageLinks?.thumbnail,
      previewLink,
      infoLink: item.volumeInfo?.infoLink,
      webReaderLink,
      snippet: String(item.searchInfo?.textSnippet || '')
        .replace(/<[^>]+>/g, '')
        .trim(),
      viewability,
      accessViewStatus,
      previewAvailable,
    };
  });
}

function isRecoverableGoogleBooksError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('temporarily unavailable') || message.includes('backend error') || message.includes('internal error');
}

function isGoogleBooksQuotaError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('quota exceeded') || message.includes('rate limit') || message.includes('resource_exhausted');
}
