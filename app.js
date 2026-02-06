/* ═══════════════════════════════════════════
   CARD NEWS GENERATOR — Frontend Logic
   SPA Routing, UI Interactions, Queue System
   ═══════════════════════════════════════════ */

const App = {
    // ─── STATE ───
    state: {
        currentTab: 'step1',
        uploadedFile: null,
        fileContent: null,
        planData: null,
        isEditingPlan: false,
        designConcepts: [],
        selectedConcept: null,
        aspectRatio: '4:5',
        generatedImages: [],
        queue: [],
        isProcessingQueue: false,
        stats: { files: 0, plans: 0, images: 0 },
        logs: [],
        galleryView: 'grid',
        // RAG DB
        ragMeta: null,       // 카드뉴스 메타데이터 (1668개)
        ragEmbeddings: null,  // 양자화 임베딩 데이터
        ragLoaded: false,
        coverColorPalette: null,  // COVER 색상 팔레트 (BODY/OUTRO 전달용)
        sharedBodyRefs: null,     // BODY 공유 레퍼런스
    },

    // ─── INIT ───
    init() {
        this.loadState();
        this.bindEvents();
        this.initRouting();
        this.updateTabIndicator();
        this.updateStats();
        this.renderQueue();
        this.renderGallery();
        this.loadRagDB();
        this.addLog('시스템 준비 완료');
    },

    // ─── RAG DB LOADING ───
    async loadRagDB() {
        try {
            this.addLog('스타일 DB 로드 중...');
            const [metaRes, embRes] = await Promise.all([
                fetch('/data/cardnews_meta.json'),
                fetch('/data/embeddings_q8.json'),
            ]);
            if (metaRes.ok && embRes.ok) {
                this.state.ragMeta = await metaRes.json();
                this.state.ragEmbeddings = await embRes.json();
                this.state.ragLoaded = true;
                this.addLog(`스타일 DB 로드 완료: ${this.state.ragMeta.length}개 레퍼런스`);
            } else {
                this.addLog('스타일 DB 로드 실패 (파일 없음)');
            }
        } catch (e) {
            this.addLog(`스타일 DB 로드 오류: ${e.message}`);
        }
    },

    // ─── RAG SEARCH (클라이언트 사이드 코사인 유사도) ───
    decodeQuantizedEmbedding(entry) {
        const bytes = atob(entry.data);
        const arr = new Float32Array(bytes.length);
        const range = entry.max - entry.min;
        for (let i = 0; i < bytes.length; i++) {
            arr[i] = (bytes.charCodeAt(i) / 255) * range + entry.min;
        }
        return arr;
    },

    cosineSimilarity(a, b) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    },

    async searchRag(queryText, pageType = null, topK = 3) {
        if (!this.state.ragLoaded) return [];

        const apiKey = localStorage.getItem('cngen_api_key');
        if (!apiKey) return [];

        try {
            // Worker를 통해 쿼리 임베딩 생성
            const res = await fetch('/api/search-rag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: queryText, apiKey }),
            });

            if (!res.ok) return [];
            const { embedding } = await res.json();
            if (!embedding) return [];

            const queryVec = new Float32Array(embedding);

            // 코사인 유사도 계산
            const scores = [];
            for (let i = 0; i < this.state.ragMeta.length; i++) {
                const meta = this.state.ragMeta[i];
                if (pageType && meta.page_type?.toUpperCase() !== pageType.toUpperCase()) continue;

                const entryVec = this.decodeQuantizedEmbedding(this.state.ragEmbeddings[i]);
                const sim = this.cosineSimilarity(queryVec, entryVec);
                scores.push({ index: i, similarity: sim });
            }

            // 상위 결과 중 랜덤 샘플 (Streamlit과 동일한 방식)
            scores.sort((a, b) => b.similarity - a.similarity);
            const poolSize = Math.min(scores.length, pageType ? 100 : 15);
            const pool = scores.slice(0, poolSize);
            const selected = [];
            const used = new Set();
            const sampleSize = Math.min(pool.length, topK);
            while (selected.length < sampleSize) {
                const randIdx = Math.floor(Math.random() * pool.length);
                if (!used.has(randIdx)) {
                    used.add(randIdx);
                    selected.push(this.state.ragMeta[pool[randIdx].index]);
                }
            }
            return selected;
        } catch (e) {
            this.addLog(`RAG 검색 오류: ${e.message}`);
            return [];
        }
    },

    // ─── PERSISTENCE ───
    loadState() {
        const key = localStorage.getItem('cngen_api_key');
        if (key) {
            document.getElementById('api-key-input').value = key;
        }
        const stats = localStorage.getItem('cngen_stats');
        if (stats) {
            try { this.state.stats = JSON.parse(stats); } catch(e) {}
        }
        // 이미지는 base64로 크기가 크므로 localStorage에 저장하지 않음 (세션 메모리만 사용)
        localStorage.removeItem('cngen_images'); // 기존 데이터 정리
    },

    saveStats() {
        localStorage.setItem('cngen_stats', JSON.stringify(this.state.stats));
    },

    saveImages() {
        // base64 이미지는 localStorage 용량 제한(5MB) 초과 → 메모리에만 보관
        // 세션 종료 시 갤러리 초기화됨 (다운로드로 보존 가능)
    },

    // ─── ROUTING ───
    initRouting() {
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();
    },

    handleRoute() {
        const hash = window.location.hash.replace('#', '') || 'step1';
        const validTabs = ['step1', 'step2', 'gallery'];
        const tab = validTabs.includes(hash) ? hash : 'step1';
        this.switchTab(tab);
    },

    switchTab(tab) {
        this.state.currentTab = tab;

        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Update panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `panel-${tab}`);
        });

        this.updateTabIndicator();
    },

    updateTabIndicator() {
        const activeBtn = document.querySelector('.tab-btn.active');
        const indicator = document.querySelector('.tab-indicator');
        if (activeBtn && indicator) {
            indicator.style.left = activeBtn.offsetLeft + 'px';
            indicator.style.width = activeBtn.offsetWidth + 'px';
        }
    },

    // ─── EVENTS ───
    bindEvents() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                window.location.hash = btn.dataset.tab;
            });
        });

        // File upload
        const dropzone = document.getElementById('hero-dropzone');
        const fileInput = document.getElementById('file-input');
        const ctaBtn = document.getElementById('btn-upload-cta');

        ctaBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });

        dropzone.addEventListener('click', () => fileInput.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) this.handleFileUpload(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleFileUpload(e.target.files[0]);
        });

        // File remove
        document.getElementById('file-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeFile();
        });

        // API Key
        document.getElementById('btn-save-key').addEventListener('click', () => {
            const key = document.getElementById('api-key-input').value.trim();
            if (key) {
                localStorage.setItem('cngen_api_key', key);
                this.showToast('success', 'API 키 저장', 'Google API 키가 저장되었습니다.');
                this.addLog('API 키 저장됨');
            } else {
                this.showToast('error', '오류', 'API 키를 입력해주세요.');
            }
        });

        document.getElementById('btn-toggle-key').addEventListener('click', () => {
            const input = document.getElementById('api-key-input');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        // Generate plan
        document.getElementById('btn-generate-plan').addEventListener('click', () => this.generatePlan());

        // Plan edit/save
        document.getElementById('btn-edit-plan').addEventListener('click', () => this.enterEditMode());
        document.getElementById('btn-save-edit').addEventListener('click', () => this.savePlanEdit());
        document.getElementById('btn-cancel-edit').addEventListener('click', () => this.cancelPlanEdit());
        document.getElementById('btn-add-page').addEventListener('click', () => this.addBodyPage());

        // Go to step 2
        document.getElementById('btn-goto-step2').addEventListener('click', () => {
            window.location.hash = 'step2';
        });

        // Aspect ratio
        document.querySelectorAll('.ratio-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.ratio-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                this.state.aspectRatio = card.dataset.ratio;
            });
        });

        // Generate design
        document.getElementById('btn-generate-design').addEventListener('click', () => this.startDesignGeneration());

        // Gallery view toggle
        document.getElementById('btn-grid-view').addEventListener('click', () => {
            this.state.galleryView = 'grid';
            document.getElementById('btn-grid-view').classList.add('active');
            document.getElementById('btn-list-view').classList.remove('active');
            document.getElementById('gallery-grid').classList.remove('list-view');
        });

        document.getElementById('btn-list-view').addEventListener('click', () => {
            this.state.galleryView = 'list';
            document.getElementById('btn-list-view').classList.add('active');
            document.getElementById('btn-grid-view').classList.remove('active');
            document.getElementById('gallery-grid').classList.add('list-view');
        });

        // Queue actions
        document.getElementById('btn-pause-queue').addEventListener('click', () => this.pauseQueue());
        document.getElementById('btn-clear-queue').addEventListener('click', () => this.clearQueue());

        // Sidebar toggle (mobile)
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        // Close sidebar on content click (mobile)
        document.querySelector('.content').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
        });

        // Modal close on overlay click
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeModal();
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (document.getElementById('lightbox')) {
                    this.closeLightbox();
                } else {
                    this.closeModal();
                }
            }
        });

        // Resize
        window.addEventListener('resize', () => this.updateTabIndicator());
    },

    // ─── FILE UPLOAD ───
    async handleFileUpload(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['txt', 'pdf'].includes(ext)) {
            this.showToast('error', '지원하지 않는 형식', 'TXT 또는 PDF 파일만 지원합니다.');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.showToast('error', '파일 크기 초과', '10MB 이하의 파일만 업로드할 수 있습니다.');
            return;
        }

        this.state.uploadedFile = file;
        this.addLog(`파일 업로드: ${file.name} (${this.formatFileSize(file.size)})`);

        // Read file content
        if (ext === 'txt') {
            try {
                const text = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('파일 읽기 실패'));
                    reader.readAsText(file, 'UTF-8');
                });
                this.state.fileContent = text;
                this.addLog(`텍스트 파일 읽기 완료: ${text.length}자`);
            } catch (e) {
                this.showToast('error', '파일 오류', '파일을 읽을 수 없습니다.');
                return;
            }
        } else if (ext === 'pdf') {
            // PDF: pdf.js로 텍스트 추출
            try {
                this.addLog('PDF 텍스트 추출 중...');
                const arrayBuffer = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('파일 읽기 실패'));
                    reader.readAsArrayBuffer(file);
                });

                // pdf.js CDN 로드 (최초 1회)
                if (!window.pdfjsLib) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                        script.onload = resolve;
                        script.onerror = () => reject(new Error('PDF 라이브러리 로드 실패'));
                        document.head.appendChild(script);
                    });
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }

                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }

                this.state.fileContent = fullText.trim();
                this.addLog(`PDF 텍스트 추출 완료: ${this.state.fileContent.length}자 (${pdf.numPages}페이지)`);

                if (this.state.fileContent.length < 10) {
                    this.showToast('warning', '텍스트 부족', 'PDF에서 텍스트가 거의 추출되지 않았습니다. 이미지 기반 PDF일 수 있습니다.');
                }
            } catch (e) {
                this.showToast('error', 'PDF 오류', `PDF를 읽을 수 없습니다: ${e.message}`);
                return;
            }
        } else {
            this.showToast('error', '지원하지 않는 형식', 'TXT 또는 PDF 파일만 지원합니다.');
            return;
        }

        // Update UI — show file inside dropzone
        const fileIcon = document.getElementById('file-icon');
        const fileName = document.getElementById('file-name');

        fileIcon.className = 'file-icon ' + ext;
        fileIcon.textContent = ext.toUpperCase();
        fileName.textContent = file.name;

        document.getElementById('dropzone-default').hidden = true;
        document.getElementById('dropzone-uploaded').hidden = false;

        // Show step1 ready state
        document.getElementById('step1-empty').hidden = true;
        document.getElementById('step1-ready').hidden = false;

        this.state.stats.files++;
        this.updateStats();
        this.saveStats();

        this.showToast('success', '파일 업로드 완료', `${file.name}이(가) 업로드되었습니다.`);
    },

    removeFile() {
        this.state.uploadedFile = null;
        this.state.fileContent = null;
        document.getElementById('dropzone-default').hidden = false;
        document.getElementById('dropzone-uploaded').hidden = true;
        document.getElementById('step1-empty').hidden = false;
        document.getElementById('step1-ready').hidden = true;
        document.getElementById('step1-result').hidden = true;
        document.getElementById('file-input').value = '';
        this.addLog('파일 제거됨');
    },

    // ─── PLAN GENERATION ───
    async generatePlan() {
        const apiKey = localStorage.getItem('cngen_api_key');
        if (!apiKey) {
            this.showToast('error', 'API 키 필요', '사이드바에서 Google API 키를 먼저 설정해주세요.');
            return;
        }

        if (!this.state.fileContent) {
            this.showToast('error', '파일 필요', '파일을 먼저 업로드해주세요.');
            return;
        }

        const detailLevel = document.querySelector('input[name="detail-level"]:checked').value;

        // Show loading
        document.getElementById('step1-ready').hidden = true;
        document.getElementById('step1-loading').hidden = false;
        this.addLog(`기획안 생성 시작... (상세도: ${detailLevel})`);

        try {
            // RAG 검색으로 유사한 스타일 예시 가져오기
            let ragExamples = [];
            if (this.state.ragLoaded) {
                this.addLog('RAG 검색 중...');
                ragExamples = await this.searchRag(this.state.fileContent.substring(0, 500), null, 3);
                this.addLog(`RAG 검색 완료: ${ragExamples.length}개 참조`);
            }

            const response = await fetch('/api/generate-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: this.state.fileContent,
                    detailLevel,
                    ragExamples,
                    apiKey,
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            this.state.planData = data;
            this.addLog('기획안 생성 완료!');
            this.state.stats.plans++;
            this.updateStats();
            this.saveStats();

            this.renderPlan();
            document.getElementById('step1-loading').hidden = true;
            document.getElementById('step1-result').hidden = false;

            // Enable step 2
            document.getElementById('step2-empty').hidden = true;
            document.getElementById('step2-ready').hidden = false;
            this.generateDesignConcepts();

            this.showToast('success', '기획안 완료', '카드뉴스 기획안이 성공적으로 생성되었습니다.');

        } catch (err) {
            this.addLog(`기획안 생성 실패: ${err.message}`);
            document.getElementById('step1-loading').hidden = true;
            document.getElementById('step1-ready').hidden = false;

            // Show specific error, then fallback to demo
            if (err.message.includes('API key') || err.message.includes('API_KEY')) {
                this.showToast('error', 'API 키 오류', 'Google API 키가 유효하지 않습니다. 키를 확인해주세요.');
            } else {
                this.showToast('info', '데모 모드', `API 호출 실패 (${err.message}). 샘플 기획안을 표시합니다.`);
            }
            this.state.planData = this.getSamplePlan();
            this.state.stats.plans++;
            this.updateStats();
            this.saveStats();
            this.renderPlan();
            document.getElementById('step1-loading').hidden = true;
            document.getElementById('step1-result').hidden = false;
            document.getElementById('step2-empty').hidden = true;
            document.getElementById('step2-ready').hidden = false;
            this.generateDesignConcepts();
        }
    },

    getSamplePlan() {
        return {
            structure_type: 'MULTI',
            estimated_tone: '친근하고 따뜻한',
            plan: {
                cover: {
                    main_title: '광양시와 함께하는 건강한 봄',
                    sub_title: '시민 건강 캠페인 안내'
                },
                body: [
                    { summary: ['봄철 건강관리의 중요성', '면역력 강화를 위한 생활 습관'] },
                    { summary: ['광양시 무료 건강검진 일정', '4월~5월 주요 프로그램 안내'] },
                    { summary: ['건강한 식단 구성 팁', '제철 재료 활용 레시피'] },
                ],
                outro: {
                    cta: '광양시 보건소에서 무료 건강검진을 받아보세요!',
                    contact: '문의: 061-797-1234'
                }
            }
        };
    },

    renderPlan() {
        const plan = this.state.planData?.plan;
        if (!plan) return;

        // Cover
        document.getElementById('plan-main-title').textContent = plan.cover?.main_title || '';
        document.getElementById('plan-sub-title').textContent = plan.cover?.sub_title || '';

        // Body
        const bodyContainer = document.getElementById('plan-body-sections');
        bodyContainer.innerHTML = '';
        (plan.body || []).forEach((page, i) => {
            const section = document.createElement('div');
            section.className = 'plan-section';
            section.style.animationDelay = `${(i + 1) * 0.05}s`;

            const summary = Array.isArray(page.summary) ? page.summary.join('\n') : String(page.summary || '');
            section.innerHTML = `
                <div class="plan-section-tag tag-body">BODY ${i + 1}</div>
                <p class="plan-body-text">${summary.replace(/\n/g, '<br>')}</p>
            `;
            bodyContainer.appendChild(section);
        });

        // Outro
        const outroContainer = document.getElementById('plan-outro-content');
        const outro = plan.outro;
        if (outro && typeof outro === 'object') {
            outroContainer.innerHTML = Object.entries(outro)
                .map(([k, v]) => `<p class="plan-body-text"><strong>${k}:</strong> ${v}</p>`)
                .join('');
        }
    },

    // ─── PLAN EDITING ───
    enterEditMode() {
        this.state.isEditingPlan = true;
        document.getElementById('plan-view').hidden = true;
        document.getElementById('plan-edit').hidden = false;

        const plan = this.state.planData?.plan;
        if (!plan) return;

        document.getElementById('edit-main-title').value = plan.cover?.main_title || '';
        document.getElementById('edit-sub-title').value = plan.cover?.sub_title || '';

        this.renderEditBodyPages();
        this.renderEditOutro();
    },

    renderEditBodyPages() {
        const container = document.getElementById('edit-body-pages');
        const body = this.state.planData?.plan?.body || [];
        container.innerHTML = '';

        body.forEach((page, i) => {
            const summary = Array.isArray(page.summary) ? page.summary.join('\n') : String(page.summary || '');
            const div = document.createElement('div');
            div.className = 'body-page-edit';
            div.innerHTML = `
                <div class="body-page-header">
                    <span class="body-page-num">페이지 ${i + 1}</span>
                    <button class="btn-remove-page" data-idx="${i}">삭제</button>
                </div>
                <textarea class="form-input body-page-textarea" data-idx="${i}" rows="3">${summary}</textarea>
            `;
            container.appendChild(div);
        });

        // Bind remove buttons
        container.querySelectorAll('.btn-remove-page').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                this.state.planData.plan.body.splice(idx, 1);
                this.renderEditBodyPages();
            });
        });
    },

    renderEditOutro() {
        const container = document.getElementById('edit-outro-fields');
        const outro = this.state.planData?.plan?.outro || {};
        container.innerHTML = '';

        Object.entries(outro).forEach(([key, value]) => {
            const div = document.createElement('div');
            div.style.marginBottom = '8px';
            div.innerHTML = `
                <input type="text" class="form-input outro-field" data-key="${key}" value="${value}" placeholder="${key}">
            `;
            container.appendChild(div);
        });
    },

    addBodyPage() {
        if (!this.state.planData?.plan?.body) return;
        this.state.planData.plan.body.push({ summary: ['새 페이지 내용을 입력하세요'] });
        this.renderEditBodyPages();
        this.addLog('새 본문 페이지 추가');
    },

    savePlanEdit() {
        const plan = this.state.planData.plan;
        plan.cover.main_title = document.getElementById('edit-main-title').value;
        plan.cover.sub_title = document.getElementById('edit-sub-title').value;

        // Body pages
        document.querySelectorAll('.body-page-textarea').forEach((textarea, i) => {
            const lines = textarea.value.split('\n').filter(l => l.trim());
            if (plan.body[i]) {
                plan.body[i].summary = lines;
            }
        });

        // Outro
        const outro = {};
        document.querySelectorAll('.outro-field').forEach(input => {
            outro[input.dataset.key] = input.value;
        });
        plan.outro = outro;

        this.state.isEditingPlan = false;
        document.getElementById('plan-view').hidden = false;
        document.getElementById('plan-edit').hidden = true;
        this.renderPlan();
        this.showToast('success', '저장 완료', '기획안이 수정되었습니다.');
        this.addLog('기획안 수정 저장됨');
    },

    cancelPlanEdit() {
        this.state.isEditingPlan = false;
        document.getElementById('plan-view').hidden = false;
        document.getElementById('plan-edit').hidden = true;
    },

    // ─── DESIGN CONCEPTS ───
    generateDesignConcepts() {
        // API에서 받은 design_concepts 사용, 없으면 기본값
        const apiConcepts = this.state.planData?.design_concepts;
        if (apiConcepts && Array.isArray(apiConcepts) && apiConcepts.length > 0) {
            this.state.designConcepts = apiConcepts.map((c, i) => ({
                id: `concept-${i}`,
                name: c.name,
                desc: c.description || c.desc || '',
            }));
            this.addLog(`AI가 ${apiConcepts.length}개 디자인 컨셉을 제안했습니다.`);
        } else {
            this.state.designConcepts = [
                { id: 'modern', name: '모던 클린', desc: '깔끔한 여백과 미니멀 타이포그래피' },
                { id: 'warm', name: '따뜻한 일러스트', desc: '부드러운 색감과 손그림 느낌' },
                { id: 'bold', name: '볼드 그래픽', desc: '강렬한 색상 대비와 큰 텍스트' },
            ];
        }

        const grid = document.getElementById('concept-grid');
        grid.innerHTML = '';

        this.state.designConcepts.forEach((concept, i) => {
            const card = document.createElement('div');
            card.className = 'concept-card';
            if (i === 0) card.classList.add('selected');
            card.dataset.id = concept.id;
            card.innerHTML = `
                <div class="concept-name">${concept.name}</div>
                <div class="concept-desc">${concept.desc}</div>
            `;
            card.addEventListener('click', () => {
                grid.querySelectorAll('.concept-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.state.selectedConcept = concept;
            });
            grid.appendChild(card);
        });

        this.state.selectedConcept = this.state.designConcepts[0];
    },

    // ─── DESIGN GENERATION ───
    async startDesignGeneration() {
        if (!this.state.planData) {
            this.showToast('error', '기획안 필요', '기획안을 먼저 생성해주세요.');
            return;
        }

        // 이전 큐 & 상태 초기화
        this.state.queue = [];
        this.state.isProcessingQueue = false;
        this.state.coverColorPalette = null;
        this.state.sharedBodyRefs = null;
        this.state.generatedImages = [];
        this.saveImages();
        this.renderQueue();
        this.renderGallery();

        const plan = this.state.planData.plan;
        const pages = [];

        // Build page list
        if (plan.cover) {
            pages.push({ type: 'COVER', content: plan.cover });
        }
        (plan.body || []).forEach((page, i) => {
            pages.push({ type: 'BODY', index: i + 1, content: page });
        });
        if (plan.outro) {
            pages.push({ type: 'OUTRO', content: plan.outro });
        }

        this.addLog(`디자인 생성 페이지: ${pages.map(p => p.type).join(' → ')} (총 ${pages.length}장)`);

        // Add to queue
        pages.forEach((page, i) => {
            this.addToQueue({
                type: 'GENERATE',
                pageIdx: i,
                pageType: page.type,
                pageLabel: page.type === 'BODY' ? `본문 ${page.index}` : page.type === 'COVER' ? '표지' : '마무리',
                content: page.content,
                status: 'pending',
            });
        });

        // Show progress
        document.getElementById('design-progress-card').hidden = false;
        this.renderDesignPages(pages);
        this.processQueue();
    },

    renderDesignPages(pages) {
        const container = document.getElementById('design-pages-list');
        container.innerHTML = '';

        pages.forEach((page, i) => {
            const label = page.type === 'BODY' ? `본문 ${page.index}` : page.type === 'COVER' ? '표지' : '마무리';
            const item = document.createElement('div');
            item.className = 'design-page-item';
            item.id = `design-page-${i}`;
            item.innerHTML = `
                <div class="design-page-thumb">
                    <span class="thumb-placeholder">${page.type}</span>
                </div>
                <div class="design-page-info">
                    <div class="design-page-type">${page.type}</div>
                    <div class="design-page-label">${label}</div>
                    <div class="design-page-status">대기 중</div>
                </div>
                <div class="design-page-actions">
                    <button class="btn-sm btn-ghost" onclick="App.openRegenDialog(${i}, '${page.type}', '${label}')" style="display:none" data-regen>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        재생성
                    </button>
                </div>
            `;
            container.appendChild(item);
        });
    },

    // ─── QUEUE SYSTEM ───
    addToQueue(task) {
        task.id = Date.now() + Math.random();
        task.addedAt = new Date().toLocaleTimeString('ko-KR');
        this.state.queue.push(task);
        this.renderQueue();
        document.getElementById('queue-actions').hidden = false;
        this.addLog(`대기열 추가: ${task.type} - ${task.pageLabel}`);
    },

    renderQueue() {
        const list = document.getElementById('queue-list');
        if (this.state.queue.length === 0) {
            list.innerHTML = '<div class="queue-empty">대기 중인 작업 없음</div>';
            document.getElementById('queue-actions').hidden = true;
            return;
        }

        list.innerHTML = this.state.queue.map(task => `
            <div class="queue-item">
                <span class="queue-dot ${task.status}"></span>
                <span class="queue-item-label">${task.pageLabel} (${task.type})</span>
            </div>
        `).join('');
    },

    async processQueue() {
        if (this.state.isProcessingQueue) return;
        this.state.isProcessingQueue = true;

        const apiKey = localStorage.getItem('cngen_api_key');
        const tone = this.state.planData?.estimated_tone || '친근한';

        while (this.state.queue.length > 0) {
            const task = this.state.queue.find(t => t.status === 'pending');
            if (!task) break;

            task.status = 'processing';
            this.renderQueue();
            this.updateDesignPageStatus(task.pageIdx, '생성 중...', true);
            this.addLog(`생성 시작: ${task.pageLabel}`);

            // RAG 레퍼런스 이미지 검색
            let refImages = [];
            if (this.state.ragLoaded) {
                try {
                    if (task.pageType === 'BODY' && this.state.sharedBodyRefs) {
                        // BODY는 공유 레퍼런스 재사용
                        refImages = this.state.sharedBodyRefs;
                        this.addLog(`BODY 공유 레퍼런스 ${refImages.length}개 재사용`);
                    } else {
                        const query = `${tone} 느낌의 ${task.pageType} 디자인`;
                        const refs = await this.searchRag(query, task.pageType, 2);
                        refImages = refs.filter(r => r.file_url).map(r => r.file_url);
                        if (task.pageType === 'BODY' && refImages.length > 0) {
                            this.state.sharedBodyRefs = refImages; // BODY 레퍼런스 공유
                        }
                        this.addLog(`RAG 레퍼런스 ${refImages.length}개 검색됨 (${task.pageType})`);
                    }
                } catch (e) {
                    this.addLog(`RAG 검색 스킵: ${e.message}`);
                }
            }

            try {
                const response = await fetch('/api/generate-design', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pageType: task.pageType,
                        content: task.content,
                        concept: this.state.selectedConcept,
                        aspectRatio: this.state.aspectRatio,
                        feedback: task.feedback || null,
                        refImages,
                        coverColorPalette: this.state.coverColorPalette,
                        apiKey,
                    }),
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `HTTP ${response.status}`);
                }

                const data = await response.json();
                task.status = 'completed';

                // COVER 생성 완료 시 색상 팔레트 저장 (BODY/OUTRO에서 사용)
                if (task.pageType === 'COVER') {
                    const coverRef = this.state.ragMeta?.find(m =>
                        refImages.some(url => url === m.file_url) && m.color_palette_feel
                    );
                    if (coverRef) {
                        this.state.coverColorPalette = coverRef.color_palette_feel;
                        this.addLog(`색상 팔레트 저장: ${coverRef.color_palette_feel}`);
                    }
                }

                this.updateDesignPageStatus(task.pageIdx, '완료', false, data.imageUrl);
                this.state.generatedImages.push({
                    id: task.id,
                    url: data.imageUrl,
                    type: task.pageType,
                    label: task.pageLabel,
                    createdAt: new Date().toISOString(),
                });
                this.state.stats.images++;
                this.updateStats();
                this.saveStats();
                this.saveImages();
                this.renderGallery();

            } catch (err) {
                this.addLog(`생성 실패 (${task.pageLabel}): ${err.message}`);
                task.status = 'completed';

                // API 키 에러인 경우 명확한 토스트
                if (err.message.includes('API key') || err.message.includes('API_KEY') || err.message.includes('지원되지 않')) {
                    this.showToast('error', 'API 오류', err.message);
                }

                // Demo: create placeholder image
                const demoUrl = this.createDemoImage(task.pageType, task.pageLabel);
                this.updateDesignPageStatus(task.pageIdx, '실패 (데모)', false, demoUrl);
                this.state.generatedImages.push({
                    id: task.id,
                    url: demoUrl,
                    type: task.pageType,
                    label: task.pageLabel,
                    createdAt: new Date().toISOString(),
                });
                this.state.stats.images++;
                this.updateStats();
                this.saveStats();
                this.saveImages();
                this.renderGallery();
            }

            // Remove completed task from queue
            this.state.queue = this.state.queue.filter(t => t.status !== 'completed');
            this.renderQueue();
            this.updateProgressBar();

            // Small delay between tasks
            await this.delay(500);
        }

        this.state.isProcessingQueue = false;
        if (this.state.queue.length === 0) {
            this.showToast('success', '생성 완료', '모든 디자인 이미지가 생성되었습니다.');
            this.addLog('전체 디자인 생성 완료!');
            this.showDownloadAllButton();
        }
    },

    createDemoImage(type, label) {
        const canvas = document.createElement('canvas');
        const ratio = this.state.aspectRatio;
        let w = 400, h = 500;
        if (ratio === '1:1') { w = 400; h = 400; }
        else if (ratio === '9:16') { w = 360; h = 640; }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // Background gradient
        const grad = ctx.createLinearGradient(0, 0, w, h);
        if (type === 'COVER') {
            grad.addColorStop(0, '#2D1B4E');
            grad.addColorStop(1, '#4A2D7A');
        } else if (type === 'OUTRO') {
            grad.addColorStop(0, '#4A2D7A');
            grad.addColorStop(1, '#7C3AED');
        } else {
            grad.addColorStop(0, '#F7F8FA');
            grad.addColorStop(1, '#E5E8EB');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Text
        ctx.fillStyle = type === 'BODY' ? '#1A1E27' : '#FFFFFF';
        ctx.font = '600 20px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, w / 2, h / 2 - 10);
        ctx.font = '400 14px -apple-system, sans-serif';
        ctx.fillStyle = type === 'BODY' ? '#888D96' : 'rgba(255,255,255,0.6)';
        ctx.fillText('데모 이미지', w / 2, h / 2 + 20);

        return canvas.toDataURL('image/png');
    },

    updateDesignPageStatus(pageIdx, statusText, loading, imageUrl) {
        const item = document.getElementById(`design-page-${pageIdx}`);
        if (!item) return;

        const status = item.querySelector('.design-page-status');
        if (loading) {
            status.innerHTML = `<span class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>${statusText}`;
        } else {
            status.textContent = statusText;
        }

        if (imageUrl) {
            const thumb = item.querySelector('.design-page-thumb');
            thumb.innerHTML = `<img src="${imageUrl}" alt="">`;
            thumb.style.cursor = 'pointer';
            thumb.onclick = () => this.openLightbox(imageUrl, statusText);
            const regenBtn = item.querySelector('[data-regen]');
            if (regenBtn) regenBtn.style.display = '';
        }
    },

    updateProgressBar() {
        const total = document.querySelectorAll('.design-page-item').length;
        const completed = document.querySelectorAll('.design-page-item .design-page-status').length;
        let doneCount = 0;
        document.querySelectorAll('.design-page-status').forEach(el => {
            if (el.textContent.includes('완료') || el.textContent.includes('실패')) doneCount++;
        });

        const pct = total > 0 ? (doneCount / total) * 100 : 0;
        document.getElementById('design-progress-bar').style.width = pct + '%';
        document.getElementById('progress-text').textContent = `${doneCount} / ${total} 페이지 생성 완료`;
    },

    showDownloadAllButton() {
        const container = document.getElementById('design-pages-list');
        if (!container) return;

        // 기존 다운로드 버튼 제거
        const existing = container.querySelector('.download-all-bar');
        if (existing) existing.remove();

        const bar = document.createElement('div');
        bar.className = 'download-all-bar';
        bar.innerHTML = `
            <button class="btn-primary" onclick="App.downloadAllImages()" style="width:100%;padding:14px;font-size:15px;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                전체 이미지 다운로드 (${this.state.generatedImages.length}장)
            </button>
        `;
        container.appendChild(bar);
    },

    downloadAllImages() {
        this.state.generatedImages.forEach((img, i) => {
            setTimeout(() => {
                const link = document.createElement('a');
                link.href = img.url;
                link.download = `cardnews_${img.type.toLowerCase()}_${i + 1}.png`;
                link.click();
            }, i * 300); // 300ms 간격으로 순차 다운로드
        });
        this.addLog(`전체 이미지 ${this.state.generatedImages.length}장 다운로드`);
        this.showToast('success', '다운로드', `${this.state.generatedImages.length}장의 이미지를 다운로드합니다.`);
    },

    pauseQueue() {
        this.state.isProcessingQueue = false;
        this.showToast('info', '일시정지', '대기열 처리가 일시정지되었습니다.');
        this.addLog('대기열 일시정지');
    },

    clearQueue() {
        this.state.queue = [];
        this.state.isProcessingQueue = false;
        this.renderQueue();
        this.showToast('info', '초기화', '대기열이 초기화되었습니다.');
        this.addLog('대기열 초기화');
    },

    // ─── REGENERATION ───
    openRegenDialog(pageIdx, pageType, pageLabel) {
        this.openModal('페이지 재생성', `
            <div class="regen-dialog">
                <p style="margin-bottom:16px;color:var(--text-secondary);font-size:14px">
                    <strong>${pageLabel}</strong>을(를) 재생성합니다. 기존 스타일을 유지하면서 수정사항을 반영합니다.
                </p>
                <label class="form-label">수정 요청사항</label>
                <textarea class="form-input" id="regen-feedback" rows="3" placeholder="예: 글씨를 더 크게, 배경을 파란색으로 등"></textarea>
                <div class="regen-actions">
                    <button class="btn-primary" onclick="App.submitRegeneration(${pageIdx}, '${pageType}', '${pageLabel}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        대기열에 추가
                    </button>
                    <button class="btn-ghost" onclick="App.closeModal()">취소</button>
                </div>
            </div>
        `);
    },

    submitRegeneration(pageIdx, pageType, pageLabel) {
        const feedback = document.getElementById('regen-feedback')?.value || '';
        this.closeModal();

        // 해당 페이지의 실제 콘텐츠 찾기
        const plan = this.state.planData?.plan;
        let pageContent = plan;
        if (pageType === 'COVER') pageContent = plan?.cover;
        else if (pageType === 'OUTRO') pageContent = plan?.outro;
        else if (pageType === 'BODY') {
            // pageIdx에서 cover 제외한 body 인덱스 계산
            const bodyIdx = plan?.cover ? pageIdx - 1 : pageIdx;
            pageContent = plan?.body?.[bodyIdx] || plan;
        }

        this.addToQueue({
            type: 'REGENERATE',
            pageIdx,
            pageType,
            pageLabel,
            feedback,
            content: pageContent,
            status: 'pending',
        });
        this.processQueue();
        this.showToast('info', '재생성 예약', `${pageLabel}이(가) 대기열에 추가되었습니다.`);
    },

    // ─── GALLERY ───
    renderGallery() {
        const grid = document.getElementById('gallery-grid');
        const empty = document.getElementById('gallery-empty');

        if (this.state.generatedImages.length === 0) {
            empty.hidden = false;
            grid.hidden = true;
            return;
        }

        empty.hidden = true;
        grid.hidden = false;

        grid.innerHTML = this.state.generatedImages.map((img, i) => `
            <div class="gallery-item" onclick="App.previewImage(${i})" style="animation-delay:${i * 0.05}s">
                <div class="gallery-item-actions">
                    <button class="gallery-action-btn" onclick="event.stopPropagation();App.downloadImage(${i})" title="다운로드">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                </div>
                <div class="gallery-item-img">
                    <img src="${img.url}" alt="${img.label}" loading="lazy">
                </div>
                <div class="gallery-item-info">
                    <div class="gallery-item-name">${img.label}</div>
                    <div class="gallery-item-meta">${img.type} · ${new Date(img.createdAt).toLocaleString('ko-KR')}</div>
                </div>
            </div>
        `).join('');
    },

    previewImage(index) {
        const img = this.state.generatedImages[index];
        if (!img) return;
        this.openLightbox(img.url, img.label, index);
    },

    openLightbox(src, label, downloadIdx) {
        // 기존 라이트박스 제거
        const existing = document.getElementById('lightbox');
        if (existing) existing.remove();

        const lb = document.createElement('div');
        lb.id = 'lightbox';
        lb.innerHTML = `
            <div class="lightbox-backdrop"></div>
            <div class="lightbox-content">
                <img src="${src}" alt="${label || ''}">
            </div>
            <div class="lightbox-toolbar">
                <span class="lightbox-label">${label || ''}</span>
                <div class="lightbox-actions">
                    ${downloadIdx !== undefined ? `<button class="lightbox-btn" onclick="App.downloadImage(${downloadIdx})" title="다운로드">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>` : ''}
                    <button class="lightbox-btn" onclick="App.closeLightbox()" title="닫기">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
        `;

        // 클릭으로 닫기 (이미지 외 영역)
        lb.querySelector('.lightbox-backdrop').addEventListener('click', () => this.closeLightbox());
        lb.querySelector('.lightbox-content').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeLightbox();
        });

        document.body.appendChild(lb);
        document.body.style.overflow = 'hidden';

        // 애니메이션
        requestAnimationFrame(() => lb.classList.add('active'));
    },

    closeLightbox() {
        const lb = document.getElementById('lightbox');
        if (!lb) return;
        lb.classList.remove('active');
        setTimeout(() => {
            lb.remove();
            // 모달이 열려있지 않으면 스크롤 복원
            if (document.getElementById('modal-overlay')?.hasAttribute('hidden')) {
                document.body.style.overflow = '';
            }
        }, 200);
    },

    downloadImage(index) {
        const img = this.state.generatedImages[index];
        if (!img) return;

        const link = document.createElement('a');
        link.href = img.url;
        link.download = `cardnews_${img.type.toLowerCase()}_${index + 1}.png`;
        link.click();
        this.addLog(`이미지 다운로드: ${img.label}`);
    },

    // ─── TOAST ───
    showToast(type, title, message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconSvg = {
            success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        };

        toast.innerHTML = `
            <span class="toast-icon">${iconSvg[type] || iconSvg.info}</span>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;

        container.appendChild(toast);

        // Auto remove after 4s
        setTimeout(() => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    // ─── MODAL ───
    openModal(title, bodyHtml, sizeClass) {
        const overlay = document.getElementById('modal-overlay');
        const container = overlay.querySelector('.modal-container');
        overlay.querySelector('.modal-title').textContent = title;
        overlay.querySelector('.modal-body').innerHTML = bodyHtml;
        container.className = 'modal-container' + (sizeClass ? ' ' + sizeClass : '');
        overlay.removeAttribute('hidden');
        document.body.style.overflow = 'hidden';
    },

    closeModal() {
        document.getElementById('modal-overlay').setAttribute('hidden', '');
        document.body.style.overflow = '';
    },

    // ─── LOG ───
    addLog(msg) {
        const time = new Date().toLocaleTimeString('ko-KR');
        this.state.logs.push({ time, msg });

        const box = document.getElementById('log-box');
        const isEmpty = box.querySelector('.log-empty');
        if (isEmpty) box.innerHTML = '';

        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
        box.appendChild(entry);
        box.scrollTop = box.scrollHeight;
    },

    // ─── STATS ───
    updateStats() {
        document.getElementById('stat-files').textContent = this.state.stats.files;
        document.getElementById('stat-plans').textContent = this.state.stats.plans;
        document.getElementById('stat-images').textContent = this.state.stats.images;
    },

    // ─── UTILS ───
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};

// ─── BOOT ───
document.addEventListener('DOMContentLoaded', () => App.init());
