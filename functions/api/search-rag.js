/**
 * Cloudflare Pages Function — RAG 스타일 검색
 * POST /api/search-rag
 *
 * Body: { query, pageType?, topK?, apiKey }
 * Returns: { results: Array<{ page_type, main_title, tone_and_manner, keywords, visual_vibe,
 *            layout_feature, color_palette_feel, file_name, file_url, similarity }> }
 */

// 메타데이터와 임베딩은 프론트엔드에서 로드하여 전달
// Worker에서는 쿼리 임베딩 생성만 담당

export async function onRequestPost(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };

    try {
        const { query, pageType, topK = 3, apiKey } = await context.request.json();

        const key = apiKey || context.env.GOOGLE_API_KEY;
        if (!key) {
            return new Response(JSON.stringify({ error: 'API 키가 설정되지 않았습니다.' }), {
                status: 401,
                headers: corsHeaders,
            });
        }

        if (!query) {
            return new Response(JSON.stringify({ error: '검색 쿼리가 필요합니다.' }), {
                status: 400,
                headers: corsHeaders,
            });
        }

        // 쿼리 임베딩 생성 (Google text-embedding-004)
        const embedRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'models/text-embedding-004',
                    content: { parts: [{ text: query.substring(0, 1000) }] },
                    taskType: 'RETRIEVAL_QUERY',
                }),
            }
        );

        if (!embedRes.ok) {
            const errText = await embedRes.text();
            let errorMsg = `임베딩 생성 실패 (${embedRes.status})`;
            try {
                const errJson = JSON.parse(errText);
                errorMsg = errJson?.error?.message || errorMsg;
            } catch {}
            return new Response(JSON.stringify({ error: errorMsg }), {
                status: 502,
                headers: corsHeaders,
            });
        }

        const embedData = await embedRes.json();
        const queryEmbedding = embedData?.embedding?.values;

        if (!queryEmbedding) {
            return new Response(JSON.stringify({ error: '임베딩을 생성하지 못했습니다.' }), {
                status: 502,
                headers: corsHeaders,
            });
        }

        return new Response(JSON.stringify({ embedding: queryEmbedding }), {
            status: 200,
            headers: corsHeaders,
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders,
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
