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
  if (!apiKey) {
    return res.status(500).json({ error: 'Vercel 환경변수 GOOGLE_BOOKS_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    let searchResponse = await requestGoogleBooks({ query, apiKey, exact: true });

    if (searchResponse.results.length === 0) {
      searchResponse = await requestGoogleBooks({ query, apiKey, exact: false });
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      query,
      searchMode: searchResponse.searchMode,
      resultCount: searchResponse.results.length,
      results: searchResponse.results,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Google Books 검색 중 오류가 발생했습니다.',
    });
  }
}

async function requestGoogleBooks({ query, apiKey, exact }) {
  const url =
    'https://www.googleapis.com/books/v1/volumes?' +
    new URLSearchParams({
      q: exact ? `"${query}"` : query,
      maxResults: '5',
      langRestrict: 'en',
      printType: 'books',
      key: apiKey,
    }).toString();

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || 'Google Books 요청에 실패했습니다.');
  }

  return {
    searchMode: exact ? 'exact' : 'broad',
    results: (data.items || []).map((item) => {
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
    }),
  };
}
