// Configurações e Estado do App
let newsData = [];
let readUrls = new Set(JSON.parse(localStorage.getItem('news_reader_read') || '[]'));
let mutedKeywords = JSON.parse(localStorage.getItem('news_reader_muted') || '[]');
// Exceções de notícias relevantes que ignoram o silenciamento
const DEFAULT_EXCEPTIONS = ["investiga", "fraude", "desvio", "polícia", "preso", "presa", "prisão", "processo", "justiça", "denúncia", "crime", "acusa", "morte", "morreu", "matou", "matar"];
let exceptionKeywords = JSON.parse(localStorage.getItem('news_reader_exceptions') || JSON.stringify(DEFAULT_EXCEPTIONS));

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
const secSettings = document.getElementById('sec-settings');
const newsGrid = document.getElementById('news-grid');
const historyGrid = document.getElementById('history-grid');
const keywordsList = document.getElementById('keywords-list');
const keywordInput = document.getElementById('keyword-input');
const searchInput = document.getElementById('search-input');
const historyCountSpan = document.getElementById('history-count');

// Elementos de Navegação
const btnFeed = document.getElementById('btn-feed');
const btnHistory = document.getElementById('btn-history');
const btnSettings = document.getElementById('btn-settings');
const btnAddKeyword = document.getElementById('btn-add-keyword');
const btnClearHistory = document.getElementById('btn-clear-history');

// Elementos de Exceções
const exceptionsList = document.getElementById('exceptions-list');
const exceptionInput = document.getElementById('exception-input');
const btnAddException = document.getElementById('btn-add-exception');

// Elementos do Modal de Bloqueio
const blockModal = document.getElementById('block-modal');
const modalWordsList = document.getElementById('modal-words-list');
const btnCloseModal = document.getElementById('close-modal');

// Roteador de Seções (Tabs)
function switchSection(activeButton, sectionToShow) {
    [btnFeed, btnHistory, btnSettings].forEach(btn => btn.classList.remove('active'));
    [secFeed, secHistory, secSettings].forEach(sec => sec.classList.add('hidden'));
    
    activeButton.classList.add('active');
    sectionToShow.classList.remove('hidden');

    // Sempre re-renderiza ao trocar de aba para refletir novos estados
    if (sectionToShow === secFeed) {
        renderFeed();
    } else if (sectionToShow === secHistory) {
        renderHistory();
    } else if (sectionToShow === secSettings) {
        renderMutedKeywords();
        renderExceptionKeywords();
    }
}

btnFeed.addEventListener('click', () => switchSection(btnFeed, secFeed));
btnHistory.addEventListener('click', () => switchSection(btnHistory, secHistory));
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

// Atualiza o contador de histórico no menu
function updateHistoryCount() {
    historyCountSpan.textContent = readUrls.size;
}

// Salva o histórico de lidas no localStorage
function saveReadHistory() {
    localStorage.setItem('news_reader_read', JSON.stringify(Array.from(readUrls)));
    updateHistoryCount();
}

// Salva palavras silenciadas no localStorage
function saveMutedKeywords() {
    localStorage.setItem('news_reader_muted', JSON.stringify(mutedKeywords));
}

// Marca notícia como lida
function markAsRead(url, cardElement, immediateRemove = true) {
    if (readUrls.has(url)) return;

    readUrls.add(url);
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
            cardElement.style.pointerEvents = 'none';
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

    const query = searchInput.value.toLowerCase().trim();
    
    // Filtra notícias: não lidas, não silenciadas e de acordo com a busca
    const filteredNews = newsData.filter(news => {
        const matchesRead = !readUrls.has(news.link);
        const matchesMute = !isMuted(news.title);
        const matchesQuery = query ? news.title.toLowerCase().includes(query) : true;
        return matchesRead && matchesMute && matchesQuery;
    });

    if (filteredNews.length === 0) {
        newsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-square-check"></i>
                <p>Tudo limpo por aqui!</p>
                <p style="font-size: 0.9rem; color: var(--text-muted);">Você leu todas as notícias ou os seus filtros silenciaram os conteúdos recentes.</p>
            </div>
        `;
        return;
    }

    filteredNews.forEach(news => {
        const card = createNewsCard(news, true);
        newsGrid.appendChild(card);
        // Observa o card para marcação automática ao rolar
        autoReadObserver.observe(card);
    });
}

// Renderiza o Histórico de Lidas
function renderHistory() {
    historyGrid.innerHTML = '';
    
    // Filtra as notícias carregadas que estão no histórico
    const readItems = newsData.filter(news => readUrls.has(news.link));

    if (readItems.length === 0) {
        historyGrid.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-history"></i>
                <p>Nenhuma notícia lida ainda.</p>
            </div>
        `;
        return;
    }

    readItems.forEach(news => {
        const card = createNewsCard(news, false);
        historyGrid.appendChild(card);
    });
}

// Cria a estrutura HTML do Card de Notícia
function createNewsCard(news, isFeedMode) {
    const card = document.createElement('article');
    card.className = 'news-card';
    card.dataset.url = news.link;

    // Trata imagens em branco com placeholder moderno
    const imgHtml = news.photo 
        ? `<img src="${news.photo}" alt="Imagem da notícia" class="card-img" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="card-img" style="background: linear-gradient(135deg, #1e293b, #0f172a); display: flex; align-items: center; justify-content: center; height: 100%; width: 100%;"><i class="fa-solid fa-newspaper" style="font-size: 2.5rem; color: rgba(255,255,255,0.1)"></i></div>`;

    card.innerHTML = `
        <div class="card-img-wrapper">
            ${imgHtml}
            <span class="card-source">${news.source || 'UOL'}</span>
        </div>
        <div class="card-content">
            <h3 class="card-title">${news.title}</h3>
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
                `}
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
        card.querySelector('.btn-mute').addEventListener('click', (e) => {
            e.stopPropagation();
            openMuteModal(news.title);
        });
    } else {
        card.querySelector('.btn-unread').addEventListener('click', () => {
            readUrls.delete(news.link);
            saveReadHistory();
            card.remove();
            const remainingHistory = historyGrid.querySelectorAll('.news-card');
            if (remainingHistory.length === 0) {
                renderHistory();
            }
        });
    }

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

// Busca dinâmica no Feed
searchInput.addEventListener('input', () => {
    renderFeed();
});

// Limpar todo histórico
btnClearHistory.addEventListener('click', () => {
    if (confirm('Tem certeza de que deseja limpar todo o seu histórico de leitura?')) {
        readUrls.clear();
        saveReadHistory();
        renderHistory();
    }
});

// Inicia aplicação
document.addEventListener('DOMContentLoaded', () => {
    loadNews();
});
