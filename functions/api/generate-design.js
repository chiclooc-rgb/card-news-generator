/**
 * Cloudflare Pages Function — 디자인 이미지 생성
 * POST /api/generate-design
 *
 * Body: { pageType, content, concept, aspectRatio, feedback?, refImages?, coverColorPalette?, apiKey }
 * Returns: { imageUrl: string (base64 data URL), pageType }
 */

// 큰 ArrayBuffer도 안전하게 base64 변환 (spread operator 스택 오버플로우 방지)
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

export async function onRequestPost(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };

    try {
        const { pageType, content, concept, aspectRatio, feedback, refImages, coverColorPalette, apiKey } = await context.request.json();

        const key = apiKey || context.env.GOOGLE_API_KEY;
        if (!key) {
            return new Response(JSON.stringify({ error: 'API 키가 설정되지 않았습니다.' }), {
                status: 401,
                headers: corsHeaders,
            });
        }

        // 비율에 따른 크기 설정
        const sizeMap = {
            '4:5': { w: 1080, h: 1350 },
            '1:1': { w: 1080, h: 1080 },
            '9:16': { w: 1080, h: 1920 },
        };
        const size = sizeMap[aspectRatio] || sizeMap['4:5'];
        const ratio = aspectRatio || '4:5';

        // 컨텐츠를 텍스트로 변환
        let contentText = '';
        if (typeof content === 'object') {
            contentText = JSON.stringify(content, null, 2);
        } else {
            contentText = String(content);
        }

        const conceptName = concept?.name || '';
        const conceptDesc = concept?.description || '';

        // ─── 프롬프트 구성 (기존 Streamlit 앱과 동일한 구조) ───
        const promptParts = [];

        // 역할 및 기본 지시
        promptParts.push('당신은 전문 카드뉴스 디자이너입니다.');
        promptParts.push(`제공된 참조 이미지들의 스타일과 레이아웃을 반영하여, 아래 텍스트 내용을 담은 새로운 카드뉴스 이미지를 만들어주세요.`);

        // 금지사항
        promptParts.push("**[🚨 금지사항]** 공식 '광양시 심볼마크(로고)'와 '광양시' 텍스트가 결합된 형태(CI 시그니처)를 절대 그리지 마세요. 로고와 지자체 명칭이 결합된 공식 표시는 레퍼런스에 있어도 반드시 제거하세요. 단, 본문 내용상 '광양시'라는 텍스트 자체를 일반 글자로 사용하는 것은 허용됩니다.");

        // 페이지 타입
        promptParts.push(`페이지 타입: ${pageType}`);

        // 색상 팔레트 통일 (COVER가 아닌 경우)
        if (pageType !== 'COVER' && coverColorPalette) {
            promptParts.push(`**[색상 팔레트 통일]** 반드시 다음 색상 팔레트를 유지하세요: '${coverColorPalette}'`);
        }

        // 필수 지시사항
        promptParts.push('**[필수 지시사항]**');
        promptParts.push('1. 텍스트는 반드시 한글이 깨지지 않게 크고 명확하게 배치해야 합니다.');
        promptParts.push('2. 모든 페이지는 일관된 톤앤매너를 유지합니다.');
        promptParts.push(`3. **이미지 비율은 반드시 '${ratio}'**여야 합니다.`);
        promptParts.push(`4. 다음 내용을 포함하세요: ${contentText}`);
        promptParts.push("5. **[중요] '심볼마크(로고) + 광양시' 조합의 공식 표시는 절대 포함하지 마세요.** 일반 텍스트로서의 '광양시' 사용은 가능합니다.");

        // 디자인 컨셉 적용
        if (conceptName) {
            promptParts.push(`**[디자인 컨셉]** 스타일: ${conceptName}, 설명: ${conceptDesc}`);
        }

        // 사용자 피드백 (재생성 시)
        if (feedback) {
            promptParts.push(`**[사용자 특별 지시사항]**\n${feedback}`);
            promptParts.push('위 사용자의 구체적인 요청 사항을 최우선적으로 디자인에 반영하십시오.');
        }

        // 매돌이 캐릭터 감지
        const hasMaedori = contentText.includes('매돌이');
        let maedoriImagePart = null;

        if (hasMaedori) {
            // Supabase에서 매돌이 이미지 가져오기
            try {
                const maedoriUrl = 'https://liqozdnssagjotfbdibo.supabase.co/storage/v1/object/public/cardnews/assets/maedori_character.png';
                const imgRes = await fetch(maedoriUrl);
                if (imgRes.ok) {
                    const imgBuf = await imgRes.arrayBuffer();
                    const imgBase64 = arrayBufferToBase64(imgBuf);
                    maedoriImagePart = {
                        inlineData: {
                            mimeType: 'image/png',
                            data: imgBase64,
                        }
                    };
                    promptParts.push("**[🚨 매우 중요 - 위 이미지는 광양시 공식 마스코트 '매돌이' 입니다]**");
                    promptParts.push('**필수 규칙:**');
                    promptParts.push('1. 위에 제공된 매돌이 이미지를 **정확히 복사**하여 디자인에 포함하세요.');
                    promptParts.push('2. 매돌이의 색상, 생김새, 표정, 포즈를 **절대 변경하지 마세요**.');
                    promptParts.push('3. 새로운 캐릭터를 만들거나, 비슷한 캐릭터로 대체하는 것은 **절대 금지**입니다.');
                    promptParts.push('4. 제공된 이미지를 **그대로 복사-붙여넣기** 하듯이 사용하세요.');
                }
            } catch (e) {
                // 매돌이 이미지 로드 실패 시 무시
            }
        }

        // ─── 멀티모달 요청 구성 ───
        const parts = [];

        // 레퍼런스 이미지 추가 (Supabase URL에서 가져옴)
        if (refImages && Array.isArray(refImages)) {
            for (const refUrl of refImages.slice(0, 2)) {
                try {
                    const imgRes = await fetch(refUrl);
                    if (imgRes.ok) {
                        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                        const imgBuf = await imgRes.arrayBuffer();
                        const imgBase64 = arrayBufferToBase64(imgBuf);
                        parts.push({
                            inlineData: {
                                mimeType: contentType,
                                data: imgBase64,
                            }
                        });
                    }
                } catch (e) {
                    // 이미지 로드 실패 시 무시
                }
            }
        }

        // 매돌이 이미지 추가
        if (maedoriImagePart) {
            parts.push(maedoriImagePart);
        }

        // 텍스트 프롬프트 추가
        parts.push({ text: promptParts.join('\n') });

        // Gemini 이미지 생성 호출 (gemini-3-pro-image-preview — Streamlit과 동일)
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        responseModalities: ['TEXT', 'IMAGE'],
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
        const responseParts = geminiData?.candidates?.[0]?.content?.parts || [];

        // 이미지 파트 찾기
        let imageUrl = null;
        for (const part of responseParts) {
            if (part.inlineData) {
                imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                break;
            }
        }

        if (!imageUrl) {
            return new Response(JSON.stringify({ error: '이미지가 생성되지 않았습니다.', parts: responseParts.map(p => Object.keys(p)) }), {
                status: 502,
                headers: corsHeaders,
            });
        }

        return new Response(JSON.stringify({ imageUrl, pageType }), {
            status: 200,
            headers: corsHeaders,
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
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
