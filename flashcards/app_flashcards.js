import { Lost } from '/lost.js';
import { LostUI } from '/lost-ui.js';

const DEFAULT_CONTENT = `English - Latin
Hello - Salve
Goodbye - Vale
Cat - Felis
Dog - Canis
Friend - Amicus
Thank you - Gratias
Yes - Ita
No - Minime
Sun - Sol
Moon - Luna`;

const DEFAULT_DATA = {
    title: 'Basic Latin',
    rawContent: DEFAULT_CONTENT,
    _progress: {}
};

class FlashcardsApp {
    constructor() {
        this.lost = new Lost({
            storageKey: 'app-flashcards-v1',
            defaultData: DEFAULT_DATA,
        });

        this.lost.addEventListener('update', (e) => this.onUpdate(e.detail));

        this.ui = new LostUI(this.lost, {
            container: document.body,
            showLightDarkButton: true,
            header: {
                title: 'Flashcards',
                extraContent: () => {
                    const btn = document.createElement('button');
                    btn.innerHTML = '⚙️';
                    btn.className = 'action-btn';
                    btn.onclick = () => this.openConfig();
                    return btn;
                }
            },
            sidebar: {
                heading: 'Decks',
                onNew: () => this.createDeck(),
                title: (item) => item.title || 'Untitled Deck',
                subline: (item) => {
                    const lineCount = item.rawContent ? item.rawContent.split('\n').length - 1 : 0;
                    return `${Math.max(0, lineCount)} cards`;
                }
            }
        });

        this.elements = {
            screens: {
                selection: document.getElementById('selection-screen'),
                quiz: document.getElementById('quiz-screen'),
                results: document.getElementById('results-screen'),
            },
            selection: {
                frontBtn: document.getElementById('choose-front'),
                backBtn: document.getElementById('choose-back'),
                frontLabel: document.getElementById('label-front-main'),
                backLabel: document.getElementById('label-back-main'),
            },
            quiz: {
                card: document.getElementById('card'),
                frontText: document.getElementById('card-text-front'),
                backText: document.getElementById('card-text-back'),
                flipHint: document.getElementById('flip-hint'),
                answerButtons: document.getElementById('answer-buttons'),
                btnRight: document.getElementById('btn-right'),
                btnWrong: document.getElementById('btn-wrong'),
                progressFill: document.getElementById('progress-fill'),
            },
            results: {
                stats: document.getElementById('results-stats'),
                restartBtn: document.getElementById('btn-restart'),
            },
            config: {
                dialog: document.getElementById('configDialog'),
                title: document.getElementById('configTitle'),
                content: document.getElementById('configContent'),
                closeBtn: document.getElementById('configCloseBtn'),
            }
        };

        // Session state defaults
        this.defaultSession = {
            active: false,
            mode: 'selection',
            deckSide: 'front',
            queue: [],
            currentIndex: 0,
            flipped: false,
            stats: { right: 0, wrong: 0 }
        };
        this.session = { ...this.defaultSession };

        this.bindEvents();
        this.init();
    }

    async init() {
        this.lost.load();
        this.ui.load();
    }

    bindEvents() {
        // Selection
        this.elements.selection.frontBtn.onclick = () => this.startQuiz('front');
        this.elements.selection.backBtn.onclick = () => this.startQuiz('back');

        // Quiz
        this.elements.quiz.card.onclick = () => this.flipCard();
        this.elements.quiz.btnRight.onclick = (e) => { e.stopPropagation(); this.answer(true); };
        this.elements.quiz.btnWrong.onclick = (e) => { e.stopPropagation(); this.answer(false); };

        // Results
        this.elements.results.restartBtn.onclick = () => this.resetSession();

        // Config
        this.elements.config.closeBtn.onclick = () => this.elements.config.dialog.close();
        
        this.elements.config.title.addEventListener('input', (e) => {
            const item = this.lost.getCurrent();
            if(item) this.lost.update(item.id, { title: e.target.value });
        });
        
        this.elements.config.content.addEventListener('change', (e) => { 
            const item = this.lost.getCurrent();
            if(item) {
                 this.lost.update(item.id, { rawContent: e.target.value });
                 // If content changes, we must invalidate the session as cards might not match
                 this.resetSession();
            }
        });
    }

    createDeck() {
        this.lost.create({ ...DEFAULT_DATA, title: 'New Deck' });
    }

    openConfig() {
        const item = this.lost.getCurrent();
        if (!item) return;
        
        this.elements.config.title.value = item.title;
        this.elements.config.content.value = item.rawContent;
        this.elements.config.dialog.showModal();
    }

    onUpdate(item) {
        if (!item) return;
        
        const isDeckSwitch = this.currentDeckId !== item.id;
        this.currentDeckId = item.id;
        
        // Load session from item or use default
        // We clone it to avoid mutating the stored object directly
        this.session = item._session ? JSON.parse(JSON.stringify(item._session)) : { ...this.defaultSession };

        // Update Headers in Selection Screen
        const { headers } = this.parseDeck(item.rawContent);
        const sideA = headers[0] || 'Side A';
        const sideB = headers[1] || 'Side B';

        this.elements.selection.frontLabel.textContent = sideA;
        this.elements.selection.backLabel.textContent = sideB;
        
        // Update sub-labels
        this.elements.selection.frontBtn.querySelector('.label-sub').textContent = `to ${sideB}`;
        this.elements.selection.backBtn.querySelector('.label-sub').textContent = `to ${sideA}`;
        
        this.render(isDeckSwitch);
    }

    saveSession() {
        const item = this.lost.getCurrent();
        if (item) {
            this.lost.update(item.id, { _session: this.session }, false);
        }
    }

    parseDeck(raw) {
        if (!raw) return { headers: ['Front', 'Back'], cards: [] };
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length === 0) return { headers: ['Front', 'Back'], cards: [] };

        // First line is headers
        const headerLine = lines[0];
        let headers = ['Front', 'Back'];
        const headerSepIdx = headerLine.indexOf('-');
        if (headerSepIdx !== -1) {
             headers = [
                 headerLine.substring(0, headerSepIdx).trim(),
                 headerLine.substring(headerSepIdx + 1).trim()
             ];
        }

        const cards = lines.slice(1).map((line, index) => {
            const sepIdx = line.indexOf('-');
            if (sepIdx === -1) return null;
            
            const front = line.substring(0, sepIdx).trim();
            const back = line.substring(sepIdx + 1).trim();
            
            if (!front || !back) return null;

            return {
                id: line, 
                front,
                back,
                index: index
            };
        }).filter(c => c !== null);

        return { headers, cards };
    }

    resetSession() {
        this.session = { ...this.defaultSession };
        this.saveSession();
        this.render();
    }

    startQuiz(side) { 
        const item = this.lost.getCurrent();
        if (!item) return;

        const { cards } = this.parseDeck(item.rawContent);
        if (cards.length === 0) {
            alert('Please add some cards in settings first!');
            return;
        }

        // Shuffle
        const queue = [...cards].sort(() => Math.random() - 0.5);

        this.session = {
            active: true,
            mode: 'quiz',
            deckSide: side,
            queue: queue,
            currentIndex: 0,
            flipped: false,
            stats: { right: 0, wrong: 0 }
        };

        this.saveSession();
        this.render();
    }

    flipCard() {
        if (this.session.flipped) return; 
        this.session.flipped = true;
        this.saveSession();
        this.render();
    }

    answer(isRight) {
        const card = this.session.queue[this.session.currentIndex];
        
        if (isRight) this.session.stats.right++;
        else this.session.stats.wrong++;

        this.saveCardProgress(card.id, isRight);

        this.session.currentIndex++;
        if (this.session.currentIndex >= this.session.queue.length) {
            this.session.mode = 'results';
        } else {
            this.session.flipped = false;
        }
        
        this.saveSession();
        this.render();
    }

    saveCardProgress(cardId, isRight) {
        const item = this.lost.getCurrent();
        if (!item) return;

        const progress = { ...(item._progress || {}) };
        
        const now = Date.now();
        const cardStats = progress[cardId] || { seen: 0, right: 0, wrong: 0 };
        
        cardStats.seen = (cardStats.seen || 0) + 1;
        cardStats.lastSeen = now;
        if (isRight) {
            cardStats.right = (cardStats.right || 0) + 1;
            cardStats.lastRight = now;
        } else {
            cardStats.wrong = (cardStats.wrong || 0) + 1;
        }

        progress[cardId] = cardStats;
        this.lost.update(item.id, { _progress: progress }, false);
    }

    render(forceNoTransition = false) {
        // Screens visibility
        Object.values(this.elements.screens).forEach(el => el.classList.add('hidden'));
        
        if (this.session.mode === 'selection') {
            this.elements.screens.selection.classList.remove('hidden');
        } else if (this.session.mode === 'quiz') {
            this.elements.screens.quiz.classList.remove('hidden');
            this.renderQuiz(forceNoTransition);
        } else if (this.session.mode === 'results') {
            this.elements.screens.results.classList.remove('hidden');
            this.renderResults();
        }
    }

    renderQuiz(forceNoTransition = false) {
        const card = this.session.queue[this.session.currentIndex];
        if (!card) return; 

        // Check if we switched cards to suppress transition
        const isNewCard = this.lastRenderedIndex !== this.session.currentIndex;
        this.lastRenderedIndex = this.session.currentIndex;

        const suppress = forceNoTransition || isNewCard;

        const side = this.session.deckSide;
        const qText = side === 'front' ? card.front : card.back;
        const aText = side === 'front' ? card.back : card.front;

        this.elements.quiz.frontText.textContent = qText;
        this.elements.quiz.backText.textContent = aText;

        // Flip state
        if (suppress) {
             // Force instant reset
             this.elements.quiz.card.style.transition = 'none';
             if (this.session.flipped) {
                 this.elements.quiz.card.classList.add('flipped');
             } else {
                 this.elements.quiz.card.classList.remove('flipped');
             }
             this.elements.quiz.card.offsetHeight; // Force reflow
             this.elements.quiz.card.style.transition = '';
        } else {
            // Normal toggle with animation
            if (this.session.flipped) {
                this.elements.quiz.card.classList.add('flipped');
            } else {
                this.elements.quiz.card.classList.remove('flipped');
            }
        }
        
        if (this.session.flipped) {
            this.elements.quiz.flipHint.classList.add('hidden');
            this.elements.quiz.answerButtons.classList.remove('hidden');
        } else {
            this.elements.quiz.flipHint.classList.remove('hidden');
            this.elements.quiz.answerButtons.classList.add('hidden');
        }

        // Progress
        const total = this.session.queue.length;
        const current = this.session.currentIndex;
        const pct = total > 0 ? (current / total) * 100 : 0;
        this.elements.quiz.progressFill.style.width = `${pct}%`;
    }

    renderResults() {
        const { right, wrong } = this.session.stats;
        const total = right + wrong;
        const pct = total === 0 ? 0 : Math.round((right / total) * 100);
        
        this.elements.results.stats.innerHTML = `
            Cards: ${total}<br>
            Correct: <span style="color:var(--success-color)">${right}</span><br>
            Incorrect: <span style="color:var(--danger-color)">${wrong}</span><br>
            <strong>Score: ${pct}%</strong>
        `;
    }
}

new FlashcardsApp();
