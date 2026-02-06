/* ═══════════════════════════════════════════
   API Client — Cloudflare Workers 연동
   ═══════════════════════════════════════════ */

const API = {
    baseUrl: '',  // Same origin (Cloudflare Pages Functions)

    /**
     * 기획안 생성 API 호출
     */
    async generatePlan({ content, detailLevel, apiKey }) {
        const res = await fetch(`${this.baseUrl}/api/generate-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, detailLevel, apiKey }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    },

    /**
     * 디자인 이미지 생성 API 호출
     */
    async generateDesign({ pageType, content, concept, aspectRatio, feedback, apiKey }) {
        const res = await fetch(`${this.baseUrl}/api/generate-design`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageType, content, concept, aspectRatio, feedback, apiKey }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    },

    /**
     * RAG 스타일 검색 API 호출
     */
    async searchRAG({ query, pageType, topK, apiKey }) {
        const res = await fetch(`${this.baseUrl}/api/search-rag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, pageType, topK, apiKey }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    },
};
