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

  const url =
    'https://www.googleapis.com/books/v1/volumes?' +
    new URLSearchParams({
      q: `"${query}"`,
      maxResults: '5',
      langRestrict: 'en',
      printType: 'books',
      key: apiKey,
    }).toString();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Google Books 요청에 실패했습니다.',
      });
    }

    const results = (data.items || []).map((item) => {
      const viewability = item.accessInfo?.viewability || 'UNKNOWN';
      const accessViewStatus = item.accessInfo?.accessViewStatus || 'NONE';
      const previewAvailable =
        ['PARTIAL', 'ALL_PAGES'].includes(viewability) ||
        ['SAMPLE', 'FULL_PUBLIC_DOMAIN'].includes(accessViewStatus);

      return {
        id: item.id,
        title: item.volumeInfo?.title || '제목 없음',
        authors: item.volumeInfo?.authors || [],
        publishedDate: item.volumeInfo?.publishedDate,
        thumbnail: item.volumeInfo?.imageLinks?.thumbnail,
        previewLink: item.volumeInfo?.previewLink,
        infoLink: item.volumeInfo?.infoLink,
        snippet: String(item.searchInfo?.textSnippet || '')
          .replace(/<[^>]+>/g, '')
          .trim(),
        viewability,
        accessViewStatus,
        previewAvailable,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      query,
      resultCount: results.length,
      results,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Google Books 검색 중 오류가 발생했습니다.',
    });
  }
}
