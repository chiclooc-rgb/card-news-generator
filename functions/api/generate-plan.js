/**
 * Cloudflare Pages Function — 기획안 생성
 * POST /api/generate-plan
 *
 * Body: { content, detailLevel, ragExamples?, apiKey }
 * Returns: { structure_type, estimated_tone, plan: { cover, body[], outro }, design_concepts[] }
 */

export async function onRequestPost(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };

    try {
        const { content, detailLevel, ragExamples, apiKey } = await context.request.json();

        if (!content) {
            return new Response(JSON.stringify({ error: '원고 내용이 필요합니다.' }), {
                status: 400,
                headers: corsHeaders,
            });
        }

        const key = apiKey || context.env.GOOGLE_API_KEY;
        if (!key) {
            return new Response(JSON.stringify({ error: 'API 키가 설정되지 않았습니다.' }), {
                status: 401,
                headers: corsHeaders,
            });
        }

        const isDetailed = detailLevel === 'detailed';

        // RAG 레퍼런스 예시 텍스트 구성
        let exampleText = '예시 없음';
        if (ragExamples && Array.isArray(ragExamples) && ragExamples.length > 0) {
            exampleText = ragExamples.map(ex => JSON.stringify({
                page_type: ex.page_type,
                main_title: ex.main_title,
                tone_and_manner: ex.tone_and_manner,
                visual_vibe: ex.visual_vibe,
                layout_feature: ex.layout_feature,
                color_palette_feel: ex.color_palette_feel,
            })).join('\n');
        }

        // 구조 및 내용 지시사항
        const structureInstr = isDetailed
            ? '1. **구조 판단:** 내용이 단순하면 SINGLE, 복잡하면 MULTI 구조로 판단하세요.'
            : '1. **구조 판단:** 내용을 최대한 압축하여 SINGLE(1장) 또는 간단한 MULTI로 제한하세요.';
        const contentInstr = isDetailed
            ? '2. **내용 요약:** 핵심 정보를 누락 없이 요약하세요.'
            : '2. **내용 요약:** 매우 간단하고 임팩트 있게 요약하세요.';

        const prompt = `당신은 광양시청 홍보팀 수석 카드뉴스 기획자입니다.
제공된 공고문을 정밀하게 분석하세요.

[참고할 스타일 예시]
${exampleText}

[분석할 공고문]
${content.substring(0, 8000)}

[지시사항]
${structureInstr}
${contentInstr}
3. **출력 형식:** 반드시 아래 JSON 형식으로만 출력하세요.

{
  "structure_type": "MULTI",
  "plan": {
    "cover": { "main_title": "...", "sub_title": "..." },
    "body": [ { "page": 1, "summary": ["핵심 메시지 1", "핵심 메시지 2"] } ],
    "outro": { "contact": "문의처 정보" }
  },
  "estimated_tone": "톤앤매너 설명",
  "design_concepts": [
    {"name": "컨셉 1 이름", "description": "컨셉 1 설명 (색상, 분위기, 레이아웃 스타일 등)"},
    {"name": "컨셉 2 이름", "description": "컨셉 2 설명"},
    {"name": "컨셉 3 이름", "description": "컨셉 3 설명"}
  ]
}`;

        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4096,
                        responseMimeType: 'application/json',
                    },
                }),
            }
        );

        if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            let errorMsg = `Gemini API 오류 (${geminiRes.status})`;
            try {
                const errJson = JSON.parse(errText);
                errorMsg = errJson?.error?.message || errorMsg;
            } catch {}
            return new Response(JSON.stringify({ error: errorMsg }), {
                status: 502,
                headers: corsHeaders,
            });
        }

        const geminiData = await geminiRes.json();
        const textContent = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textContent) {
            return new Response(JSON.stringify({ error: 'Gemini 응답이 비어있습니다.' }), {
                status: 502,
                headers: corsHeaders,
            });
        }

        const planData = JSON.parse(textContent);

        return new Response(JSON.stringify(planData), {
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
