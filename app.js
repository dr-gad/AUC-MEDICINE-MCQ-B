// Application State
let selectedExams = new Set(); // Tracks selected exams in format: "CategoryName|ExamName"
let quizQuestions = [];
let currentQuestionIdx = 0;
let scoreCorrect = 0;
let scoreWrong = 0;
let answersState = []; // Tracks user answers: { selectedIdx, isCorrect }
let timerInterval = null;
let timeElapsed = 0; // in seconds
let loadedSections = new Set(); // Tracks which sections have had their question data loaded
let flagsCache = {}; // In-memory cache for flagged questions (loaded from Turso on startup)

// === Lazy Loading: dynamically load section script on demand (Offline & file:// CORS friendly) ===
async function loadSectionData(sectionName) {
  if (loadedSections.has(sectionName)) return true;

  const section = allSections.find(s => s.name === sectionName);
  if (!section || !section.dataFile) return false;

  try {
    const response = await fetch(section.dataFile);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const examsData = await response.json();

    // Merge loaded questions into the section's exam objects
    examsData.forEach(loadedExam => {
      const exam = section.exams.find(e => e.name === loadedExam.name);
      if (exam) {
        exam.questions = loadedExam.questions;
      }
    });

    loadedSections.add(sectionName);
    return true;
  } catch (err) {
    console.error(`Failed to load data for ${sectionName}:`, err);
    return false;
  }
}

// Helper: get question count for an exam (works before and after loading)
function getExamQuestionCount(exam) {
  if (exam.questions && exam.questions.length > 0) return exam.questions.length;
  return exam.questionCount || 0;
}

// Check if a section's data is loaded
function isSectionLoaded(sectionName) {
  return loadedSections.has(sectionName);
}

// Ensure all selected sections are loaded before starting
async function ensureSelectedSectionsLoaded() {
  const sectionsToLoad = new Set();
  selectedExams.forEach(key => {
    const secName = key.split('|')[0];
    if (!loadedSections.has(secName)) sectionsToLoad.add(secName);
  });

  const promises = [...sectionsToLoad].map(name => loadSectionData(name));
  const results = await Promise.all(promises);
  if (results.includes(false)) {
    throw new Error('Failed to load some sections');
  }
}

// Ensure all enabled sections are loaded in memory (e.g. for search or saved quiz review)
async function ensureAllEnabledSectionsLoaded() {
  const sectionsToLoad = allSections.filter(s => !s.disabled && s.dataFile && !loadedSections.has(s.name));
  const promises = sectionsToLoad.map(s => loadSectionData(s.name));
  await Promise.all(promises);
}


// User flow management
function initUsernameFlow() {
  const studentCode = localStorage.getItem('auc_mcq_student_code');
  const studentName = localStorage.getItem('auc_mcq_student_name');
  if (!studentCode || !studentName) {
    showUsernameModal();
  } else {
    updateUserBadge(studentName, studentCode);
    completeInitialization();
  }
}

async function completeInitialization() {
  // Load flagged questions from Turso server
  await loadFlagsFromTurso();
  updateSavedCounts();
  await loadPerformanceStats();

  // Restore quiz progress (may need flags for display)
  await restoreQuizProgress();
}

async function loadPerformanceStats() {
  try {
    const stats = await tursoGetStats();
    const tests = Number(stats.tests) || 0;
    const questions = Number(stats.questions) || 0;
    const correct = Number(stats.correct) || 0;
    const summary = document.getElementById('performance-summary');
    if (summary) summary.style.display = tests > 0 ? 'block' : 'none';
    const testsEl = document.getElementById('stats-tests');
    const questionsEl = document.getElementById('stats-questions');
    const averageEl = document.getElementById('stats-average');
    if (testsEl) testsEl.textContent = tests;
    if (questionsEl) questionsEl.textContent = questions;
    if (averageEl) averageEl.textContent = `${questions ? Math.round((correct / questions) * 100) : 0}%`;
  } catch (e) {
    console.warn('تعذر تحميل الإحصائيات:', e);
  }
}

function showUsernameModal() {
  const modal = document.getElementById('username-modal');
  if (!modal) return;
  modal.classList.add('active');

  const input = document.getElementById('username-input');
  const errorEl = document.getElementById('username-error');
  const submitBtn = document.getElementById('username-submit-btn');
  const normalActions = document.getElementById('username-normal-actions');
  const conflictActions = document.getElementById('username-conflict-actions');
  const restoreBtn = document.getElementById('username-restore-btn');
  const retryBtn = document.getElementById('username-retry-btn');
  const codeInput = document.getElementById('student-code-input');
  const codeActions = document.getElementById('student-code-actions');
  const codeSubmitBtn = document.getElementById('student-code-submit-btn');
  const codeRestoreBtn = document.getElementById('student-code-restore-btn');

  if (input) {
    input.value = '';
    input.focus();
  }
  if (errorEl) errorEl.style.display = 'none';
  if (normalActions) normalActions.style.display = 'block';
  if (conflictActions) conflictActions.style.display = 'none';
  if (codeActions) codeActions.style.display = 'none';

  // Helper to handle name checking
  const handleNameSubmit = async () => {
    const rawVal = input.value || '';
    const name = rawVal.trim();
    if (name.length < 3) {
      showModalError('يرجى إدخال اسم ثلاثي أو ثنائي واضح (3 أحرف على الأقل)');
      return;
    }

    // Alphanumeric, spaces, Arabic letters, underscores, hyphens
    const nameRegex = /^[\u0600-\u06FFa-zA-Z0-9_\-\s]+$/;
    if (!nameRegex.test(name)) {
      showModalError('الاسم يحتوي على رموز غير مسموح بها. استخدم الحروف والأرقام والمسافات فقط.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner-small"></span> جاري التحقق...';

    try {
      // Check if this username already has flags in Turso for this subject
      const student = await registerTursoStudent(name);
      modal.classList.remove('active');
      updateUserBadge(student.name, student.code);
      await completeInitialization();
      showToast(`أهلاً بك يا ${student.name}! كودك الخاص: ${student.code}`);
    } catch (e) {
      console.error(e);
      showModalError('حدث خطأ أثناء الاتصال بالسيرفر. يرجى المحاولة مرة أخرى.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'بدء الدراسة 🚀';
    }
  };

  submitBtn.onclick = handleNameSubmit;
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && normalActions.style.display !== 'none') {
      handleNameSubmit();
    }
  };

  const handleCodeSubmit = async () => {
    const code = (codeInput.value || '').trim().toUpperCase();
    if (!/^MED-[A-Z0-9]{6}$/.test(code)) {
      showModalError('يرجى كتابة الكود بالشكل الصحيح، مثل MED-AB12CD');
      return;
    }
    codeSubmitBtn.disabled = true;
    try {
      const student = await getTursoStudent(code);
      setTursoStudent({ name: student.student_name, code: student.student_code });
      modal.classList.remove('active');
      updateUserBadge(student.student_name, student.student_code);
      await completeInitialization();
      showToast(`تم استرجاع أسئلتك يا ${student.student_name}`);
    } catch (e) {
      showModalError('الكود غير صحيح أو غير موجود. تأكد من كتابته كما هو.');
    } finally {
      codeSubmitBtn.disabled = false;
    }
  };
  if (codeSubmitBtn) codeSubmitBtn.onclick = handleCodeSubmit;
  if (codeRestoreBtn) codeRestoreBtn.onclick = () => {
    normalActions.style.display = 'none';
    conflictActions.style.display = 'none';
    if (codeActions) codeActions.style.display = 'block';
    if (codeInput) codeInput.focus();
  };

  restoreBtn.onclick = async () => {
    normalActions.style.display = 'none';
    conflictActions.style.display = 'none';
    if (codeActions) codeActions.style.display = 'block';
    if (codeInput) codeInput.focus();
  };

  retryBtn.onclick = () => {
    normalActions.style.display = 'block';
    conflictActions.style.display = 'none';
    input.value = '';
    input.focus();
  };
}

function showModalError(msg) {
  const errorEl = document.getElementById('username-error');
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
}

function updateUserBadge(username, code) {
  const container = document.getElementById('user-badge-container');
  if (container) {
    container.innerHTML = `
      <div class="user-badge">
        👤 الطالب: <strong>${escapeAttr(username)}</strong> · الكود: <strong>${escapeAttr(code || '')}</strong>
      </div>
    `;
    container.style.display = 'block';
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  renderCategories();
  bindStaticEvents();
  bindKeyboardNavigation();
  initSearch();
  initUsernameFlow();

  // Preload all sections in the background for instant calculation and zero-wait starting
  allSections.forEach(sec => {
    if (!sec.disabled && sec.dataFile) {
      loadSectionData(sec.name).then(() => {
        updateTotalCounter();
      }).catch(err => console.error("Error preloading section:", sec.name, err));
    }
  });
});

// Wire all static button event listeners (replaces inline onclick in HTML)
function bindStaticEvents() {
  // Setup screen
  document.getElementById('start-btn')
    .addEventListener('click', () => startQuiz());
  document.getElementById('start-saved-very-important-btn')
    .addEventListener('click', () => startSavedQuiz('very_important'));
  document.getElementById('start-saved-important-btn')
    .addEventListener('click', () => startSavedQuiz('important'));
  document.getElementById('start-saved-all-important-btn')
    .addEventListener('click', () => startSavedQuiz('all'));
  document.getElementById('clear-all-flags-btn')
    .addEventListener('click', () => clearAllFlags());

  document.querySelectorAll('input[name="deduplicate"]').forEach(input => {
    input.addEventListener('change', () => updateTotalCounter());
  });

  // Quiz screen navigation
  document.getElementById('btn-next')
    .addEventListener('click', () => nextQuestion());
  document.getElementById('btn-prev')
    .addEventListener('click', () => prevQuestion());
  document.getElementById('btn-finish')
    .addEventListener('click', () => finishQuiz());

  // Flag buttons — event delegation on the container (buttons are re-rendered per question)
  document.getElementById('question-flags')
    .addEventListener('click', (e) => {
      const btn = e.target.closest('[data-flag-type]');
      if (btn) toggleFlagCurrentQuestion(btn.dataset.flagType, btn);
    });

  // Results screen
  document.getElementById('review-wrong-btn')
    .addEventListener('click', () => reviewWrongAnswers());
  document.getElementById('review-skipped-btn')
    .addEventListener('click', () => reviewSkippedAnswers());
  document.getElementById('review-wrong-skipped-btn')
    .addEventListener('click', () => reviewWrongAndSkippedAnswers());
  document.getElementById('review-very-important-btn')
    .addEventListener('click', () => reviewCurrentQuizFlagged('very_important'));
  document.getElementById('review-important-btn')
    .addEventListener('click', () => reviewCurrentQuizFlagged('important'));
  document.getElementById('review-all-important-btn')
    .addEventListener('click', () => reviewCurrentQuizFlagged('all'));
  document.getElementById('btn-reset-app')
    .addEventListener('click', () => resetApp());

  // Study Mode events
  const studyBtn = document.getElementById('study-btn');
  if (studyBtn) {
    studyBtn.addEventListener('click', () => startStudyMode());
  }
  const backSetupBtn = document.getElementById('btn-back-setup');
  if (backSetupBtn) {
    backSetupBtn.addEventListener('click', () => backToSetupFromStudy());
  }
  const studySearchInput = document.getElementById('study-search-input');
  if (studySearchInput) {
    studySearchInput.addEventListener('input', () => debounceStudySearch());
  }
  const studySearchClear = document.getElementById('study-search-clear');
  if (studySearchClear) {
    studySearchClear.addEventListener('click', () => {
      if (studySearchInput) {
        studySearchInput.value = '';
        filterStudyQuestions();
        studySearchInput.focus();
      }
    });
  }
}

// Keyboard Navigation — only active when quiz screen is visible
function bindKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Ignore if an input/textarea is focused
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const quizScreen = document.getElementById('quiz-screen');
    if (!quizScreen || !quizScreen.classList.contains('active')) return;

    switch (e.key) {
      // Next question: → or L
      case 'ArrowRight':
      case 'l':
      case 'L':
        e.preventDefault();
        nextQuestion();
        break;

      // Previous question: ← or H
      case 'ArrowLeft':
      case 'h':
      case 'H':
        e.preventDefault();
        prevQuestion();
        break;

      // Select answer: 1–5 maps to option A–E
      case '1': case '2': case '3': case '4': case '5': {
        if (answersState[currentQuestionIdx] !== null) break; // already answered
        const idx = parseInt(e.key, 10) - 1;
        const currentQ = quizQuestions[currentQuestionIdx];
        if (currentQ && idx < currentQ.options.length) {
          selectOption(idx);
        }
        break;
      }

      // Enter: go next if question already answered
      case 'Enter':
        if (answersState[currentQuestionIdx] !== null) {
          e.preventDefault();
          nextQuestion();
        }
        break;
    }
  });
}

// Render Category Cards (Accordion Bento Layout)
function renderCategories() {
  const sectionsList = document.getElementById('sections-list');
  sectionsList.innerHTML = '';

  // Group sections by their 'group' property
  const groups = {};
  const ungrouped = [];
  allSections.forEach(section => {
    if (section.group) {
      if (!groups[section.group]) groups[section.group] = [];
      groups[section.group].push(section);
    } else {
      ungrouped.push(section);
    }
  });

  // Render grouped sections
  Object.keys(groups).forEach(groupName => {
    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    groupHeader.innerHTML = `<span class="group-header-icon">🏥</span><span class="group-header-title">${groupName}</span>`;
    sectionsList.appendChild(groupHeader);

    groups[groupName].forEach(section => {
      renderSectionCard(section, sectionsList);
    });
  });

  // Render ungrouped sections
  ungrouped.forEach(section => {
    renderSectionCard(section, sectionsList);
  });

  updateTotalCounter();
}

function renderSectionCard(section, container) {
    const card = document.createElement('div');
    card.className = 'category-card';
    if (section.disabled) {
      card.classList.add('disabled');
    }
    card.dataset.name = section.name;

    // Calculate total and unique questions in this category
    let totalQuestions = 0;
    let totalUnique = 0;
    section.exams.forEach(exam => {
      totalQuestions += getExamQuestionCount(exam);
      totalUnique += exam.uniqueCount || getExamQuestionCount(exam);
    });

    let countText = '';
    if (section.exams.length === 1) {
      countText = `1 قسم (${totalQuestions} سؤال | ${totalUnique} غير مكرر)`;
    } else if (section.exams.length >= 3 && section.exams.length <= 10) {
      countText = `${section.exams.length} أقسام (${totalQuestions} سؤال | ${totalUnique} غير مكرر)`;
    } else {
      countText = `${section.exams.length} قسم (${totalQuestions} سؤال | ${totalUnique} غير مكرر)`;
    }
    if (section.soon) {
      countText = 'قريباً...';
    }

    card.innerHTML = `
      <div class="category-main-row">
        <div class="category-info">
          <span class="category-name">${section.name}</span>
          <span class="category-count">${countText}</span>
        </div>
        <div class="accordion-chevron">${section.disabled ? '' : '▼'}</div>
      </div>
      <div class="category-details">
        <div class="category-actions">
          <span class="action-link select-all-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 6px;"><path d="M20 6 9 17l-5-5"/></svg>
            تحديد الكل
          </span>
          <span class="action-link deselect-all-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 6px;"><path d="M18 6 6 18M6 6l12 12"/></svg>
            إلغاء الكل
          </span>
        </div>
        ${section.groupTitle ? `<div class="group-title">${section.groupTitle}</div>` : ''}
        <div class="exams-list">
          ${section.exams.map(exam => {
      const examKey = `${section.name}|${exam.name}`;
      const isChecked = selectedExams.has(examKey);
      const qCount = getExamQuestionCount(exam);
      const uCount = exam.uniqueCount || qCount;
      return `
              <div class="exam-item ${isChecked ? 'selected' : ''}" data-key="${examKey}">
                <div class="exam-info">
                  <span class="exam-name">${exam.name}</span>
                  <span class="exam-count">الكل: ${qCount} | غير مكرر: ${uCount}</span>
                </div>
                <div class="checkbox-custom"></div>
              </div>
            `;
    }).join('')}
        </div>
      </div>
    `;

    // Event listener for expanding/collapsing (only if not disabled)
    if (!section.disabled) {
      const mainRow = card.querySelector('.category-main-row');
      mainRow.addEventListener('click', async () => {
        card.classList.toggle('expanded');

        // Lazy load section data on first expand
        if (card.classList.contains('expanded') && !isSectionLoaded(section.name) && section.dataFile) {
          const chevron = card.querySelector('.accordion-chevron');
          if (chevron) chevron.innerHTML = '<span class="loading-spinner-small"></span>';
          await loadSectionData(section.name);
          if (chevron) chevron.innerHTML = '▼';
        }
      });

      // Select All action
      const selectAllBtn = card.querySelector('.select-all-btn');
      selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAllExams(section.name, card);
      });

      // Deselect All action
      const deselectAllBtn = card.querySelector('.deselect-all-btn');
      deselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deselectAllExams(section.name, card);
      });

      // Individual exam click listeners
      card.querySelectorAll('.exam-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = item.dataset.key;
          if (selectedExams.has(key)) {
            selectedExams.delete(key);
            item.classList.remove('selected');
          } else {
            selectedExams.add(key);
            item.classList.add('selected');
          }
          updateTotalCounter();
        });
      });
    }

    container.appendChild(card);
}

// Select All exams in a category
function selectAllExams(secName, card) {
  const section = allSections.find(s => s.name === secName);
  if (!section) return;
  section.exams.forEach(exam => {
    const key = `${secName}|${exam.name}`;
    selectedExams.add(key);
  });
  card.querySelectorAll('.exam-item').forEach(item => {
    item.classList.add('selected');
  });
  updateTotalCounter();
}

// Deselect All exams in a category
function deselectAllExams(secName, card) {
  const section = allSections.find(s => s.name === secName);
  if (!section) return;
  section.exams.forEach(exam => {
    const key = `${secName}|${exam.name}`;
    selectedExams.delete(key);
  });
  card.querySelectorAll('.exam-item').forEach(item => {
    item.classList.remove('selected');
  });
  updateTotalCounter();
}

// Update Selected Questions Count
function updateTotalCounter() {
  const deduplicate = document.querySelector('input[name="deduplicate"]:checked') ? document.querySelector('input[name="deduplicate"]:checked').value : 'off';
  
  // Collect all questions from the selected exams currently loaded in memory
  let tempQuestions = [];
  let isAnyNotLoaded = false;

  selectedExams.forEach(key => {
    const [secName, examName] = key.split('|');
    const section = allSections.find(s => s.name === secName);
    if (section) {
      const exam = section.exams.find(e => e.name === examName);
      if (exam) {
        if (exam.questions && exam.questions.length > 0) {
          exam.questions.forEach(q => {
            tempQuestions.push(q.q || q.qText || ''); // support both formats
          });
        } else {
          isAnyNotLoaded = true;
          // Fallback to precomputed count if data not loaded yet
          if (deduplicate === 'on') {
            tempQuestions.push(...new Array(exam.uniqueCount || getExamQuestionCount(exam)));
          } else {
            tempQuestions.push(...new Array(getExamQuestionCount(exam)));
          }
        }
      }
    }
  });

  if (deduplicate === 'on') {
    if (isAnyNotLoaded) {
      // Some sections not yet loaded — use pre-computed uniqueCount as estimate
      let totalEstimate = 0;
      selectedExams.forEach(key => {
        const [secName, examName] = key.split('|');
        const section = allSections.find(s => s.name === secName);
        if (section) {
          const exam = section.exams.find(e => e.name === examName);
          if (exam) totalEstimate += exam.uniqueCount || getExamQuestionCount(exam);
        }
      });
      document.getElementById('selected-total').innerText = totalEstimate;
    } else {
      // All loaded — two-tier dedup (matches reference site algorithm)
      const uniqueTexts = _deduplicateTexts(tempQuestions.filter(Boolean));
      document.getElementById('selected-total').innerText = uniqueTexts.length;
    }
  } else {
    document.getElementById('selected-total').innerText = tempQuestions.length;
  }
  updateSavedCounts();
}

// ── DEDUPLICATION ENGINE (matches reference site algorithm) ──────────────────
const _DEDUP_PUNCT_RE    = /[.,،;؛:؟?!\-–—_=+*"'`''""()[\]{}\/<>«»…#%~^\\|]/g;
const _DEDUP_DIACRIT_RE  = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/** Tier-1 normalization: strip diacritics + punctuation, lowercase, collapse spaces */
function _norm(text) {
  if (!text) return '';
  return text
    .replace(_DEDUP_DIACRIT_RE, '')
    .replace(_DEDUP_PUNCT_RE, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tier-2 normalization: also unify Arabic spelling variants */
function _normFuzzy(text) {
  return _norm(text)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/** Character bigrams (for Dice coefficient) */
function _bigrams(str) {
  const gs = new Set();
  const s = ' ' + str + ' ';
  for (let i = 0; i < s.length - 1; i++) gs.add(s.substr(i, 2));
  return gs;
}

/** Dice coefficient over bigram sets */
function _dice(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return (2 * n) / (a.size + b.size);
}

const _FUZZY_THRESHOLD = 0.90; // questions above this similarity are considered same

/**
 * Deduplicate an array of question-text strings.
 * Returns a new array with duplicates removed (Tier1 exact + Tier2 fuzzy).
 */
function _deduplicateTexts(texts) {
  // Tier 1: exact match after norm()
  const seen = new Set();
  const tier1 = [];
  texts.forEach(t => {
    if (!t) return;
    const k = _norm(t);
    if (k && !seen.has(k)) { seen.add(k); tier1.push(t); }
  });

  // Tier 2: fuzzy match on remaining
  const grams  = tier1.map(t => _bigrams(_normFuzzy(t)));
  const absorb = new Set();
  for (let i = 0; i < tier1.length; i++) {
    if (absorb.has(i)) continue;
    for (let j = i + 1; j < tier1.length; j++) {
      if (absorb.has(j)) continue;
      if (_dice(grams[i], grams[j]) >= _FUZZY_THRESHOLD) absorb.add(j);
    }
  }
  return tier1.filter((_, i) => !absorb.has(i));
}

/**
 * Deduplicate an array of question objects {q, o, c, ...}.
 * Returns a new array without duplicates.
 */
function deduplicateQuestions(questions) {
  const texts  = questions.map(q => q.q || q.qText || '');
  const unique = _deduplicateTexts(texts);
  const kept   = new Set(unique.map(t => _norm(t)));
  // Preserve the first occurrence of each unique question
  const seenNorm = new Set();
  return questions.filter(q => {
    const k = _norm(q.q || q.qText || '');
    if (!k || seenNorm.has(k)) return false;
    // Also skip fuzzy duplicates already absorbed — re-run final filter
    if (!kept.has(k)) return false;
    seenNorm.add(k);
    return true;
  });
}

// Legacy alias (kept for any remaining references)
function normalizeText(text) { return _norm(text); }

// Shuffle Utility
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Start Quiz
async function startQuiz(customQuestions = null) {
  if (!customQuestions && selectedExams.size === 0) {
    alert('من فضلك اختر امتحاناً واحداً على الأقل للبدء.');
    return;
  }

  const startBtn = document.getElementById('start-btn');
  const originalBtnText = startBtn ? startBtn.innerHTML : '';

  if (!customQuestions) {
    try {
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<span class="loading-spinner-small"></span> جاري التحميل...';
      }
      await ensureSelectedSectionsLoaded();
    } catch (err) {
      alert('فشل تحميل الأسئلة. إذا كنت تستخدم النسخة المرفوعة (أونلاين)، يرجى العلم أن الأسئلة تم حذفها من السيرفر بناءً على طلبك لتعمل محلياً فقط. لتشغيل الاختبار، افتح ملف index.html محلياً على جهازك.');
      return;
    } finally {
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = originalBtnText;
      }
    }
  }

  const questionOrder = document.querySelector('input[name="questionOrder"]:checked').value;
  const optionOrder = document.querySelector('input[name="optionOrder"]:checked').value;

  if (customQuestions) {
    quizQuestions = customQuestions.map(q => {
      const origQ = q.originalQ;
      if (!origQ) return q;

      let options = [...origQ.o];
      let correctIdx = origQ.c;
      if (optionOrder === 'random') {
        const indices = options.map((_, i) => i);
        shuffleArray(indices);
        options = indices.map(i => origQ.o[i]);
        correctIdx = indices.indexOf(origQ.c);
      }
      return {
        ...q,
        options: options,
        correct: correctIdx
      };
    });

    if (questionOrder === 'random') {
      shuffleArray(quizQuestions);
    } else {
      quizQuestions.sort((a, b) => {
        if (a.secName !== b.secName) return a.secName.localeCompare(b.secName);
        if (a.examName !== b.examName) return a.examName.localeCompare(b.examName);
        return (a.num || 0) - (b.num || 0);
      });
    }
  } else {
    quizQuestions = [];
    selectedExams.forEach(key => {
      const [secName, examName] = key.split('|');
      const section = allSections.find(s => s.name === secName);
      if (section) {
        const exam = section.exams.find(e => e.name === examName);
        if (exam) {
          exam.questions.forEach(q => {
            let options = [...q.o];
            let correctIdx = q.c;

            if (optionOrder === 'random') {
              const indices = options.map((_, i) => i);
              shuffleArray(indices);
              options = indices.map(i => q.o[i]);
              correctIdx = indices.indexOf(q.c);
            }

            quizQuestions.push({
              section: getSectionDisplayName(secName, examName),
              qText: q.q,
              num: q.num,
              options: options,
              correct: correctIdx,
              originalQ: q,
              secName: secName,
              examName: examName
            });
          });
        }
      }
    });

    if (questionOrder === 'random') {
      shuffleArray(quizQuestions);
    }
  }

  // Deduplicate questions if enabled
  const deduplicate = document.querySelector('input[name="deduplicate"]:checked') ? document.querySelector('input[name="deduplicate"]:checked').value : 'off';
  if (deduplicate === 'on') {
    quizQuestions = deduplicateQuestions(quizQuestions);
  }

  if (quizQuestions.length === 0) {
    alert('فشل تحميل الأسئلة. إذا كنت تستخدم النسخة المرفوعة (أونلاين)، يرجى العلم أن الأسئلة تم حذفها من السيرفر بناءً على طلبك لتعمل محلياً فقط. لتشغيل الاختبار، افتح ملف index.html محلياً على جهازك.');
    return;
  }

  // Reset Quiz State
  currentQuestionIdx = 0;
  scoreCorrect = 0;
  scoreWrong = 0;
  answersState = new Array(quizQuestions.length).fill(null);

  // Update UI Elements
  document.getElementById('score-correct').innerText = '0';
  document.getElementById('score-wrong').innerText = '0';

  // Reset and Start Timer
  timeElapsed = 0;
  updateTimerDisplay();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeElapsed++;
    updateTimerDisplay();
    // Save every 30s to avoid hammering localStorage every second
    // (already saved on every user action: selectOption, next, prev)
    if (timeElapsed % 30 === 0) {
      saveQuizProgress();
    }
  }, 1000);

  // Screen transition
  switchScreen('setup-screen', 'quiz-screen');
  displayQuestion();
  saveQuizProgress();
}

// Update Timer Display
function updateTimerDisplay() {
  const timerEl = document.getElementById('quiz-timer');
  if (!timerEl) return;

  const hrs = Math.floor(timeElapsed / 3600);
  const mins = Math.floor((timeElapsed % 3600) / 60);
  const secs = timeElapsed % 60;

  let timeStr = '';
  if (hrs > 0) {
    timeStr += `${hrs.toString().padStart(2, '0')}:`;
  }
  timeStr += `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  timerEl.innerText = `⏱️ ${timeStr}`;
}

// Display Question
function displayQuestion() {
  if (quizQuestions.length === 0) return;

  const currentQ = quizQuestions[currentQuestionIdx];

  // Meta Info
  document.getElementById('q-section').innerText = currentQ.section;
  document.getElementById('q-number').innerText = currentQuestionIdx + 1;

  // Progress Bar
  const progressPct = ((currentQuestionIdx + 1) / quizQuestions.length) * 100;
  document.getElementById('progress-fill').style.width = `${progressPct}%`;

  // Remaining counts
  const remainingTotal = quizQuestions.length - (currentQuestionIdx + 1);
  document.getElementById('remaining-total').innerText = remainingTotal;

  // Calculate remaining in this section
  let remainingInSec = 0;
  for (let i = currentQuestionIdx + 1; i < quizQuestions.length; i++) {
    if (quizQuestions[i].section === currentQ.section) remainingInSec++;
  }
  document.getElementById('remaining-section').innerText = remainingInSec;

  // Question Flags
  const flagsContainer = document.getElementById('question-flags');
  if (flagsContainer) {
    const flagged = getFlaggedQuestions();
    const qKey = getQuestionKey(currentQ);
    const savedFlag = flagged[qKey];
    const isVeryImportant = savedFlag && savedFlag.flagType === 'very_important';
    const isImportant = savedFlag && savedFlag.flagType === 'important';

    flagsContainer.innerHTML = `
      <button class="flag-btn flag-important ${isImportant ? 'active' : ''}" data-flag-type="important">
        ⭐️ Important
      </button>
      <button class="flag-btn flag-very-important ${isVeryImportant ? 'active' : ''}" data-flag-type="very_important">
        🔥 V. Important
      </button>
    `;
  }

  // Question Text
  const questionOrder = document.querySelector('input[name="questionOrder"]:checked') ? document.querySelector('input[name="questionOrder"]:checked').value : 'default';
  const optionOrder = document.querySelector('input[name="optionOrder"]:checked') ? document.querySelector('input[name="optionOrder"]:checked').value : 'default';

  const questionTextEl = document.getElementById('question-text');
  if (questionOrder === 'default' && optionOrder === 'default' && currentQ.num) {
    questionTextEl.innerHTML = `<span class="q-num-prefix">${currentQ.num}.</span> ${currentQ.qText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
  } else {
    questionTextEl.textContent = currentQ.qText;
  }

  // Options
  const optionsContainer = document.getElementById('options-container');
  optionsContainer.innerHTML = '';

  const savedAnswer = answersState[currentQuestionIdx];
  const optionLetters = ['A)', 'B)', 'C)', 'D)', 'E)'];

  currentQ.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    const letterSpan = document.createElement('span');
    letterSpan.className = 'option-letter';
    letterSpan.textContent = optionLetters[idx];
    const valSpan = document.createElement('span');
    valSpan.className = 'option-val';
    valSpan.textContent = opt;
    btn.appendChild(letterSpan);
    btn.appendChild(valSpan);

    // Apply states if previously answered
    if (savedAnswer !== null) {
      btn.classList.add('disabled');
      if (idx === currentQ.correct) {
        btn.classList.add('correct');
      } else if (idx === savedAnswer.selectedIdx) {
        btn.classList.add('wrong');
      }
    } else {
      btn.addEventListener('click', () => selectOption(idx));
    }

    optionsContainer.appendChild(btn);
  });
}

// Select Option
function selectOption(selectedIdx) {
  const currentQ = quizQuestions[currentQuestionIdx];
  const isCorrect = selectedIdx === currentQ.correct;

  // Save State
  answersState[currentQuestionIdx] = { selectedIdx, isCorrect };

  // Update Counters
  if (isCorrect) {
    scoreCorrect++;
    document.getElementById('score-correct').innerText = scoreCorrect;
  } else {
    scoreWrong++;
    document.getElementById('score-wrong').innerText = scoreWrong;
  }

  // Visual Feedback
  const optionsContainer = document.getElementById('options-container');
  const buttons = optionsContainer.getElementsByClassName('option-btn');
  const questionContainer = document.querySelector('.question-container');

  Array.from(buttons).forEach((btn, idx) => {
    btn.classList.add('disabled');
    if (idx === currentQ.correct) {
      btn.classList.add('correct');
      if (isCorrect) {
        btn.classList.add('bounce');
      }
    } else if (idx === selectedIdx) {
      btn.classList.add('wrong');
      if (!isCorrect) {
        btn.classList.add('shake');
        const scrollContent = document.querySelector('.quiz-scroll-content');
        if (scrollContent) {
          scrollContent.classList.add('shake');
          setTimeout(() => {
            scrollContent.classList.remove('shake');
          }, 400);
        }
      }
    }
  });

  saveQuizProgress();

  // Delay transition for better user experience (only if correct and auto-transition is enabled)
  const autoTransition = document.querySelector('input[name="autoTransition"]:checked').value;
  if (isCorrect && autoTransition === 'on') {
    setTimeout(() => {
      if (currentQuestionIdx < quizQuestions.length - 1) {
        nextQuestion();
      } else {
        finishQuiz();
      }
    }, 250);
  }
}

// Navigation Functions
function nextQuestion() {
  if (currentQuestionIdx < quizQuestions.length - 1) {
    currentQuestionIdx++;
    displayQuestion();
    saveQuizProgress();
  } else {
    finishQuiz();
  }
}

function prevQuestion() {
  if (currentQuestionIdx > 0) {
    currentQuestionIdx--;
    displayQuestion();
    saveQuizProgress();
  }
}

// Finish Quiz & Show Results
function finishQuiz() {
  const unansweredCount = answersState.filter(answer => answer === null || answer === undefined).length;
  if (unansweredCount > 0 && !confirm(`لديك ${unansweredCount} سؤالاً بدون إجابة. هل تريد إنهاء الاختبار؟`)) return;
  // Stop Timer
  clearInterval(timerInterval);
  clearQuizProgress();

  // Set total time on results screen
  const hrs = Math.floor(timeElapsed / 3600);
  const mins = Math.floor((timeElapsed % 3600) / 60);
  const secs = timeElapsed % 60;
  let timeStr = '';
  if (hrs > 0) {
    timeStr += `${hrs.toString().padStart(2, '0')}:`;
  }
  timeStr += `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  document.getElementById('results-time').innerText = timeStr;

  // Switch screen
  switchScreen('quiz-screen', 'results-screen');

  // Set values
  document.getElementById('final-score').innerText = `${scoreCorrect}/${quizQuestions.length}`;
  document.getElementById('total-correct').innerText = scoreCorrect;
  document.getElementById('total-wrong').innerText = scoreWrong;

  const pct = quizQuestions.length > 0 ? Math.round((scoreCorrect / quizQuestions.length) * 100) : 0;
  document.getElementById('score-percentage').innerText = `${pct}%`;

  // Animate circular ring
  const circle = document.getElementById('score-ring-fill');
  const circumference = 2 * Math.PI * 52; // 326.7
  const offset = circumference - (circumference * pct) / 100;
  circle.style.strokeDashoffset = offset;

  // Calculate skipped questions
  let scoreSkipped = 0;
  answersState.forEach(ans => {
    if (ans === null) scoreSkipped++;
  });
  document.getElementById('total-skipped').innerText = scoreSkipped;

  // Counts for action buttons — always from the current session
  const displayWrongCount = scoreWrong;
  const displaySkippedCount = scoreSkipped;

  // Toggle review wrong button visibility
  const reviewWrongBtn = document.getElementById('review-wrong-btn');
  if (displayWrongCount > 0) {
    reviewWrongBtn.style.display = 'block';
    reviewWrongBtn.innerText = `🔄 مراجعة الأسئلة الخاطئة فقط (${displayWrongCount})`;
  } else {
    reviewWrongBtn.style.display = 'none';
  }

  // Toggle review skipped button visibility
  const reviewSkippedBtn = document.getElementById('review-skipped-btn');
  if (displaySkippedCount > 0) {
    reviewSkippedBtn.style.display = 'block';
    reviewSkippedBtn.innerText = `📝 مراجعة الأسئلة المتروكة فقط (${displaySkippedCount})`;
  } else {
    reviewSkippedBtn.style.display = 'none';
  }

  // Toggle review wrong + skipped button visibility
  const reviewWrongSkippedBtn = document.getElementById('review-wrong-skipped-btn');
  const wrongAndSkippedCount = displayWrongCount + displaySkippedCount;
  if (reviewWrongSkippedBtn) {
    if (wrongAndSkippedCount > 0) {
      reviewWrongSkippedBtn.style.display = 'block';
      reviewWrongSkippedBtn.innerText = `🔄 مراجعة الأخطاء + المتروك (${wrongAndSkippedCount})`;
    } else {
      reviewWrongSkippedBtn.style.display = 'none';
    }
  }

  // Toggle review flagged very important button visibility
  const flagged = getFlaggedQuestions();
  let quizVeryImportantCount = 0;
  let quizImportantCount = 0;

  const targetQuestions = quizQuestions;
  targetQuestions.forEach(q => {
    const qKey = getQuestionKey(q);
    if (flagged[qKey]) {
      if (flagged[qKey].flagType === 'very_important') quizVeryImportantCount++;
      if (flagged[qKey].flagType === 'important') quizImportantCount++;
    }
  });

  const reviewVIBtn = document.getElementById('review-very-important-btn');
  if (reviewVIBtn) {
    if (quizVeryImportantCount > 0) {
      reviewVIBtn.style.display = 'block';
      reviewVIBtn.innerText = `🔥 مراجعة الأسئلة الهامة جداً في هذا الاختبار (${quizVeryImportantCount})`;
    } else {
      reviewVIBtn.style.display = 'none';
    }
  }

  const reviewIBtn = document.getElementById('review-important-btn');
  if (reviewIBtn) {
    if (quizImportantCount > 0) {
      reviewIBtn.style.display = 'block';
      reviewIBtn.innerText = `⭐️ مراجعة الأسئلة الهامة في هذا الاختبار (${quizImportantCount})`;
    } else {
      reviewIBtn.style.display = 'none';
    }
  }

  const reviewAllImportantBtn = document.getElementById('review-all-important-btn');
  const quizAllImportantCount = quizVeryImportantCount + quizImportantCount;
  if (reviewAllImportantBtn) {
    if (quizAllImportantCount > 0) {
      reviewAllImportantBtn.style.display = 'block';
      reviewAllImportantBtn.innerText = `🔥⭐️ مراجعة الهام + الهام جداً معاً (${quizAllImportantCount})`;
    } else {
      reviewAllImportantBtn.style.display = 'none';
    }
  }
}

// Review Wrong Answers Only
function reviewWrongAnswers() {
  const wrongQs = quizQuestions.filter((q, idx) => {
    const ans = answersState[idx];
    return ans !== null && ans !== undefined && !ans.isCorrect;
  });
  if (wrongQs.length > 0) startQuiz([...wrongQs]);
}

// Review Skipped Answers Only
function reviewSkippedAnswers() {
  const skippedQs = quizQuestions.filter((q, idx) => {
    const ans = answersState[idx];
    return ans === null || ans === undefined;
  });
  if (skippedQs.length > 0) startQuiz([...skippedQs]);
}

// Review Wrong & Skipped Answers together
function reviewWrongAndSkippedAnswers() {
  const combinedQs = quizQuestions.filter((q, idx) => {
    const ans = answersState[idx];
    return ans === null || ans === undefined || !ans.isCorrect;
  });
  if (combinedQs.length > 0) startQuiz([...combinedQs]);
}

// Reset App State
function resetApp() {
  switchScreen('results-screen', 'setup-screen');
  updateTotalCounter();
  clearQuizProgress();
}

// Navigation Helper
function switchScreen(fromId, toId) {
  // Toggle quiz-active class on body and html based on active screen
  if (toId === 'quiz-screen') {
    document.body.classList.add('quiz-active');
    document.documentElement.classList.add('quiz-active');
  } else {
    document.body.classList.remove('quiz-active');
    document.documentElement.classList.remove('quiz-active');
    // Reset scroll position when going back to home/results screen
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  // Toggle footer visibility: only show on setup screen
  const footer = document.getElementById('site-footer');
  if (footer) {
    if (toId === 'setup-screen') {
      footer.style.display = 'block';
    } else {
      footer.style.display = 'none';
    }
  }

  // Toggle prayer-banner visibility: hide on study-screen
  const prayerBanner = document.getElementById('prayer-banner');
  if (prayerBanner) {
    if (toId === 'study-screen') {
      prayerBanner.style.display = 'none';
    } else {
      prayerBanner.style.display = 'block';
    }
  }

  // Hide all screens to prevent any overlap
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.display = 'none';
  });

  // Show the target screen and transition it in
  const toEl = document.getElementById(toId);
  if (toEl) {
    toEl.style.display = 'block';
    toEl.offsetHeight; // Trigger reflow
    toEl.classList.add('active');
  }
}

// === Flagging Storage & Management Helpers ===

// Normalize question text for comparison: trim + collapse whitespace
function normalizeQText(text) {
  return (text || '').trim().replace(/\s+/g, ' ');
}

// cyrb53 hash — 53-bit, character-sensitive (no whitespace normalization)
// Even a single character difference produces a completely different key
// Collision probability for 10,000 questions ≈ 1 in 1.8 × 10^15
function hashQText(text) {
  const s = (text || '').trim(); // Only trim — preserve exact text
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (4294967296 * (2097151 & h2) + (h1 >>> 0));
  return 'qt_' + hash.toString(36);
}

// Get flagged questions from in-memory cache (sync — cache is populated from Turso on startup)
function getFlaggedQuestions() {
  return flagsCache;
}

// Load flags from Turso server into cache (called once on startup)
async function loadFlagsFromTurso() {
  try {
    flagsCache = await tursoGetFlags();

    // Clean up obsolete/Diagnostic flags (delete from cache and cloud database)
    for (const [key, value] of Object.entries(flagsCache)) {
      const isDiagnostic = (value.secName && value.secName.toLowerCase().includes('diagnostic')) || 
                           (value.examName && value.examName.toLowerCase().includes('diagnostic')) ||
                           (value.section && value.section.toLowerCase().includes('diagnostic'));
      const sectionExists = allSections.some(sec => sec.name === value.secName);
      
      if (isDiagnostic || !sectionExists) {
        delete flagsCache[key];
        tursoDeleteFlag(key).catch(e => console.error('Failed to delete obsolete Diagnostic flag:', e));
      }
    }

    // One-time migration from localStorage (if any old data exists)
    const localRaw = localStorage.getItem('auc_mcq_flagged_questions');
    if (localRaw) {
      const localFlags = _migrateLocalStorageFlags(JSON.parse(localRaw));
      let migratedCount = 0;
      for (const [key, value] of Object.entries(localFlags)) {
        // Skip migration of diagnostic/obsolete questions
        const isDiag = (value.secName && value.secName.toLowerCase().includes('diagnostic')) || 
                       (value.examName && value.examName.toLowerCase().includes('diagnostic')) ||
                       (value.section && value.section.toLowerCase().includes('diagnostic'));
        const exists = allSections.some(sec => sec.name === value.secName);
        if (isDiag || !exists) continue;

        if (!flagsCache[key]) {
          flagsCache[key] = value;
          try {
            await tursoSaveFlag(key, value);
            migratedCount++;
          } catch (e) {
            console.error('Migration error for', key, e);
          }
        }
      }
      // Remove old localStorage data after migration
      localStorage.removeItem('auc_mcq_flagged_questions');
      if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} flags from localStorage to Turso`);
      }
    }
  } catch (e) {
    console.error('Failed to load flags from Turso:', e);
    flagsCache = {};
  }
}

// Helper: migrate old localStorage flag formats (for one-time migration)
function _migrateLocalStorageFlags(raw) {
  const result = {};
  try {
    Object.entries(raw).forEach(([key, value]) => {
      // Format 1 (oldest): "secName|examName|||qText"
      if (key.includes('|||')) {
        const qText = key.split('|||')[1];
        if (qText) {
          const newKey = hashQText(qText);
          result[newKey] = { ...value, key: newKey, qText: normalizeQText(qText) };
        }
      }
      // Format 2 (old): "q_NUM"
      else if (/^q_\d+$/.test(key)) {
        let qText = value.qText || null;
        if (!qText) {
          const dermatology = allSections.find(s => s.name === 'Dermatology');
          if (dermatology) {
            dermatology.exams.forEach(exam => {
              const q = exam.questions.find(q => q.num === value.num);
              if (q) qText = q.q;
            });
          }
        }
        if (qText) {
          const newKey = hashQText(qText);
          result[newKey] = { ...value, key: newKey, qText: normalizeQText(qText) };
        } else {
          result[key] = value;
        }
      }
      // Format 3 (current): "qt_HASH" — re-hash with new function if qText available
      else {
        if (value.qText) {
          const newKey = hashQText(value.qText);
          result[newKey] = { ...value, key: newKey };
        } else {
          result[key] = value;
        }
      }
    });
  } catch (e) {
    console.error('Error migrating localStorage flags:', e);
  }
  return result;
}

// Get section display name (omits prefix if only one section is active/unlocked)
function getSectionDisplayName(secName, examName) {
  const activeSections = allSections.filter(sec => !sec.disabled && sec.exams && sec.exams.length > 0);
  if (activeSections.length === 1) {
    return examName;
  }
  return `${secName} - ${examName}`;
}

// Generate unique key from question TEXT (not num)
// Same question in any exam / with any num → same key → same flag
function getQuestionKey(q) {
  return hashQText(q.qText);
}

// Toggle a flag of a specific type for the current question
// Updates in-memory cache immediately, then persists to Turso in the background
async function toggleFlagCurrentQuestion(type, btn) {
  if (btn) btn.blur();
  const currentQ = quizQuestions[currentQuestionIdx];
  if (!currentQ) return;

  const qKey = getQuestionKey(currentQ);

  if (flagsCache[qKey] && flagsCache[qKey].flagType === type) {
    // Remove flag if already same type
    delete flagsCache[qKey];
    // Persist deletion to Turso (fire-and-forget)
    tursoDeleteFlag(qKey).then(() => showToast('تم إلغاء حفظ السؤال')).catch(e => {
      console.error('Failed to delete flag from Turso:', e);
      showToast('⚠️ فشل حذف العلامة من السيرفر');
    });
  } else {
    // Add/update flag in cache
    const flagData = {
      key: qKey,
      qText: normalizeQText(currentQ.qText),
      num: currentQ.num,
      section: currentQ.section,
      secName: currentQ.secName || '',
      examName: currentQ.examName || '',
      flagType: type,
      flaggedAt: Date.now()
    };
    flagsCache[qKey] = flagData;
    // Persist to Turso (fire-and-forget)
    tursoSaveFlag(qKey, flagData).then(() => showToast('تم حفظ السؤال للمراجعة')).catch(e => {
      console.error('Failed to save flag to Turso:', e);
      showToast('⚠️ فشل حفظ العلامة على السيرفر');
    });
  }

  // Instantly update UI toggles state
  const savedFlag = flagsCache[qKey];
  const isVeryImportant = savedFlag && savedFlag.flagType === 'very_important';
  const isImportant = savedFlag && savedFlag.flagType === 'important';

  const flagsContainer = document.getElementById('question-flags');
  if (flagsContainer) {
    const impBtn = flagsContainer.querySelector('.flag-important');
    const vimpBtn = flagsContainer.querySelector('.flag-very-important');

    if (impBtn) {
      if (isImportant) impBtn.classList.add('active');
      else impBtn.classList.remove('active');
    }
    if (vimpBtn) {
      if (isVeryImportant) vimpBtn.classList.add('active');
      else vimpBtn.classList.remove('active');
    }
  }

  updateSavedCounts();
}

// Clear all flagged questions (from Turso)
function clearAllFlags() {
  if (confirm('هل أنت متأكد من مسح جميع الأسئلة المحفوظة للمراجعة؟')) {
    flagsCache = {};
    tursoClearAllFlags().catch(e => {
      console.error('Failed to clear flags from Turso:', e);
      showToast('⚠️ فشل مسح العلامات من السيرفر');
    });
    updateSavedCounts();
    showToast('تم مسح جميع الأسئلة المحفوظة بنجاح 🧹');
  }
}

// Update flagged counts on the setup screen
function updateSavedCounts() {
  const flagged = getFlaggedQuestions();
  const flaggedList = Object.values(flagged);

  let veryImportantCount = 0;
  let importantCount = 0;

  if (selectedExams.size === 0) {
    // Show active global counts (questions existing in active sections)
    flaggedList.forEach(flaggedQ => {
      if (!flaggedQ.qText) return;
      
      // Use metadata if secName is available to avoid loading files just for counts
      if (flaggedQ.secName) {
        const sec = allSections.find(s => s.name === flaggedQ.secName);
        if (sec && !sec.disabled) {
          if (flaggedQ.flagType === 'very_important') veryImportantCount++;
          if (flaggedQ.flagType === 'important') importantCount++;
        }
      } else {
        // Fallback for legacy format
        const normalText = normalizeQText(flaggedQ.qText);
        const existsInActive = allSections.some(sec => {
          if (sec.disabled) return false;
          return sec.exams.some(exam => exam.questions && exam.questions.some(q => normalizeQText(q.q) === normalText));
        });
        if (existsInActive) {
          if (flaggedQ.flagType === 'very_important') veryImportantCount++;
          if (flaggedQ.flagType === 'important') importantCount++;
        }
      }
    });
  } else {
    // Count flags whose question exists in any currently-selected exam
    flaggedList.forEach(flaggedQ => {
      if (!flaggedQ.qText) return;
      
      if (flaggedQ.secName && flaggedQ.examName) {
        const examKey = `${flaggedQ.secName}|${flaggedQ.examName}`;
        if (selectedExams.has(examKey)) {
          if (flaggedQ.flagType === 'very_important') veryImportantCount++;
          if (flaggedQ.flagType === 'important') importantCount++;
        }
      } else {
        // Fallback for legacy format
        const normalText = normalizeQText(flaggedQ.qText);
        let found = false;
        for (const section of allSections) {
          if (found) break;
          for (const exam of section.exams) {
            if (found) break;
            const examKey = `${section.name}|${exam.name}`;
            if (!selectedExams.has(examKey)) continue;
            if (exam.questions && exam.questions.some(q => normalizeQText(q.q) === normalText)) found = true;
          }
        }
        if (found) {
          if (flaggedQ.flagType === 'very_important') veryImportantCount++;
          if (flaggedQ.flagType === 'important') importantCount++;
        }
      }
    });
  }

  const viBtn = document.getElementById('start-saved-very-important-btn');
  const iBtn = document.getElementById('start-saved-important-btn');
  const allBtn = document.getElementById('start-saved-all-important-btn');

  const viCountSpan = document.getElementById('saved-very-important-count');
  const iCountSpan = document.getElementById('saved-important-count');
  const allCountSpan = document.getElementById('saved-all-important-count');

  const allCount = veryImportantCount + importantCount;

  if (viCountSpan) viCountSpan.innerText = veryImportantCount;
  if (iCountSpan) iCountSpan.innerText = importantCount;
  if (allCountSpan) allCountSpan.innerText = allCount;

  const clearBtn = document.getElementById('clear-all-flags-btn');

  if (viBtn) viBtn.disabled = veryImportantCount === 0;
  if (iBtn) iBtn.disabled = importantCount === 0;
  if (allBtn) allBtn.disabled = allCount === 0;
  if (clearBtn) clearBtn.disabled = allCount === 0;
}

// Start a quiz composed of saved questions of a specific type
async function startSavedQuiz(type) {
  let btnId = '';
  if (type === 'very_important') btnId = 'start-saved-very-important-btn';
  else if (type === 'important') btnId = 'start-saved-important-btn';
  else btnId = 'start-saved-all-important-btn';

  const btn = document.getElementById(btnId);
  const originalText = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner-small"></span> جاري التحميل...';
    }
    await ensureAllEnabledSectionsLoaded();
  } catch (err) {
    alert('حدث خطأ أثناء تحميل الأسئلة. يرجى التحقق من اتصالك بالإنترنت.');
    return;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  const flagged = getFlaggedQuestions();
  const flaggedList = Object.values(flagged);

  let questionsToQuiz = [];

  if (selectedExams.size === 0) {
    // Review active global flags (only those belonging to active sections)
    const addedTexts = new Set();
    allSections.forEach(section => {
      if (section.disabled) return;
      section.exams.forEach(exam => {
        flaggedList.forEach(flaggedQ => {
          if (!flaggedQ.qText) return;
          const isMatch = (type === 'all')
            ? (flaggedQ.flagType === 'important' || flaggedQ.flagType === 'very_important')
            : (flaggedQ.flagType === type);
          if (!isMatch) return;

          const normalText = normalizeQText(flaggedQ.qText);
          if (addedTexts.has(normalText)) return; // already added from another exam
          if (exam.questions.some(q => normalizeQText(q.q) === normalText)) {
            addedTexts.add(normalText);
            questionsToQuiz.push({
              ...flaggedQ,
              secName: section.name,
              examName: exam.name,
              section: getSectionDisplayName(section.name, exam.name)
            });
          }
        });
      });
    });
  } else {
    // Find flagged questions by TEXT match in selected exams
    // This handles the same question appearing with different nums in different exams
    const addedTexts = new Set();
    allSections.forEach(section => {
      section.exams.forEach(exam => {
        const examKey = `${section.name}|${exam.name}`;
        if (!selectedExams.has(examKey)) return;
        flaggedList.forEach(flaggedQ => {
          if (!flaggedQ.qText) return;
          const isMatch = (type === 'all')
            ? (flaggedQ.flagType === 'important' || flaggedQ.flagType === 'very_important')
            : (flaggedQ.flagType === type);
          if (!isMatch) return;

          const normalText = normalizeQText(flaggedQ.qText);
          if (addedTexts.has(normalText)) return; // already added from another exam
          if (exam.questions.some(q => normalizeQText(q.q) === normalText)) {
            addedTexts.add(normalText);
            questionsToQuiz.push({
              ...flaggedQ,
              secName: section.name,
              examName: exam.name,
              section: getSectionDisplayName(section.name, exam.name)
            });
          }
        });
      });
    });
  }

  if (questionsToQuiz.length === 0) return;

  const formattedQs = questionsToQuiz.map(q => {
    // Look up question by TEXT match — finds correct instance even if num differs across exams
    const sec = allSections.find(s => s.name === q.secName);
    const exam = sec && sec.exams.find(e => e.name === q.examName);
    const normalText = normalizeQText(q.qText || '');
    const origQ = exam && exam.questions.find(question => normalizeQText(question.q) === normalText);
    if (!origQ) return null;

    return {
      section: q.section,
      qText: origQ.q,
      num: origQ.num,
      options: [...origQ.o],
      correct: origQ.c,
      originalQ: origQ,
      secName: q.secName,
      examName: q.examName
    };
  }).filter(Boolean);

  startQuiz(formattedQs);
}

// Review flagged questions in the current quiz run
function reviewCurrentQuizFlagged(type) {
  const flagged = getFlaggedQuestions();
  const flaggedQs = quizQuestions.filter(q => {
    const qKey = getQuestionKey(q);
    return (type === 'all')
      ? (flagged[qKey] && (flagged[qKey].flagType === 'important' || flagged[qKey].flagType === 'very_important'))
      : (flagged[qKey] && flagged[qKey].flagType === type);
  }).map(q => ({ ...q }));

  if (flaggedQs.length > 0) startQuiz(flaggedQs);
}

// === Quiz Progress Persistence Helpers ===
function saveQuizProgress() {
  const questionOrder = document.querySelector('input[name="questionOrder"]:checked') ? document.querySelector('input[name="questionOrder"]:checked').value : 'default';
  const optionOrder = document.querySelector('input[name="optionOrder"]:checked') ? document.querySelector('input[name="optionOrder"]:checked').value : 'default';

  // Save only lightweight references instead of full question data
  const questionRefs = quizQuestions.map(q => ({
    s: q.secName,       // section name
    e: q.examName,      // exam name
    n: q.num,           // question number (unique id within exam)
    c: q.correct,       // correct answer index (may differ from original if shuffled)
    oo: q.options       // option order (needed to preserve shuffle state)
  }));

  const state = {
    questionRefs,
    currentQuestionIdx,
    scoreCorrect,
    scoreWrong,
    answersState,
    timeElapsed,
    questionOrder,
    optionOrder
  };
  try {
    localStorage.setItem('auc_mcq_active_quiz_state', JSON.stringify(state));
  } catch (e) {
    console.error("Error saving quiz progress", e);
  }
}

function clearQuizProgress() {
  try {
    localStorage.removeItem('auc_mcq_active_quiz_state');
  } catch (e) {
    console.error("Error clearing quiz progress", e);
  }
}

async function restoreQuizProgress() {
  try {
    const saved = localStorage.getItem('auc_mcq_active_quiz_state');
    if (!saved) return;

    const state = JSON.parse(saved);

    // Clear saved state if it references obsolete/Diagnostic sections to prevent crashes
    if (state.questionRefs) {
      const hasObsolete = state.questionRefs.some(ref => {
        return ref.s.toLowerCase().includes('diagnostic') || !allSections.some(s => s.name === ref.s);
      });
      if (hasObsolete) {
        clearQuizProgress();
        return;
      }
    }

    // Support new lightweight format (questionRefs) and legacy format (quizQuestions)
    if (state.questionRefs && state.questionRefs.length > 0) {
      // New format: rebuild questions from source data
      const sectionsToLoad = new Set(state.questionRefs.map(r => r.s));
      for (const secName of sectionsToLoad) {
        await loadSectionData(secName);
      }

      quizQuestions = [];
      for (const ref of state.questionRefs) {
        const section = allSections.find(s => s.name === ref.s);
        if (!section) continue;
        const exam = section.exams.find(e => e.name === ref.e);
        if (!exam || !exam.questions) continue;
        const originalQ = exam.questions.find(q => q.num === ref.n);
        if (!originalQ) continue;

        quizQuestions.push({
          section: getSectionDisplayName(ref.s, ref.e),
          qText: originalQ.q,
          num: originalQ.num,
          options: ref.oo || [...originalQ.o],   // use saved option order (preserves shuffle)
          correct: ref.c,                        // use saved correct index
          originalQ: originalQ,
          secName: ref.s,
          examName: ref.e
        });
      }
    } else if (state.quizQuestions && state.quizQuestions.length > 0) {
      // Legacy format: use stored questions directly (backward compatible)
      quizQuestions = state.quizQuestions;
    } else {
      return;
    }

    if (quizQuestions.length === 0) return;

    currentQuestionIdx = state.currentQuestionIdx || 0;
    scoreCorrect = state.scoreCorrect || 0;
    scoreWrong = state.scoreWrong || 0;
    answersState = state.answersState || [];
    timeElapsed = state.timeElapsed || 0;

    // Restore radio selections
    if (state.questionOrder) {
      const qInput = document.querySelector(`input[name="questionOrder"][value="${state.questionOrder}"]`);
      if (qInput) {
        qInput.checked = true;
      }
    }
    if (state.optionOrder) {
      const oInput = document.querySelector(`input[name="optionOrder"][value="${state.optionOrder}"]`);
      if (oInput) {
        oInput.checked = true;
      }
    }

    // Update UI Counters
    document.getElementById('score-correct').innerText = scoreCorrect;
    document.getElementById('score-wrong').innerText = scoreWrong;

    // Restore Timer
    updateTimerDisplay();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeElapsed++;
      updateTimerDisplay();
      // Save every 30s to avoid hammering localStorage every second
      if (timeElapsed % 30 === 0) {
        saveQuizProgress();
      }
    }, 1000);

    // Switch screen to quiz-screen
    switchScreen('setup-screen', 'quiz-screen');

    // Display current question
    displayQuestion();

    // Show a visual notification/toast
    showToast("تم استعادة تقدمك في الاختبار تلقائياً ⏱️");
  } catch (e) {
    console.error("Error restoring quiz progress", e);
  }
}

// Toast Notification helper
function showToast(message) {
  let toast = document.getElementById('quiz-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'quiz-toast';
    document.body.appendChild(toast);
  }
  toast.innerText = message;
  toast.className = 'quiz-toast show';
  setTimeout(() => {
    toast.className = 'quiz-toast';
  }, 3000);
}



// === Quick Search Feature ===
function initSearch() {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchClearBtn = document.getElementById('search-clear-btn');
  if (!searchInput || !searchResults) return;

  let debounceTimer = null;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();

    // Show/hide clear button
    if (searchClearBtn) {
      searchClearBtn.style.display = query.length > 0 ? 'flex' : 'none';
    }

    clearTimeout(debounceTimer);
    if (query.length < 2) {
      searchResults.innerHTML = '';
      searchResults.classList.remove('visible');
      return;
    }

    debounceTimer = setTimeout(() => {
      performSearch(query);
    }, 300);
  });

  // Clear button
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchResults.innerHTML = '';
      searchResults.classList.remove('visible');
      searchClearBtn.style.display = 'none';
      searchInput.focus();
    });
  }

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    const container = document.getElementById('search-container');
    if (container && !container.contains(e.target)) {
      searchResults.classList.remove('visible');
    }
  });

  // Reopen results on focus if there's content
  searchInput.addEventListener('focus', () => {
    // Lazy-load all enabled sections in the background when the user focuses on the search input
    ensureAllEnabledSectionsLoaded();

    if (searchResults.children.length > 0) {
      searchResults.classList.add('visible');
    }
  });
}

function performSearch(query) {
  const searchResults = document.getElementById('search-results');
  if (!searchResults) return;

  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 0);

  if (queryWords.length === 0) {
    searchResults.innerHTML = '';
    searchResults.classList.remove('visible');
    return;
  }

  const results = [];

  for (const section of allSections) {
    if (section.disabled) continue;
    for (const exam of section.exams) {
      if (!exam.questions) continue;
      for (const q of exam.questions) {
        // Token-based matching: ALL query words must match
        const qText = q.q.toLowerCase();
        const options = q.o.map(opt => opt.toLowerCase());
        
        const isMatch = queryWords.every(word => {
          return qText.includes(word) || options.some(opt => opt.includes(word));
        });

        if (isMatch) {
          // Check if it matched the question text or options
          const matchesQuestion = queryWords.some(word => qText.includes(word));
          results.push({
            question: q,
            sectionName: section.name,
            examName: exam.name,
            matchType: matchesQuestion ? 'question' : 'option'
          });
        }
      }
    }
  }

  if (results.length === 0) {
    searchResults.innerHTML = `<div class="search-no-results">لا توجد نتائج لـ "${escapeAttr(query)}"</div>`;
    searchResults.classList.add('visible');
    return;
  }

  searchResults.innerHTML = results.map((r, idx) => {
    const truncatedQ = r.question.q.length > 80
      ? r.question.q.substring(0, 80) + '...'
      : r.question.q;
    const highlighted = highlightMatch(truncatedQ, query);
    const badge = r.matchType === 'option' ? '<span class="search-match-badge">في الخيارات</span>' : '';

    return `
      <div class="search-result-item" data-idx="${idx}" data-section="${r.sectionName}" data-exam="${r.examName}" data-qtext="${escapeAttr(r.question.q)}">
        <div class="search-result-text">${highlighted} ${badge}</div>
        <div class="search-result-meta">${r.sectionName} › ${r.examName}</div>
      </div>
    `;
  }).join('');

  // Add count footer showing total matches found
  const footerDiv = document.createElement('div');
  footerDiv.className = 'search-footer';
  footerDiv.textContent = `تم العثور على ${results.length} سؤال متطابق`;
  searchResults.appendChild(footerDiv);

  searchResults.classList.add('visible');

  // Click handlers for results
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const secName = item.dataset.section;
      const examName = item.dataset.exam;
      const qText = item.dataset.qtext;
      startQuizFromSearch(secName, examName, qText);
    });
  });
}

function highlightMatch(text, query) {
  if (!query) return escapeAttr(text);
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return escapeAttr(text);

  words.sort((a, b) => b.length - a.length);

  let html = escapeAttr(text);
  words.forEach(word => {
    const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedWord})(?!(?:[^<]*>))`, 'gi');
    html = html.replace(regex, '<mark class="search-highlight">$1</mark>');
  });
  return html;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function startQuizFromSearch(secName, examName, qText) {
  // Close search
  const searchResults = document.getElementById('search-results');
  const searchInput = document.getElementById('search-input');
  if (searchResults) searchResults.classList.remove('visible');
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) clearBtn.style.display = 'none';

  // Find the section and exam
  const section = allSections.find(s => s.name === secName);
  if (!section) return;
  const exam = section.exams.find(e => e.name === examName);
  if (!exam) return;

  // Build quiz with the full exam, starting at the matched question
  const optionOrder = document.querySelector('input[name="optionOrder"]:checked') ? document.querySelector('input[name="optionOrder"]:checked').value : 'default';

  const formattedQs = exam.questions.map(q => {
    let options = [...q.o];
    let correctIdx = q.c;

    if (optionOrder === 'random') {
      const indices = options.map((_, i) => i);
      shuffleArray(indices);
      options = indices.map(i => q.o[i]);
      correctIdx = indices.indexOf(q.c);
    }

    return {
      section: getSectionDisplayName(secName, examName),
      qText: q.q,
      num: q.num,
      options: options,
      correct: correctIdx,
      originalQ: q,
      secName: secName,
      examName: examName
    };
  });

  // Start quiz at that question index (which will sort/deduplicate it as configured)
  startQuiz(formattedQs);

  // Find the index of the searched question in the final quizQuestions list (accurate index even after deduplication!)
  const normalSearch = normalizeQText(qText);
  let startIdx = quizQuestions.findIndex(q => normalizeQText(q.qText) === normalSearch);
  if (startIdx < 0) startIdx = 0;

  // Jump to the target question
  if (startIdx > 0) {
    currentQuestionIdx = startIdx;
    displayQuestion();
    saveQuizProgress();
  }
}

// === Study Mode Logic ===
let studyQuestions = [];

async function startStudyMode() {
  if (selectedExams.size === 0) {
    alert("يرجى اختيار قسم واحد على الأقل للمراجعة.");
    return;
  }

  // Show a loading spinner
  const studyBtn = document.getElementById('study-btn');
  const originalText = studyBtn.innerHTML;
  studyBtn.innerHTML = '<span class="loading-spinner-small"></span> جاري التحميل...';
  studyBtn.disabled = true;

  try {
    // 1. Ensure all selected sections are fully loaded
    await ensureSelectedSectionsLoaded();

    // 2. Collect all questions from the selected exams
    studyQuestions = [];
    selectedExams.forEach(key => {
      const [secName, examName] = key.split('|');
      const section = allSections.find(s => s.name === secName);
      if (!section) return;
      const exam = section.exams.find(e => e.name === examName);
      if (!exam || !exam.questions) return;

      exam.questions.forEach(q => {
        studyQuestions.push({
          q: q.q,
          o: q.o,
          c: q.c,
          num: q.num,
          secName: secName,
          examName: examName
        });
      });
    });

    // Deduplicate questions in Study Mode if enabled
    const deduplicate = document.querySelector('input[name="deduplicate"]:checked') ? document.querySelector('input[name="deduplicate"]:checked').value : 'off';
    if (deduplicate === 'on') {
      studyQuestions = deduplicateQuestions(studyQuestions);
    }

    // Sort study questions in standard order to match default quiz mode exactly
    studyQuestions.sort((a, b) => {
      if (a.secName !== b.secName) return a.secName.localeCompare(b.secName);
      if (a.examName !== b.examName) return a.examName.localeCompare(b.examName);
      return (a.num || 0) - (b.num || 0);
    });

    // 3. Render questions in the list
    renderStudyQuestions();

    // 4. Switch Screen
    switchScreen('setup-screen', 'study-screen');
  } catch (err) {
    console.error("Error starting study mode:", err);
    alert("حدث خطأ أثناء تحميل الأسئلة. يرجى المحاولة مرة أخرى.");
  } finally {
    studyBtn.innerHTML = originalText;
    studyBtn.disabled = false;
  }
}

function renderStudyQuestions() {
  const container = document.getElementById('study-questions-list');
  const totalCountEl = document.getElementById('study-total-count');
  if (!container) return;

  container.innerHTML = '';
  if (totalCountEl) {
    totalCountEl.textContent = studyQuestions.length;
  }

  if (studyQuestions.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">لا توجد أسئلة للعرض.</div>';
    return;
  }

  studyQuestions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'study-q-card';
    card.dataset.index = idx + 1; // 1-based display index
    card.id = `study-q-${idx + 1}`;

    const metaText = `${q.secName} › ${q.examName}`;

    card.innerHTML = `
      <div class="study-q-header">
        <span class="study-q-meta">${metaText}</span>
        <span class="study-q-badge">Q ${idx + 1}</span>
      </div>
      <div class="study-q-text">${escapeAttr(q.q)}</div>
      <div class="study-options-container">
        ${q.o.map((opt, oIdx) => {
          const isCorrect = oIdx === q.c;
          const letter = String.fromCharCode(65 + oIdx);
          return `
            <div class="study-option ${isCorrect ? 'correct' : ''}">
              <div class="study-option-letter">${letter}</div>
              <div class="study-option-text">${escapeAttr(opt)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.appendChild(card);
  });
}

function highlightText(text, query) {
  if (!query) return text;
  const words = query.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return text;

  // Sort words descending by length to replace longer terms first (prevents nested tag breakages)
  words.sort((a, b) => b.length - a.length);

  let html = text;
  words.forEach(word => {
    const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Lookahead to match only outside HTML tags
    const regex = new RegExp(`(${escapedWord})(?!(?:[^<]*>))`, 'gi');
    html = html.replace(regex, '<mark class="match-highlight">$1</mark>');
  });
  return html;
}

let studySearchDebounceTimeout = null;
function debounceStudySearch() {
  clearTimeout(studySearchDebounceTimeout);
  studySearchDebounceTimeout = setTimeout(() => {
    filterStudyQuestions();
  }, 200); // 200ms debounce
}

function filterStudyQuestions() {
  const input = document.getElementById('study-search-input');
  const clearBtn = document.getElementById('study-search-clear');
  const cards = document.querySelectorAll('.study-q-card');
  const matchCountEl = document.getElementById('study-match-count');
  if (!input) return;

  const query = input.value.trim().toLowerCase();
  if (clearBtn) {
    clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
  }

  // Scroll to top of window instantly on search input to prevent header clipping/disappearing
  if (query.length > 0) {
    window.scrollTo(0, 0);
  }

  const matchWrapper = document.getElementById('study-match-wrapper');
  if (matchWrapper) {
    matchWrapper.style.display = query.length > 0 ? 'inline-flex' : 'none';
  }

  // Tokenize the search query by spaces
  const queryWords = query.split(/\s+/).filter(word => word.length > 0);
  let visibleCount = 0;

  cards.forEach(card => {
    const idx = parseInt(card.dataset.index) - 1;
    const q = studyQuestions[idx];
    if (!q) return;

    if (queryWords.length === 0) {
      card.classList.remove('hidden');
      visibleCount = studyQuestions.length;

      // Only restore clean HTML if the card was previously highlighted
      if (card.dataset.highlighted === 'true') {
        const metaText = `${q.secName} › ${q.examName}`;
        let qHTML = escapeAttr(q.q);
        let optionsHTML = q.o.map((opt, oIdx) => {
          const isCorrect = oIdx === q.c;
          const letter = String.fromCharCode(65 + oIdx);
          return `
            <div class="study-option ${isCorrect ? 'correct' : ''}">
              <div class="study-option-letter">${letter}</div>
              <div class="study-option-text">${escapeAttr(opt)}</div>
            </div>
          `;
        }).join('');

        card.innerHTML = `
          <div class="study-q-header">
            <span class="study-q-meta">${metaText}</span>
            <span class="study-q-badge">Q ${idx + 1}</span>
          </div>
          <div class="study-q-text">${qHTML}</div>
          <div class="study-options-container">
            ${optionsHTML}
          </div>
        `;
        card.dataset.highlighted = 'false';
      }
      return;
    }

    // Token-based matching: ALL query words must be present in either question stem or options
    const qText = q.q.toLowerCase();
    const options = q.o.map(opt => opt.toLowerCase());
    const isMatch = queryWords.every(word => {
      return qText.includes(word) || options.some(opt => opt.includes(word));
    });

    if (isMatch) {
      card.classList.remove('hidden');
      visibleCount++;

      // Re-render card content with dynamic highlights of ALL matching tokens
      const metaText = `${q.secName} › ${q.examName}`;
      let qHTML = escapeAttr(q.q);
      let optionsHTML = q.o.map((opt, oIdx) => {
        const isCorrect = oIdx === q.c;
        const letter = String.fromCharCode(65 + oIdx);
        let optHTML = escapeAttr(opt);
        optHTML = highlightText(optHTML, query);
        return `
          <div class="study-option ${isCorrect ? 'correct' : ''}">
            <div class="study-option-letter">${letter}</div>
            <div class="study-option-text">${optHTML}</div>
          </div>
        `;
      }).join('');

      qHTML = highlightText(qHTML, query);

      card.innerHTML = `
        <div class="study-q-header">
          <span class="study-q-meta">${metaText}</span>
          <span class="study-q-badge">Q ${idx + 1}</span>
        </div>
        <div class="study-q-text">${qHTML}</div>
        <div class="study-options-container">
          ${optionsHTML}
        </div>
      `;
      card.dataset.highlighted = 'true';
    } else {
      card.classList.add('hidden');
    }
  });

  if (matchCountEl) {
    matchCountEl.textContent = visibleCount;
  }
}

function backToSetupFromStudy() {
  const searchInput = document.getElementById('study-search-input');
  if (searchInput) searchInput.value = '';
  
  const clearBtn = document.getElementById('study-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';

  filterStudyQuestions();
  switchScreen('study-screen', 'setup-screen');
}

  tursoSaveQuizResult({
    total: quizQuestions.length,
    correct: scoreCorrect,
    wrong: scoreWrong,
    skipped: scoreSkipped,
    elapsedSeconds: timeElapsed
  }).then(loadPerformanceStats).catch(e => console.warn('تعذر حفظ نتيجة الاختبار:', e));
