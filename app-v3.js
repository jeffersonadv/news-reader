// Configurações e Estado do App
let newsData = [];
let readUrls = new Set(JSON.parse(localStorage.getItem('news_reader_read') || '[]'));
// historyUrls controla o que APARECE na aba Lidas (limpável pelo usuário).
// readUrls controla o que NÃO APARECE no Feed (nunca limpo automaticamente).
let historyUrls = new Set(JSON.parse(localStorage.getItem('news_reader_history') || '[]'));
let savedUrls = new Set(JSON.parse(localStorage.getItem('news_reader_saved') || '[]'));
let mutedKeywords = JSON.parse(localStorage.getItem('news_reader_muted') || '[]');
// Exceções de notícias relevantes que ignoram o silenciamento
const DEFAULT_EXCEPTIONS = ["investiga", "fraude", "desvio", "polícia", "preso", "presa", "prisão", "processo", "justiça", "denúncia", "crime", "acusa", "morte", "morreu", "matou", "matar"];
let exceptionKeywords = JSON.parse(localStorage.getItem('news_reader_exceptions') || JSON.stringify(DEFAULT_EXCEPTIONS));
let githubToken = localStorage.getItem('news_reader_gh_token') || '';
// Registra o timestamp do último clear para evitar que syncs em voo restaurem dados limpos
let lastClearTime = 0;
// Variáveis para debouncing e enfileiramento das chamadas de sincronização com o GitHub (evita erros 409)
let syncTimeoutId = null;
let isSyncing = false;
let syncPending = false;

// Palavras funcionais a serem ignoradas na sugestão de bloqueio
const STOP_WORDS = new Set([
    'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'um', 'uma', 'uns', 'umas',
    'o', 'a', 'os', 'as', 'e', 'ou', 'mas', 'porem', 'todavia', 'contudo', 'que', 'se', 'com',
    'para', 'por', 'sobre', 'sob', 'como', 'sua', 'seu', 'suas', 'seus', 'este', 'esta', 'isto',
    'esse', 'essa', 'isso', 'aquele', 'aquela', 'aquilo', 'ao', 'aos', 'comprar', 'veja', 'o que',
    'quem', 'diz', 'aponta', 'revela', 'sobre', 'novo', 'nova', 'novos', 'novas', 'tudo', 'mais',
    'menos'
]);

// Elementos do DOM
const secFeed = document.getElementById('sec-feed');
const secHistory = document.getElementById('sec-history');
const secSaved = document.getElementById('sec-saved');
const secSettings = document.getElementById('sec-settings');
const newsGrid = document.getElementById('news-grid');
const historyGrid = document.getElementById('history-grid');
const savedGrid = document.getElementById('saved-grid');
const keywordsList = document.getElementById('keywords-list');
const keywordInput = document.getElementById('keyword-input');
const searchInput = document.getElementById('search-input');
const historyCountSpan = document.getElementById('history-count');
const feedCountSpan = document.getElementById('feed-count');
const savedCountSpan = document.getElementById('saved-count');

// Elementos de Navegação
const btnFeed = document.getElementById('btn-feed');
const btnHistory = document.getElementById('btn-history');
const btnSaved = document.getElementById('btn-saved');
const btnSettings = document.getElementById('btn-settings');
const btnAddKeyword = document.getElementById('btn-add-keyword');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnClearSaved = document.getElementById('btn-clear-saved');

// Elementos de Exceções
const exceptionsList = document.getElementById('exceptions-list');
const exceptionInput = document.getElementById('exception-input');
const btnAddException = document.getElementById('btn-add-exception');

// Elementos de Configuração do GitHub Token e Botão Flutuante
const btnTriggerUpdate = document.getElementById('btn-trigger-update');
const btnSaveToken = document.getElementById('btn-save-token');
const githubTokenInput = document.getElementById('github-token-input');
const btnNextNews = document.getElementById('btn-next-news');
const btnTopHistory = document.getElementById('btn-top-history');
const syncStatusIndicator = document.getElementById('sync-status-indicator');
const btnForceSync = document.getElementById('btn-force-sync');
const miniSyncIndicator = document.getElementById('mini-sync-indicator');

// Elementos do Overlay de Carregamento
const updateLoadingOverlay = document.getElementById('update-loading-overlay');
const updateProgressBar = document.getElementById('update-progress-bar');
const updateStatusText = document.getElementById('update-status-text');

// Elementos do Modal de Bloqueio
const blockModal = document.getElementById('block-modal');
const modalWordsList = document.getElementById('modal-words-list');
const btnCloseModal = document.getElementById('close-modal');

// Roteador de Seções (Tabs)
function switchSection(activeButton, sectionToShow) {
    [btnFeed, btnHistory, btnSaved, btnSettings].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    [secFeed, secHistory, secSaved, secSettings].forEach(sec => {
        if (sec) sec.classList.add('hidden');
    });
    
    activeButton.classList.add('active');
    sectionToShow.classList.remove('hidden');

    // Reseta o campo de busca e ajusta o placeholder com base na aba ativa
    if (searchInput) {
        searchInput.value = '';
        if (sectionToShow === secFeed) {
            searchInput.placeholder = "Buscar no feed...";
            searchInput.style.display = "block";
        } else if (sectionToShow === secHistory) {
            searchInput.placeholder = "Buscar nas lidas...";
            searchInput.style.display = "block";
        } else if (sectionToShow === secSaved) {
            searchInput.placeholder = "Buscar nas salvas...";
            searchInput.style.display = "block";
        } else {
            searchInput.style.display = "none"; // Esconde busca na aba de filtros
        }
    }

    // Sempre re-renderiza ao trocar de aba para refletir novos estados
    if (sectionToShow === secFeed) {
        renderFeed();
    } else if (sectionToShow === secHistory) {
        renderHistory();
    } else if (sectionToShow === secSaved) {
        renderSaved();
    } else if (sectionToShow === secSettings) {
        renderMutedKeywords();
        renderExceptionKeywords();
        // Carrega o token salvo no input
        githubTokenInput.value = githubToken;
    }
    
    updateFabVisibility();
}

btnFeed.addEventListener('click', () => switchSection(btnFeed, secFeed));
btnHistory.addEventListener('click', () => switchSection(btnHistory, secHistory));
btnSaved.addEventListener('click', () => switchSection(btnSaved, secSaved));
btnSettings.addEventListener('click', () => switchSection(btnSettings, secSettings));

// Inicialização do Intersection Observer para marcação automática
let seenCards = new Set();
const autoReadObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const card = entry.target;
        const url = card.dataset.url;

        if (entry.isIntersecting) {
            // Card entrou na tela - registra como visualizado no início da rolagem
            seenCards.add(url);
        } else {
            // Card saiu da tela
            // Se o card deixou de intersectar simplesmente porque foi removido ou recriado no DOM, ignoramos
            if (!document.body.contains(card)) {
                seenCards.delete(url);
                return;
            }
            
            // Verifica se o card saiu pelo topo da tela (rolagem para baixo)
            const bounding = entry.boundingClientRect;
            if (bounding.top < 0 && seenCards.has(url)) {
                // Usuário rolou e passou pelo card! Marca como lido automaticamente.
                markAsRead(url, card, false); // false = sem animação abrupta de remoção
            }
        }
    });
}, {
    threshold: 0.1 // Dispara quando pelo menos 10% do card está/estava visível
});

// Detector de fim de rolagem para marcar notícias do final da página como lidas
window.addEventListener('scroll', () => {
    // Só funciona se estivermos vendo o Feed
    if (secFeed.classList.contains('hidden')) return;
    
    // Verifica se chegou a menos de 60px do fundo do documento
    if ((window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 60)) {
        const unreadCards = newsGrid.querySelectorAll('.news-card');
        unreadCards.forEach(card => {
            const url = card.dataset.url;
            if (!readUrls.has(url)) {
                const rect = card.getBoundingClientRect();
                // Se o card está parcialmente ou totalmente visível na tela
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    markAsRead(url, card, false); // Marca suavemente
                }
            }
        });
        updateFabVisibility();
    }
});

// Carregar Notícias do noticias.json
async function loadNews() {
    try {
        const response = await fetch('noticias.json?t=' + new Date().getTime());
        if (!response.ok) {
            throw new Error('Falha ao carregar as notícias. Execute o raspador primeiro.');
        }
        newsData = await response.json();
        updateHistoryCount();
        updateSavedCount();

        // IMPORTANTE: Aguarda a sincronização com a nuvem ANTES de renderizar o feed.
        // Sem o await, o feed era renderizado com o localStorage local (vazio em dispositivos
        // novos), e notícias já lidas em outro dispositivo apareciam indevidamente como não lidas.
        await loadSyncDataFromRepo();

        renderFeed();
    } catch (error) {
        newsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <p>Nenhuma notícia encontrada.</p>
                <p style="font-size: 0.9rem; color: var(--text-muted);">Certifique-se de executar o script Python "scrape_uol.py" para gerar o arquivo noticias.json.</p>
            </div>
        `;
        console.error(error);
    }
}


// Atualiza o contador de histórico e feed no menu
function updateHistoryCount() {
    if (historyCountSpan) {
        historyCountSpan.textContent = historyUrls.size;
    }
    updateFeedCount();
}

// Atualiza o contador de notícias não lidas (feed)
function updateFeedCount() {
    if (!feedCountSpan) return;
    const unreadCount = newsData.filter(news => {
        return !readUrls.has(news.link) && !isMuted(news.title);
    }).length;
    feedCountSpan.textContent = unreadCount;
}

// Atualiza o contador de notícias salvas
function updateSavedCount() {
    if (savedCountSpan) {
        savedCountSpan.textContent = savedUrls.size;
    }
}

// Salva o histórico de lidas no localStorage e sincroniza na nuvem
function saveReadHistory() {
    localStorage.setItem('news_reader_read', JSON.stringify(Array.from(readUrls)));
    localStorage.setItem('news_reader_history', JSON.stringify(Array.from(historyUrls)));
    updateHistoryCount();
    syncWithRepo();
}

// Salva as notícias salvas no localStorage e sincroniza na nuvem
function saveSavedHistory() {
    localStorage.setItem('news_reader_saved', JSON.stringify(Array.from(savedUrls)));
    updateSavedCount();
    syncWithRepo();
}

// Mecanismo de Sincronização em Nuvem via Repositório GitHub (Bypassa limitação de tokens sem permissão gist)
const repoOwner = "jeffersonadv";
const repoName = "news-reader";
const syncFilePath = "sync.json";

// Atualiza o status visual da sincronização na tela
function updateSyncStatusUI(status, message = '') {
    // 1. Atualiza o indicador textual completo (aba Filtros)
    if (syncStatusIndicator) {
        let iconClass = '';
        let iconColor = '';
        let text = '';
        
        switch (status) {
            case 'no_token':
                iconClass = 'fa-solid fa-circle-question';
                iconColor = 'var(--text-muted)';
                text = 'Token não configurado. Sincronização inativa.';
                break;
            case 'loading':
                iconClass = 'fa-solid fa-circle-notch fa-spin';
                iconColor = 'var(--accent-color)';
                text = message || 'Conectando ao GitHub...';
                break;
            case 'success':
                iconClass = 'fa-solid fa-circle-check';
                iconColor = '#22c55e';
                text = message || 'Sincronizado com o repositório!';
                break;
            case 'error':
                iconClass = 'fa-solid fa-circle-exclamation';
                iconColor = '#ef4444';
                text = message || 'Erro ao sincronizar. Verifique se o token tem permissões corretas.';
                break;
        }
        syncStatusIndicator.innerHTML = `<i class="${iconClass}" style="color: ${iconColor};"></i> <span>${text}</span>`;
    }

    // 2. Atualiza o mini-indicador de bolinha no cabeçalho
    if (miniSyncIndicator) {
        let miniColor = 'var(--text-muted)';
        let miniTitle = '';
        
        switch (status) {
            case 'no_token':
                miniColor = 'var(--text-muted)';
                miniTitle = 'Sincronização inativa (sem Token)';
                break;
            case 'loading':
                miniColor = 'var(--accent-color)';
                miniTitle = 'Sincronizando...';
                break;
            case 'success':
                miniColor = '#22c55e';
                miniTitle = 'Sincronizado com a nuvem';
                break;
            case 'error':
                miniColor = '#ef4444';
                miniTitle = 'Erro de sincronização';
                break;
        }
        miniSyncIndicator.innerHTML = `<i class="fa-solid fa-circle"></i>`;
        miniSyncIndicator.style.color = miniColor;
        miniSyncIndicator.title = miniTitle;
    }
}

async function syncWithRepo() {
    if (!githubToken) {
        updateSyncStatusUI('no_token');
        return;
    }

    // Se já estiver realizando uma sincronização, marca que há um sync pendente para rodar logo em seguida
    if (isSyncing) {
        syncPending = true;
        return;
    }

    // Implementa um pequeno atraso (debounce) para agrupar marcações em lote
    if (syncTimeoutId) {
        clearTimeout(syncTimeoutId);
    }

    syncTimeoutId = setTimeout(async () => {
        syncTimeoutId = null;
        await executeSyncWithRepo();
    }, 1500);
}

async function executeSyncWithRepo() {
    isSyncing = true;
    updateSyncStatusUI('loading', 'Sincronizando com o repositório...');
    try {
        const headers = {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        };

        // 1. Registra o momento de início deste sync para detectar clears concorrentes
        const syncStartTime = Date.now();

        // 2. Busca os dados remotos mais recentes do arquivo sync.json no repositório antes de gravar
        let remoteRead = [];
        let remoteSaved = [];
        let remoteHistory = [];
        let remoteMuted = [];
        let remoteExceptions = [];
        let sha = '';

        const getRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${syncFilePath}?t=${new Date().getTime()}`, { headers });
        if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
            localStorage.setItem('news_reader_sync_sha', sha);
            
            // Decodifica o conteúdo remoto
            const fileContent = decodeURIComponent(escape(atob(getData.content.replace(/\s/g, ''))));
            if (fileContent) {
                const remoteData = JSON.parse(fileContent);
                if (remoteData.read && Array.isArray(remoteData.read)) {
                    remoteRead = remoteData.read;
                }
                if (remoteData.history && Array.isArray(remoteData.history)) {
                    remoteHistory = remoteData.history;
                }
                if (remoteData.saved && Array.isArray(remoteData.saved)) {
                    remoteSaved = remoteData.saved;
                }
                if (remoteData.muted && Array.isArray(remoteData.muted)) {
                    remoteMuted = remoteData.muted;
                }
                if (remoteData.exceptions && Array.isArray(remoteData.exceptions)) {
                    remoteExceptions = remoteData.exceptions;
                }
            }
        }

        // 3. Mescla o conteúdo remoto com o local — MAS apenas se nenhum clear ocorreu
        // durante o await acima. Se lastClearTime > syncStartTime, um clear foi disparado
        // enquanto buscávamos os dados: descartamos a mesclagem e subimos só o estado atual.
        const clearHappenedDuringFetch = lastClearTime > syncStartTime;

        const beforeReadSize = readUrls.size;
        const beforeSavedSize = savedUrls.size;
        const beforeHistorySize = historyUrls.size;
        const beforeMutedSize = mutedKeywords.length;
        const beforeExceptionsSize = exceptionKeywords.length;

        if (!clearHappenedDuringFetch) {
            remoteRead.forEach(url => readUrls.add(url));
            remoteSaved.forEach(url => savedUrls.add(url));
            remoteHistory.forEach(url => historyUrls.add(url));
            remoteMuted.forEach(word => {
                if (!mutedKeywords.includes(word)) mutedKeywords.push(word);
            });
            remoteExceptions.forEach(word => {
                if (!exceptionKeywords.includes(word)) exceptionKeywords.push(word);
            });
        }

        const dataChanged = (readUrls.size !== beforeReadSize) || 
                            (savedUrls.size !== beforeSavedSize) || 
                            (historyUrls.size !== beforeHistorySize) ||
                            (mutedKeywords.length !== beforeMutedSize) || 
                            (exceptionKeywords.length !== beforeExceptionsSize);

        if (dataChanged) {
            // Atualiza os registros locais se o servidor trouxe novidades
            localStorage.setItem('news_reader_read', JSON.stringify(Array.from(readUrls)));
            localStorage.setItem('news_reader_history', JSON.stringify(Array.from(historyUrls)));
            localStorage.setItem('news_reader_saved', JSON.stringify(Array.from(savedUrls)));
            localStorage.setItem('news_reader_muted', JSON.stringify(mutedKeywords));
            localStorage.setItem('news_reader_exceptions', JSON.stringify(exceptionKeywords));
        }

        // 3. Prepara o payload com os dados mesclados finais
        const syncData = {
            read: Array.from(readUrls),
            history: Array.from(historyUrls),
            saved: Array.from(savedUrls),
            muted: mutedKeywords,
            exceptions: exceptionKeywords
        };

        const b64Content = btoa(unescape(encodeURIComponent(JSON.stringify(syncData))));

        const body = {
            message: 'chore: update sync data [skip ci]',
            content: b64Content
        };
        if (sha) {
            body.sha = sha;
        }

        // 4. Grava os dados finais de volta no repositório
        const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${syncFilePath}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('news_reader_sync_sha', data.content.sha);
            updateSyncStatusUI('success');
            
            if (dataChanged) {
                updateHistoryCount();
                updateSavedCount();
                const activeSection = document.querySelector('.content-section:not(.hidden)');
                if (activeSection === secFeed) renderFeed();
                else if (activeSection === secHistory) renderHistory();
                else if (activeSection === secSaved) renderSaved();
                else if (activeSection === secSettings) {
                    renderMutedKeywords();
                    renderExceptionKeywords();
                }
            }
        } else {
            const errData = await res.json().catch(() => ({}));
            console.error('Falha ao sincronizar com o repositório:', errData.message || res.statusText);
            updateSyncStatusUI('error', `Falha ao salvar: ${errData.message || res.statusText}`);
        }
    } catch (error) {
        console.error('Erro ao sincronizar com o repositório:', error);
        updateSyncStatusUI('error', `Erro de conexão: ${error.message}`);
    } finally {
        isSyncing = false;
        // Se houveram novas mudanças enquanto sincronizava, executa novamente
        if (syncPending) {
            syncPending = false;
            syncWithRepo();
        }
    }
}

// Grava o estado atual diretamente na nuvem SEM mesclar dados remotos.
// Usado exclusivamente após operações de limpeza (Limpar Histórico / Limpar Salvas),
// onde a intenção é substituir — não acumular — o conteúdo remoto.
async function overwriteRepoSync() {
    if (!githubToken) return;
    updateSyncStatusUI('loading', 'Sobrescrevendo dados na nuvem...');
    try {
        const headers = {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        };

        // Busca o SHA atual (necessário para o PUT, mas sem mesclar conteúdo)
        let sha = '';
        const getRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${syncFilePath}?t=${new Date().getTime()}`, { headers });
        if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
        }

        const syncData = {
            read: Array.from(readUrls),
            history: Array.from(historyUrls),
            saved: Array.from(savedUrls),
            muted: mutedKeywords,
            exceptions: exceptionKeywords
        };

        const b64Content = btoa(unescape(encodeURIComponent(JSON.stringify(syncData))));
        const body = { message: 'chore: clear sync data [skip ci]', content: b64Content };
        if (sha) body.sha = sha;

        const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${syncFilePath}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('news_reader_sync_sha', data.content.sha);
            updateSyncStatusUI('success', 'Dados limpos e sincronizados!');
        } else {
            const errData = await res.json().catch(() => ({}));
            updateSyncStatusUI('error', `Falha ao sobrescrever: ${errData.message || res.statusText}`);
        }
    } catch (error) {
        updateSyncStatusUI('error', `Erro de conexão: ${error.message}`);
    }
}

async function loadSyncDataFromRepo() {
    if (!githubToken) {
        updateSyncStatusUI('no_token');
        return;
    }
    
    updateSyncStatusUI('loading', 'Baixando dados do repositório...');
    try {
        const headers = {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json'
        };

        const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${syncFilePath}?t=${new Date().getTime()}`, { headers });
        
        if (res.status === 404) {
            updateSyncStatusUI('success', 'Nenhum backup encontrado. Será gerado ao ler ou salvar.');
            return;
        }

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('news_reader_sync_sha', data.sha);
            
            // Decodifica Base64 em UTF-8 de forma segura
            const fileContent = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
            if (fileContent) {
                const syncData = JSON.parse(fileContent);

                // A nuvem é a fonte de verdade. Substitui o estado local completamente
                // em vez de mesclar. Isso garante que operações de limpeza feitas em
                // qualquer dispositivo se propaguem corretamente para todos os outros.
                let changed = false;

                if (Array.isArray(syncData.read)) {
                    const cloudRead = new Set(syncData.read);
                    const localIsIdentical = readUrls.size === cloudRead.size &&
                        [...cloudRead].every(url => readUrls.has(url));
                    if (!localIsIdentical) {
                        readUrls = cloudRead;
                        localStorage.setItem('news_reader_read', JSON.stringify(syncData.read));
                        changed = true;
                    }
                }

                // history: substitui local pelo da nuvem (propaga limpezas entre dispositivos)
                if (Array.isArray(syncData.history)) {
                    const cloudHistory = new Set(syncData.history);
                    const localIsIdentical = historyUrls.size === cloudHistory.size &&
                        [...cloudHistory].every(url => historyUrls.has(url));
                    if (!localIsIdentical) {
                        historyUrls = cloudHistory;
                        localStorage.setItem('news_reader_history', JSON.stringify(syncData.history));
                        changed = true;
                    }
                }

                if (Array.isArray(syncData.saved)) {
                    const cloudSaved = new Set(syncData.saved);
                    const localIsIdentical = savedUrls.size === cloudSaved.size &&
                        [...cloudSaved].every(url => savedUrls.has(url));
                    if (!localIsIdentical) {
                        savedUrls = cloudSaved;
                        localStorage.setItem('news_reader_saved', JSON.stringify(syncData.saved));
                        changed = true;
                    }
                }

                if (Array.isArray(syncData.muted)) {
                    const localSorted = [...mutedKeywords].sort().join(',');
                    const cloudSorted = [...syncData.muted].sort().join(',');
                    if (localSorted !== cloudSorted) {
                        mutedKeywords = syncData.muted;
                        localStorage.setItem('news_reader_muted', JSON.stringify(mutedKeywords));
                        changed = true;
                    }
                }

                if (Array.isArray(syncData.exceptions)) {
                    const localSorted = [...exceptionKeywords].sort().join(',');
                    const cloudSorted = [...syncData.exceptions].sort().join(',');
                    if (localSorted !== cloudSorted) {
                        exceptionKeywords = syncData.exceptions;
                        localStorage.setItem('news_reader_exceptions', JSON.stringify(exceptionKeywords));
                        changed = true;
                    }
                }

                updateSyncStatusUI('success');

                if (changed) {
                    updateHistoryCount();
                    updateSavedCount();
                    const activeSection = document.querySelector('.content-section:not(.hidden)');
                    if (activeSection === secFeed) renderFeed();
                    else if (activeSection === secHistory) renderHistory();
                    else if (activeSection === secSaved) renderSaved();
                    else if (activeSection === secSettings) {
                        renderMutedKeywords();
                        renderExceptionKeywords();
                    }
                }
            } else {
                updateSyncStatusUI('success', 'Nuvem vazia.');
            }
        } else {
            updateSyncStatusUI('error', `Erro ao baixar: ${res.statusText}`);
        }
    } catch (err) {
        console.error('Erro ao ler do repositório:', err);
        updateSyncStatusUI('error', `Erro ao baixar: ${err.message}`);
    }
}

// Salva palavras silenciadas no localStorage
function saveMutedKeywords() {
    localStorage.setItem('news_reader_muted', JSON.stringify(mutedKeywords));
}

// Marca notícia como lida
function markAsRead(url, cardElement, immediateRemove = true) {
    if (readUrls.has(url)) return;

    readUrls.add(url);
    historyUrls.add(url); // historyUrls controla a aba Lidas (limpável)
    saveReadHistory();

    if (cardElement) {
        cardElement.classList.add('is-read');
        
        // Se immediateRemove for true (ex: clique no botão), anima e remove
        if (immediateRemove) {
            cardElement.classList.add('read-fade-out');
            setTimeout(() => {
                cardElement.remove();
                // Se o feed ficou vazio após remoção
                const visibleCards = newsGrid.querySelectorAll('.news-card');
                if (visibleCards.length === 0) {
                    renderFeed();
                }
            }, 600);
        } else {
            // Se for via scroll, apenas adiciona um estilo sutil de "lido" (dimming)
            // para não quebrar a rolagem abruptamente. A notícia desaparecerá na próxima carga.
            cardElement.style.opacity = '0.35';
        }
    }
}

// Verifica se a notícia contém palavras silenciadas (respeitando exceções)
function isMuted(title) {
    const titleLower = title.toLowerCase();
    
    // Se a notícia contiver qualquer palavra de exceção (ex: investigada, fraude), ela NUNCA será silenciada
    const hasException = exceptionKeywords.some(keyword => {
        const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'i');
        return regex.test(titleLower) || titleLower.includes(keyword.toLowerCase());
    });
    
    if (hasException) {
        return false;
    }

    return mutedKeywords.some(keyword => {
        const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'i');
        return regex.test(titleLower) || titleLower.includes(keyword.toLowerCase());
    });
}

// Renderiza o Feed de Não Lidas
function renderFeed() {
    newsGrid.innerHTML = '';
    autoReadObserver.disconnect(); // Limpa observadores anteriores

    // Recuperação de emergência caso o set em memória tenha sido esvaziado indevidamente
    if (readUrls.size === 0) {
        const localRead = JSON.parse(localStorage.getItem('news_reader_read') || '[]');
        if (localRead.length > 0) {
            readUrls = new Set(localRead);
        }
    }

    const query = searchInput.value.toLowerCase().trim();
    
    // Filtra notícias: não lidas, não silenciadas e de acordo com a busca (incluindo sub-notícias)
    let filteredNews = newsData.filter(news => {
        const matchesRead = !readUrls.has(news.link);
        const matchesMute = !isMuted(news.title);
        const matchesQuery = query ? (
            news.title.toLowerCase().includes(query) || 
            (news.relateds && news.relateds.some(rel => rel.title.toLowerCase().includes(query)))
        ) : true;
        return matchesRead && matchesMute && matchesQuery;
    });

    // Ordena de modo que os destaques do UOL (is_main === true) apareçam primeiro no topo
    filteredNews.sort((a, b) => {
        const aMain = a.is_main ? 1 : 0;
        const bMain = b.is_main ? 1 : 0;
        return bMain - aMain; // Coloca o destaque antes das demais notícias
    });

    // Atualiza temporariamente o contador com o resultado da busca
    if (query) {
        if (feedCountSpan) feedCountSpan.textContent = filteredNews.length;
    } else {
        updateFeedCount();
    }

    if (filteredNews.length === 0) {
        newsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-square-check"></i>
                <p>Tudo limpo por aqui!</p>
                <p style="font-size: 0.9rem; color: var(--text-muted);">Você leu todas as notícias ou os seus filtros silenciaram os conteúdos recentes.</p>
            </div>
        `;
        updateFabVisibility();
        return;
    }

    filteredNews.forEach(news => {
        const card = createNewsCard(news, true);
        newsGrid.appendChild(card);
        // Observa o card para marcação automática ao rolar
        autoReadObserver.observe(card);
    });

    updateFabVisibility();
}

// Renderiza o Histórico de Lidas (com as últimas lidas no topo/inverso)
function renderHistory() {
    historyGrid.innerHTML = '';
    
    const query = searchInput.value.toLowerCase().trim();
    // Usa historyUrls (limpável) em vez de readUrls (permanente)
    const historyOrdered = Array.from(historyUrls).reverse();
    
    const newsByLink = {};
    newsData.forEach(item => {
        newsByLink[item.link] = item;
    });

    const readItems = [];
    historyOrdered.forEach(url => {
        if (newsByLink[url]) {
            const newsItem = newsByLink[url];
            const matchesQuery = query ? (
                newsItem.title.toLowerCase().includes(query) ||
                (newsItem.relateds && newsItem.relateds.some(rel => rel.title.toLowerCase().includes(query)))
            ) : true;
            if (matchesQuery) {
                readItems.push(newsItem);
            }
        }
    });

    // Atualiza temporariamente o contador com o resultado da busca
    if (query) {
        if (historyCountSpan) historyCountSpan.textContent = readItems.length;
    } else {
        updateHistoryCount();
    }

    if (readItems.length === 0) {
        historyGrid.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-history"></i>
                <p>${query ? 'Nenhuma notícia lida corresponde à busca.' : 'Nenhuma notícia lida ainda.'}</p>
            </div>
        `;
        return;
    }

    readItems.forEach(news => {
        const card = createNewsCard(news, false);
        historyGrid.appendChild(card);
    });
}

// Renderiza o Histórico de Salvas (com as últimas salvas no topo/inverso)
function renderSaved() {
    savedGrid.innerHTML = '';
    
    const query = searchInput.value.toLowerCase().trim();
    const savedUrlsOrdered = Array.from(savedUrls).reverse();
    
    const newsByLink = {};
    newsData.forEach(item => {
        newsByLink[item.link] = item;
    });

    const savedItems = [];
    savedUrlsOrdered.forEach(url => {
        if (newsByLink[url]) {
            const newsItem = newsByLink[url];
            const matchesQuery = query ? (
                newsItem.title.toLowerCase().includes(query) ||
                (newsItem.relateds && newsItem.relateds.some(rel => rel.title.toLowerCase().includes(query)))
            ) : true;
            if (matchesQuery) {
                savedItems.push(newsItem);
            }
        }
    });

    // Atualiza temporariamente o contador com o resultado da busca
    if (query) {
        if (savedCountSpan) savedCountSpan.textContent = savedItems.length;
    } else {
        updateSavedCount();
    }

    if (savedItems.length === 0) {
        savedGrid.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-bookmark"></i>
                <p>${query ? 'Nenhuma notícia salva corresponde à busca.' : 'Nenhuma notícia salva ainda.'}</p>
            </div>
        `;
        return;
    }

    savedItems.forEach(news => {
        const card = createNewsCard(news, !readUrls.has(news.link));
        savedGrid.appendChild(card);
    });
}

// Destaca o termo pesquisado envolvendo-o em uma tag mark
function highlightText(text, query) {
    if (!query) return text;
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}

// Cria a estrutura HTML do Card de Notícia
function createNewsCard(news, isFeedMode) {
    const card = document.createElement('article');
    card.className = 'news-card';
    card.dataset.url = news.link;

    const query = searchInput ? searchInput.value.trim() : '';
    const highlightedTitle = highlightText(news.title, query);

    // Adiciona classes específicas se existirem metadados
    if (news.is_main) card.classList.add('card-main');
    if (news.is_carousel) card.classList.add('card-carousel');
    if (news.is_video) card.classList.add('card-video');

    // Trata imagens em branco com placeholder moderno
    const imgHtml = news.photo 
        ? `<img src="${news.photo}" alt="Imagem da notícia" class="card-img" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="card-img" style="background: linear-gradient(135deg, #1e293b, #0f172a); display: flex; align-items: center; justify-content: center; height: 100%; width: 100%;"><i class="fa-solid fa-newspaper" style="font-size: 2.5rem; color: rgba(255,255,255,0.1)"></i></div>`;

    // Overlay especial de Play se for vídeo do Canal UOL
    const playOverlay = news.is_video 
        ? `<div class="video-play-overlay"><i class="fa-solid fa-play"></i></div>` 
        : '';

    // Badges visuais do card
    let badgesHtml = '';
    if (news.is_main) {
        badgesHtml += `<span class="card-badge badge-main"><i class="fa-solid fa-star"></i> Destaque</span>`;
    }
    if (news.is_carousel) {
        badgesHtml += `<span class="card-badge badge-carousel"><i class="fa-solid fa-images"></i> Carrossel</span>`;
    }
    if (news.is_video) {
        badgesHtml += `<span class="card-badge badge-video"><i class="fa-solid fa-circle-play"></i> Canal UOL</span>`;
    }
    if (badgesHtml) {
        badgesHtml = `<div class="card-badges">${badgesHtml}</div>`;
    }

    // Estrutura de notícias adicionais relacionadas
    let relatedsHtml = '';
    if (news.relateds && news.relateds.length > 0) {
        relatedsHtml = `
            <div class="card-relateds">
                <ul>
                    ${news.relateds.map(rel => `
                        <li>
                            <a href="${rel.link}" target="_blank" class="related-link">
                                ${highlightText(rel.title, query)}
                            </a>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="card-img-wrapper">
            ${imgHtml}
            ${playOverlay}
            <span class="card-source">${news.source || 'UOL'}</span>
        </div>
        <div class="card-content">
            ${badgesHtml}
            <h3 class="card-title">${highlightedTitle}</h3>
            ${relatedsHtml}
            <div class="card-actions">
                ${isFeedMode ? `
                    <button class="card-btn btn-read" title="Marcar como lida">
                        <i class="fa-solid fa-check"></i> Lida
                    </button>
                    <button class="card-btn btn-mute" title="Ocultar este assunto">
                        <i class="fa-solid fa-eye-slash"></i>
                    </button>
                ` : `
                    <button class="card-btn btn-unread" title="Mover de volta para o feed" style="flex: 1;">
                        <i class="fa-solid fa-arrow-rotate-left"></i> Não lida
                    </button>
                    <button class="card-btn btn-mute" title="Ocultar este assunto">
                        <i class="fa-solid fa-eye-slash"></i>
                    </button>
                `}
                <button class="card-btn btn-save" title="${savedUrls.has(news.link) ? 'Remover das salvas' : 'Salvar para ler depois'}">
                    <i class="${savedUrls.has(news.link) ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
                </button>
                <button class="card-btn btn-whatsapp" title="Encaminhar para o WhatsApp">
                    <i class="fa-brands fa-whatsapp"></i>
                </button>
                <button class="card-btn btn-telegram" title="Encaminhar para o Telegram">
                    <i class="fa-brands fa-telegram"></i>
                </button>
            </div>
        </div>
    `;

    // Eventos do Card
    if (isFeedMode) {
        card.querySelector('.btn-read').addEventListener('click', () => {
            markAsRead(news.link, card, true);
        });
    } else {
        card.querySelector('.btn-unread').addEventListener('click', () => {
            // Remove dos dois sets: volta ao Feed E sai da aba Lidas
            readUrls.delete(news.link);
            historyUrls.delete(news.link);
            saveReadHistory();
            card.remove();
            const remainingHistory = historyGrid.querySelectorAll('.news-card');
            if (remainingHistory.length === 0) {
                renderHistory();
            }
        });
    }

    // Ouvinte do botão de silenciamento (comum para Feed e Histórico)
    card.querySelector('.btn-mute').addEventListener('click', (e) => {
        e.stopPropagation();
        openMuteModal(news.title);
    });

    // Ouvinte do botão de Salvar (Bookmark)
    card.querySelector('.btn-save').addEventListener('click', (e) => {
        e.stopPropagation();
        const icon = e.currentTarget.querySelector('i');
        if (savedUrls.has(news.link)) {
            savedUrls.delete(news.link);
            icon.className = 'fa-regular fa-bookmark';
            e.currentTarget.title = 'Salvar para ler depois';
            if (!secSaved.classList.contains('hidden')) {
                card.remove();
                if (savedGrid.querySelectorAll('.news-card').length === 0) {
                    renderSaved();
                }
            }
        } else {
            savedUrls.add(news.link);
            icon.className = 'fa-solid fa-bookmark';
            e.currentTarget.title = 'Remover das salvas';
        }
        saveSavedHistory();
    });

    // Compartilhamentos
    card.querySelector('.btn-whatsapp').addEventListener('click', (e) => {
        e.stopPropagation();
        const text = encodeURIComponent(`*${news.title}*\nLeia a matéria completa em: ${news.link}`);
        window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
    });

    card.querySelector('.btn-telegram').addEventListener('click', (e) => {
        e.stopPropagation();
        const url = encodeURIComponent(news.link);
        const text = encodeURIComponent(news.title);
        window.open(`https://t.me/share/url?url=${url}&text=${text}`, '_blank');
    });

    // Abrir notícia original ao clicar no card (exceto nos botões)
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.card-btn')) {
            window.open(news.link, '_blank');
            markAsRead(news.link, card, false); // Marca como lido suavemente ao abrir
        }
    });

    return card;
}

// Filtro inteligente: Abre modal com palavras sugeridas para bloqueio
function openMuteModal(title) {
    modalWordsList.innerHTML = '';
    
    // 1. Extrai nomes próprios contíguos (Ex: Márcia Sensitiva, Caroline Bittencourt)
    const properNounRegex = /([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+(?:de|da|do|dos|das)\s+[A-ZÀ-Ý][a-zà-ÿ]+|\s+[A-ZÀ-Ý][a-zà-ÿ]+)+)/g;
    const properNouns = [];
    let match;
    while ((match = properNounRegex.exec(title)) !== null) {
        properNouns.push(match[1].trim().toLowerCase());
    }
    
    // 2. Limpa a string de pontuações e quebra em palavras únicas relevantes
    const cleanTitle = title.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'“]/g, " ");
    const words = cleanTitle.split(/\s+/)
        .map(w => w.toLowerCase().trim())
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
        
    const uniqueWords = Array.from(new Set(words));
    const uniqueProperNouns = Array.from(new Set(properNouns));

    if (uniqueWords.length === 0 && uniqueProperNouns.length === 0) {
        modalWordsList.innerHTML = '<p style="color: var(--text-muted)">Nenhuma palavra relevante identificada.</p>';
    } else {
        // Adiciona nomes próprios em destaque primeiro
        if (uniqueProperNouns.length > 0) {
            const header = document.createElement('h4');
            header.textContent = "Assuntos/Nomes Compostos:";
            header.style.width = "100%";
            header.style.color = "var(--text-secondary)";
            header.style.fontSize = "0.9rem";
            header.style.margin = "0.5rem 0";
            modalWordsList.appendChild(header);

            uniqueProperNouns.forEach(phrase => {
                const btn = document.createElement('button');
                btn.className = 'word-btn';
                btn.style.borderColor = 'var(--accent-color)';
                btn.style.background = 'rgba(88, 101, 242, 0.1)';
                btn.innerHTML = `<i class="fa-solid fa-users-slash"></i> <strong>${phrase}</strong>`;
                btn.addEventListener('click', () => {
                    addMutedKeyword(phrase);
                    closeMuteModal();
                });
                modalWordsList.appendChild(btn);
                
                // Remove as palavras que compõem o nome próprio da lista de palavras individuais para não duplicar
                phrase.split(/\s+/).forEach(w => {
                    const idx = uniqueWords.indexOf(w);
                    if (idx > -1) uniqueWords.splice(idx, 1);
                });
            });

            if (uniqueWords.length > 0) {
                const header2 = document.createElement('h4');
                header2.textContent = "Palavras Individuais:";
                header2.style.width = "100%";
                header2.style.color = "var(--text-secondary)";
                header2.style.fontSize = "0.9rem";
                header2.style.margin = "1rem 0 0.5rem 0";
                modalWordsList.appendChild(header2);
            }
        }

        // Adiciona palavras individuais
        uniqueWords.forEach(word => {
            const btn = document.createElement('button');
            btn.className = 'word-btn';
            btn.innerHTML = `<i class="fa-solid fa-ban"></i> ${word}`;
            btn.addEventListener('click', () => {
                addMutedKeyword(word);
                closeMuteModal();
            });
            modalWordsList.appendChild(btn);
        });
    }

    blockModal.classList.add('active');
}

function closeMuteModal() {
    blockModal.classList.remove('active');
}

btnCloseModal.addEventListener('click', closeMuteModal);
blockModal.addEventListener('click', (e) => {
    if (e.target === blockModal) closeMuteModal();
});

// Adiciona palavra-chave silenciada
function addMutedKeyword(word) {
    const cleaned = word.trim().toLowerCase();
    if (cleaned && !mutedKeywords.includes(cleaned)) {
        mutedKeywords.push(cleaned);
        saveMutedKeywords();
        renderMutedKeywords();
        renderFeed(); // Atualiza feed principal excluindo as combinadas
    }
}

// Remove palavra-chave silenciada
function removeMutedKeyword(word) {
    mutedKeywords = mutedKeywords.filter(k => k !== word);
    saveMutedKeywords();
    renderMutedKeywords();
    renderFeed(); // Atualiza feed reinserindo notícias antigas que estavam silenciadas
}

// Renderiza badges das palavras bloqueadas
function renderMutedKeywords() {
    keywordsList.innerHTML = '';
    if (mutedKeywords.length === 0) {
        keywordsList.innerHTML = '<p style="color: var(--text-muted)">Nenhuma palavra-chave silenciada até o momento.</p>';
        return;
    }

    mutedKeywords.forEach(word => {
        const badge = document.createElement('span');
        badge.className = 'keyword-badge';
        badge.innerHTML = `
            ${word} 
            <button title="Remover filtro"><i class="fa-solid fa-xmark"></i></button>
        `;
        badge.querySelector('button').addEventListener('click', () => removeMutedKeyword(word));
        keywordsList.appendChild(badge);
    });
}

// Salva palavras de exceção no localStorage
function saveExceptionKeywords() {
    localStorage.setItem('news_reader_exceptions', JSON.stringify(exceptionKeywords));
}

// Adiciona palavra-chave de exceção
function addExceptionKeyword(word) {
    const cleaned = word.trim().toLowerCase();
    if (cleaned && !exceptionKeywords.includes(cleaned)) {
        exceptionKeywords.push(cleaned);
        saveExceptionKeywords();
        renderExceptionKeywords();
        renderFeed(); // Atualiza o feed que pode agora exibir notícias antes ocultas
    }
}

// Remove palavra-chave de exceção
function removeExceptionKeyword(word) {
    exceptionKeywords = exceptionKeywords.filter(k => k !== word);
    saveExceptionKeywords();
    renderExceptionKeywords();
    renderFeed(); // Oculta notícias se elas agora não corresponderem a nenhuma exceção
}

// Renderiza badges das palavras de exceção
function renderExceptionKeywords() {
    exceptionsList.innerHTML = '';
    if (exceptionKeywords.length === 0) {
        exceptionsList.innerHTML = '<p style="color: var(--text-muted)">Nenhuma exceção configurada. Qualquer termo silenciado bloqueará as matérias.</p>';
        return;
    }

    exceptionKeywords.forEach(word => {
        const badge = document.createElement('span');
        badge.className = 'keyword-badge';
        badge.style.background = 'rgba(16, 185, 129, 0.12)';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
        badge.style.color = '#a7f3d0';
        badge.innerHTML = `
            ${word} 
            <button title="Remover exceção" style="color: var(--success-color);"><i class="fa-solid fa-xmark"></i></button>
        `;
        badge.querySelector('button').addEventListener('click', () => removeExceptionKeyword(word));
        exceptionsList.appendChild(badge);
    });
}

// Formulário de adição de palavras-chave na aba Filtros
btnAddKeyword.addEventListener('click', () => {
    const val = keywordInput.value;
    if (val) {
        addMutedKeyword(val);
        keywordInput.value = '';
    }
});

keywordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = keywordInput.value;
        if (val) {
            addMutedKeyword(val);
            keywordInput.value = '';
        }
    }
});

// Formulário de adição de exceções na aba Filtros
btnAddException.addEventListener('click', () => {
    const val = exceptionInput.value;
    if (val) {
        addExceptionKeyword(val);
        exceptionInput.value = '';
    }
});

exceptionInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = exceptionInput.value;
        if (val) {
            addExceptionKeyword(val);
            exceptionInput.value = '';
        }
    }
});

// Controla a visibilidade do botão flutuante (FAB)
function updateFabVisibility() {
    const isFeedActive = !secFeed.classList.contains('hidden');
    const isHistoryActive = !secHistory.classList.contains('hidden');
    const isSavedActive = !secSaved.classList.contains('hidden');
    
    // Conta cards que não possuem a classe de opacidade reduzida ou marcação de lidos
    const visibleUnreadCards = Array.from(newsGrid.querySelectorAll('.news-card')).filter(card => {
        return !readUrls.has(card.dataset.url) && card.style.opacity !== '0.35';
    });

    if (isFeedActive && visibleUnreadCards.length > 0) {
        btnNextNews.classList.remove('hidden');
    } else {
        btnNextNews.classList.add('hidden');
    }

    // Gerencia o botão FAB verde para rolar para o topo da lista de lidas ou salvas
    const hasHistoryCards = historyGrid.querySelectorAll('.news-card').length > 0;
    const hasSavedCards = savedGrid.querySelectorAll('.news-card').length > 0;
    
    if ((isHistoryActive && hasHistoryCards) || (isSavedActive && hasSavedCards)) {
        btnTopHistory.classList.remove('hidden');
    } else {
        btnTopHistory.classList.add('hidden');
    }
}

// Rola suavemente até o próximo item não lido do feed de forma sequencial real
function scrollToNextUnread() {
    const cards = Array.from(newsGrid.querySelectorAll('.news-card'));
    const unreadCards = cards.filter(card => {
        return !readUrls.has(card.dataset.url) && card.style.opacity !== '0.35';
    });

    if (unreadCards.length === 0) {
        updateFabVisibility();
        return;
    }

    // Acha a notícia atualmente mais próxima do topo da tela (focada)
    let currentIndex = -1;
    let minDiff = Infinity;
    let currentCardRect = null;
    cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        const diff = Math.abs(rect.top - 85);
        if (diff < minDiff) {
            minDiff = diff;
            currentIndex = index;
            currentCardRect = rect;
        }
    });

    const isDesktop = window.innerWidth > 768;

    // Procura a primeira notícia não lida abaixo da atual (ou em uma linha inferior se for desktop)
    let nextCard = null;
    for (let i = currentIndex + 1; i < cards.length; i++) {
        const card = cards[i];
        if (!readUrls.has(card.dataset.url) && card.style.opacity !== '0.35') {
            if (isDesktop && currentCardRect) {
                const cardRect = card.getBoundingClientRect();
                // O topo do próximo card precisa estar pelo menos 50px abaixo do topo do card atual (nova linha)
                if (cardRect.top > currentCardRect.top + 50) {
                    nextCard = card;
                    break;
                }
            } else {
                nextCard = card;
                break;
            }
        }
    }

    // Se não houver mais nenhuma não lida abaixo do ponto atual, rola para a primeira não lida da lista
    if (!nextCard) {
        nextCard = unreadCards[0];
    }

    if (nextCard) {
        nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Dispara o fluxo do GitHub Actions remotamente com indicador de progresso e recarregamento automático
async function triggerGitHubUpdate() {
    if (!githubToken) {
        alert("Por favor, configure seu Token do GitHub na aba 'Filtros' para ativar a atualização sob demanda.");
        switchSection(btnSettings, secSettings);
        return;
    }

    const icon = btnTriggerUpdate.querySelector('i');
    icon.classList.add('spin');
    btnTriggerUpdate.disabled = true;

    let owner = "jeffersonadv";
    let repo = "news-reader";
    
    const host = window.location.hostname;
    const path = window.location.pathname;
    
    if (host.includes('.github.io')) {
        owner = host.split('.')[0];
        repo = path.split('/')[1] || "news-reader";
    }

    const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/update_news.yml/dispatches`;
    const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs?workflow_id=update_news.yml&per_page=1`;

    try {
        const response = await fetch(dispatchUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ref: 'main' })
        });

        if (response.status !== 204) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `Código HTTP ${response.status}`);
        }

        // --- INICIALIZA E EXIBE O OVERLAY DE CARREGAMENTO ---
        updateProgressBar.style.width = '0%';
        updateStatusText.textContent = 'Disparando robô no GitHub...';
        updateLoadingOverlay.classList.add('active');

        let progress = 0;
        const duration = 20000; // 20 segundos de limite estimado
        const intervalTime = 100; // Incrementa a cada 100ms
        const totalSteps = duration / intervalTime;
        const startTime = Date.parse(new Date().toUTCString());

        // Timer para animação da barra de progresso (limita em 92% até que a API retorne sucesso)
        const progressInterval = setInterval(() => {
            if (progress < 92) {
                progress += 92 / totalSteps;
                updateProgressBar.style.width = `${Math.min(progress, 92)}%`;
            }
        }, intervalTime);

        // Polling para checar o status do workflow no GitHub
        let checkCount = 0;
        const checkInterval = setInterval(async () => {
            checkCount++;
            updateStatusText.textContent = `Aguardando raspagem (tentativa ${checkCount})...`;

            try {
                const runRes = await fetch(runsUrl, {
                    headers: {
                        'Authorization': `Bearer ${githubToken}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                
                if (runRes.ok) {
                    const runData = await runRes.json();
                    const latestRun = runData.workflow_runs && runData.workflow_runs[0];
                    
                    if (latestRun) {
                        const runCreatedTime = Date.parse(latestRun.created_at);
                        const isOurRun = runCreatedTime >= (startTime - 60000); // Iniciado no último minuto

                        if (isOurRun) {
                            if (latestRun.status === 'completed') {
                                clearInterval(checkInterval);
                                clearInterval(progressInterval);
                                
                                if (latestRun.conclusion === 'success') {
                                    updateStatusText.textContent = 'Notícias atualizadas com sucesso! Atualizando feed...';
                                    updateProgressBar.style.width = '100%';
                                    
                                    // Aguarda 1 segundo e recarrega os dados de notícias localmente
                                    setTimeout(async () => {
                                        await loadNews();
                                        updateLoadingOverlay.classList.remove('active');
                                    }, 1000);
                                } else {
                                    updateStatusText.textContent = `Robô falhou: ${latestRun.conclusion}`;
                                    setTimeout(() => {
                                        updateLoadingOverlay.classList.remove('active');
                                        alert("O robô do GitHub falhou ao executar a raspagem. Veja os detalhes no seu painel de Actions.");
                                    }, 2000);
                                }
                            } else if (latestRun.status === 'in_progress') {
                                updateStatusText.textContent = 'Robô em execução: raspando notícias do UOL...';
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Erro ao verificar status do workflow:", err);
            }

            // Fallback de tempo limite (25 segundos)
            if (checkCount >= 10) { // 10 checagens de 3s = 30 segundos
                clearInterval(checkInterval);
                clearInterval(progressInterval);
                updateStatusText.textContent = 'Tempo limite atingido. Tentando recarregar feed...';
                updateProgressBar.style.width = '100%';
                
                setTimeout(async () => {
                    await loadNews();
                    updateLoadingOverlay.classList.remove('active');
                }, 1000);
            }
        }, 3000); // Checa a cada 3 segundos

    } catch (error) {
        console.error("Erro ao disparar atualização:", error);
        alert(`Erro ao atualizar: ${error.message}. Verifique se o seu Token está correto e tem permissão 'actions:write'.`);
    } finally {
        icon.classList.remove('spin');
        btnTriggerUpdate.disabled = false;
    }
}

// Evento de salvamento do token (inicia sincronização imediatamente se configurado)
btnSaveToken.addEventListener('click', () => {
    const val = githubTokenInput.value.trim();
    githubToken = val;
    localStorage.setItem('news_reader_gh_token', val);
    alert("Token do GitHub salvo com sucesso!");
    if (githubToken) {
        loadSyncDataFromRepo().then(() => {
            syncWithRepo();
        });
    } else {
        updateSyncStatusUI('no_token');
    }
});

// Evento de disparo da atualização
btnTriggerUpdate.addEventListener('click', triggerGitHubUpdate);

// Evento de clique para pular para a próxima notícia
btnNextNews.addEventListener('click', scrollToNextUnread);

// Botão de Sincronização Manual (Forçar Sincronização)
btnForceSync.addEventListener('click', async () => {
    const icon = btnForceSync.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    btnForceSync.disabled = true;
    try {
        await loadSyncDataFromRepo();
        await syncWithRepo();
    } catch (err) {
        console.error(err);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
        btnForceSync.disabled = false;
    }
});

// Busca dinâmica nas três abas principais
searchInput.addEventListener('input', () => {
    const activeSection = document.querySelector('.content-section:not(.hidden)');
    if (activeSection === secFeed) {
        renderFeed();
    } else if (activeSection === secHistory) {
        renderHistory();
    } else if (activeSection === secSaved) {
        renderSaved();
    }
    updateFabVisibility();
});

// Evento de clique para pular para o topo da aba Lidas ou Salvas
btnTopHistory.addEventListener('click', () => {
    const activeSection = document.querySelector('.content-section:not(.hidden)');
    if (activeSection) {
        const firstCard = activeSection.querySelector('.news-card');
        if (firstCard) {
            firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
});

// Limpar todo histórico (zera a aba Lidas, mas NÃO devolve ao Feed)
btnClearHistory.addEventListener('click', async () => {
    if (confirm('Tem certeza de que deseja limpar o histórico de leitura?\n\nAs notícias já lidas continuarão ocultas do Feed.')) {
        // Marca o momento do clear ANTES de qualquer await, para bloquear syncs em voo
        lastClearTime = Date.now();
        // Limpa APENAS historyUrls (aba Lidas) — readUrls (filtro do Feed) permanece intacto
        historyUrls.clear();
        localStorage.setItem('news_reader_history', JSON.stringify([]));
        updateHistoryCount();
        renderHistory();
        updateFabVisibility();
        // Aguarda um tick para dar tempo aos syncs em voo de detectarem o lastClearTime
        await new Promise(r => setTimeout(r, 100));
        // Sobrescreve a nuvem sem mesclar (evita que os dados limpados voltem)
        await overwriteRepoSync();
    }
});

// Limpar notícias salvas
btnClearSaved.addEventListener('click', async () => {
    if (confirm('Tem certeza de que deseja remover todas as notícias salvas?')) {
        // Marca o momento do clear ANTES de qualquer await, para bloquear syncs em voo
        lastClearTime = Date.now();
        savedUrls.clear();
        localStorage.setItem('news_reader_saved', JSON.stringify([]));
        updateSavedCount();
        renderSaved();
        updateFabVisibility();
        // Aguarda um tick para dar tempo aos syncs em voo de detectarem o lastClearTime
        await new Promise(r => setTimeout(r, 100));
        // Sobrescreve a nuvem sem mesclar (evita que os dados limpos voltem)
        await overwriteRepoSync();
    }
});

// Inicia aplicação
document.addEventListener('DOMContentLoaded', () => {
    loadNews();
    updateSavedCount();
    updateFabVisibility();
    
    // Inicializa o status do backup/sincronização na aba filtros
    if (!githubToken) {
        updateSyncStatusUI('no_token');
    } else {
        updateSyncStatusUI('loading', 'Aguardando carregamento inicial...');
    }
});
