'use strict';

/**
 * Accessible Multi-Step Medical Intake Form — script.js
 * Implements:
 * - Step navigation with validation gates and progress updates
 * - Real-time validation and input hints
 * - Autosave/restore via localStorage
 * - Searchable, keyboard-accessible combobox for insurance providers
 * - Allergy chips add/remove
 * - Review step population and edit-jump
 * - Print and high-contrast toggles with persistence
 * - Focus management, ARIA announcements, and keyboard support
 */

/* =========================================
   Utilities
========================================= */

/** Shortcuts */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Debounce */
function debounce(fn, delay = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), delay);
  };
}

/** Live region announcers */
const politeRegion = () => $('#live-region-polite');
const assertiveRegion = () => $('#live-region-assertive');

function announcePolite(msg) {
  const r = politeRegion();
  if (!r) return;
  r.textContent = '';
  requestAnimationFrame(() => (r.textContent = msg));
}
function announceAssertive(msg) {
  const r = assertiveRegion();
  if (!r) return;
  r.textContent = '';
  requestAnimationFrame(() => (r.textContent = msg));
}

/** Title case names/city */
function toTitleCase(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\p{L}/gu, (m) => m.toUpperCase());
}

/** Today ISO yyyy-mm-dd */
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Storage helpers */
const STORE_KEY = 'intakeForm.v1';
function saveState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {}
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearState() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {}
}

/* =========================================
   State
========================================= */

const state = {
  step: 1,
  totalSteps: 4,
  data: {
    // Step 1
    firstName: '',
    lastName: '',
    dob: '',
    gender: '',
    phone: '',
    email: '',
    address1: '',
    address2: '',
    city: '',
    postalCode: '',
    country: '',
    // Step 2
    provider: '',
    policyNumber: '',
    policyConfirm: '',
    groupNumber: '',
    coverageStart: '',
    insurerPhone: '',
    // Step 3
    allergies: [],
    conditions: [],
    medications: '',
    notes: '',
  },
  ui: {
    contrast: false,
  },
};

/* =========================================
   Patterns and validators
========================================= */

const patterns = {
  phone: /^\+?[0-9\s\-\(\)]{7,20}$/,
  policy: /^[A-Za-z0-9\-]{6,25}$/,
  postal: /^[A-Za-z0-9\- ]{3,12}$/,
};

const isNonEmpty = (v) => String(v || '').trim().length > 0;
const isValidPhone = (v) => patterns.phone.test(String(v || '').trim());
const isValidPolicy = (v) => patterns.policy.test(String(v || '').trim());
const isValidPostal = (v) => patterns.postal.test(String(v || '').trim());

/* =========================================
   DOM references
========================================= */

const form = $('#intake-form');
const steps = [$('#step-1'), $('#step-2'), $('#step-3'), $('#step-4')];
const stepIndicators = [$('#step-indicator-1'), $('#step-indicator-2'), $('#step-indicator-3'), $('#step-indicator-4')];
const progressbar = $('#progressbar');
const progressFill = $('#progressbar-fill');

const nextButtons = $$('.btn[data-action="next"]');
const backButtons = $$('.btn[data-action="back"]');
const submitButton = $('#submit-form');

const contrastToggle = $('#toggle-contrast');
const printButton = $('#print-form');

// Step 3 refs
const allergyInput = $('#allergyInput');
const allergyAddBtn = $('#add-allergy');
const allergyChips = $('#allergy-chips');
const medicationTextarea = $('#medications');
const medicationCounter = $('#medications-counter');
const notesTextarea = $('#notes');
const notesCounter = $('#notes-counter');

// Combobox refs (Step 2)
const providerCombo = $('#provider-combobox');
const providerInput = $('#provider-input');
const providerToggle = $('#provider-toggle');
const providerListbox = $('#provider-listbox');

/* =========================================
   Static provider list
========================================= */
const PROVIDERS = [
  'SIGMA Health',
  'Eurolife Insurance',
  'Vienna Insurance Group',
  'UNION Health',
  'Delfin Insurance',
  'Bupa',
  'Allianz',
  'Aetna',
  'Cigna',
  'Humana',
  'UnitedHealthcare',
  'Blue Cross Blue Shield',
  'Kaiser Permanente',
  'AXA',
  'Zurich Insurance',
  'MetLife',
  'Prudential',
  'Generali',
  'Engjelli Insurance',
  'Illyrian Health',
];

/* =========================================
   Initialization
========================================= */

function init() {
  setDateLimits();
  restoreFromStorage();
  bindEvents();
  initProviderCombobox();
  updateCounters();
  goToStep(state.step, { announce: false, focus: true });
}

function setDateLimits() {
  const dob = $('#dob');
  const coverage = $('#coverageStart');
  const today = todayISO();

  if (dob) {
    const now = new Date();
    const minDate = new Date(now.getFullYear() - 120, now.getMonth(), now.getDate());
    const m = String(minDate.getMonth() + 1).padStart(2, '0');
    const d = String(minDate.getDate()).padStart(2, '0');
    dob.min = `${minDate.getFullYear()}-${m}-${d}`;
    dob.max = today;
  }
  if (coverage) coverage.max = today;
}

function restoreFromStorage() {
  const saved = loadState();
  if (!saved) return;

  state.step = Math.min(Math.max(saved.step || 1, 1), state.totalSteps);
  Object.assign(state.data, saved.data || {});
  state.ui.contrast = !!(saved.ui && saved.ui.contrast);

  // Apply contrast preference
  if (state.ui.contrast) {
    document.documentElement.setAttribute('data-contrast', 'high');
    if (contrastToggle) contrastToggle.setAttribute('aria-pressed', 'true');
  }

  // Refill form controls
  for (const [key, val] of Object.entries(state.data)) {
    if (Array.isArray(val)) continue; // allergies/conditions handled separately
    const el = document.getElementById(key);
    if (el) el.value = val;
  }

  // Conditions
  $$('#step-3 input[name="conditions"]').forEach((cb) => {
    cb.checked = (state.data.conditions || []).includes(cb.value);
  });

  // Allergies
  renderAllergyChips();
}

function bindEvents() {
  // Navigation
  nextButtons.forEach((btn) => btn.addEventListener('click', handleNext));
  backButtons.forEach((btn) => btn.addEventListener('click', handleBack));

  // Submit
  if (form) {
    form.addEventListener('submit', handleSubmit);
    form.addEventListener('input', debounce(handleInput, 60));
    form.addEventListener('change', debounce(handleInput, 60));
    form.addEventListener('focusout', handleBlurValidation, true);
  }

  // Name/city normalization on blur
  ['firstName', 'lastName', 'city'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => {
      el.value = toTitleCase(el.value);
      syncState(id, el.value);
      validateField(el);
      persist();
    });
  });

  // Postal uppercase
  const postal = $('#postalCode');
  if (postal) {
    postal.addEventListener('input', () => {
      postal.value = postal.value.toUpperCase();
      syncState('postalCode', postal.value);
      validateField(postal);
      persist();
    });
  }

  // Phone sanitization
  ;['phone', 'insurerPhone'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^\d+\s\-\(\)]/g, '');
      syncState(id, el.value);
      validateField(el);
      persist();
    });
  });

  // Conditions
  $$('#step-3 input[name="conditions"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const selected = $$('#step-3 input[name="conditions"]:checked').map((c) => c.value);
      state.data.conditions = selected;
      persist();
    });
  });

  // Allergies
  if (allergyAddBtn) allergyAddBtn.addEventListener('click', addAllergyFromInput);
  if (allergyInput) {
    allergyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addAllergyFromInput();
      }
    });
  }

  // Counters
  if (medicationTextarea) medicationTextarea.addEventListener('input', () => updateCounter(medicationTextarea, medicationCounter));
  if (notesTextarea) notesTextarea.addEventListener('input', () => updateCounter(notesTextarea, notesCounter));

  // Edit buttons (review step)
  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-section');
    if (!editBtn) return;
    const step = Number(editBtn.getAttribute('data-edit-step') || '1');
    goToStep(step, { focus: true, announce: true });
  });

  // Contrast
  if (contrastToggle) {
    contrastToggle.addEventListener('click', () => {
      const on = document.documentElement.getAttribute('data-contrast') === 'high';
      if (on) {
        document.documentElement.removeAttribute('data-contrast');
        contrastToggle.setAttribute('aria-pressed', 'false');
        state.ui.contrast = false;
      } else {
        document.documentElement.setAttribute('data-contrast', 'high');
        contrastToggle.setAttribute('aria-pressed', 'true');
        state.ui.contrast = true;
      }
      persist(false);
      announcePolite(state.ui.contrast ? 'High contrast enabled.' : 'High contrast disabled.');
    });
  }

  // Print
  if (printButton) {
    printButton.addEventListener('click', () => {
      window.print();
    });
  }
}

/* =========================================
   Input and autosave
========================================= */

function handleInput(e) {
  const t = e.target;
  if (!t.name && !t.id) return;

  // Map provider-input field to "provider" key
  const key = t.id === 'provider-input' ? 'provider' : t.id;

  // Synchronize state for known fields
  if (key in state.data) {
    // Textareas update counters
    if (t === medicationTextarea) updateCounter(medicationTextarea, medicationCounter);
    if (t === notesTextarea) updateCounter(notesTextarea, notesCounter);

    // Keep raw value (formatters handled in dedicated listeners)
    syncState(key, t.value);
    validateField(t);
    persist();
  }
}

function handleBlurValidation(e) {
  const t = e.target;
  if (!t || !t.id) return;
  validateField(t);
}

function syncState(key, value) {
  if (!(key in state.data)) return;
  state.data[key] = value;
}

/** Persist app state to storage */
function persist(announce = true) {
  saveState(state);
  if (announce) announcePolite('Progress saved.');
}

/* =========================================
   Validation
========================================= */

function setValid(control, validId) {
  if (!control) return;
  control.classList.remove('invalid');
  control.classList.add('valid');
  if (validId) {
    const ok = document.getElementById(validId);
    if (ok) ok.hidden = false;
  }
  $$('.error', control).forEach((el) => (el.hidden = true));
}

function setInvalid(control, errorId, msg) {
  if (!control) return;
  control.classList.remove('valid');
  control.classList.add('invalid');
  if (errorId) {
    const err = document.getElementById(errorId);
    if (err) {
      if (msg) err.textContent = msg;
      err.hidden = false;
    }
  }
  $$('.valid', control).forEach((el) => (el.hidden = true));
}

function clearStatus(control) {
  if (!control) return;
  control.classList.remove('valid', 'invalid');
  $$('.valid', control).forEach((el) => (el.hidden = true));
  $$('.error', control).forEach((el) => (el.hidden = true));
}

/** Validate a single field element */
function validateField(el) {
  if (!el) return true;
  // If it's the provider input, control is combo's parent form-control
  const comboControl = el.closest('.combo')?.parentElement;
  const control = el.closest('.form-control') || comboControl || el.parentElement;
  const id = el.id;
  const val = String(el.value || '').trim();
  let valid = true;

  switch (id) {
    // Required non-empty
    case 'firstName':
    case 'lastName':
    case 'address1':
    case 'city':
    case 'country':
      valid = isNonEmpty(val);
      break;
    case 'dob':
      valid = isNonEmpty(val) && new Date(val) <= new Date();
      break;
    case 'phone':
      valid = isNonEmpty(val) && isValidPhone(val);
      break;
    case 'email':
      valid = el.checkValidity();
      break;
    case 'postalCode':
      valid = isValidPostal(val);
      break;
    case 'provider-input':
      valid = isNonEmpty(val);
      break;
    case 'policyNumber':
      valid = isValidPolicy(val);
      // Also recheck confirm field if it has a value
      const confirm = $('#policyConfirm');
      if (confirm && confirm.value) validateField(confirm);
      break;
    case 'policyConfirm':
      valid = isNonEmpty(val) && val === ($('#policyNumber').value || '');
      break;
    case 'coverageStart':
      valid = isNonEmpty(val) && new Date(val) <= new Date();
      break;
    case 'insurerPhone':
      valid = !val || isValidPhone(val); // optional
      break;
    default:
      valid = el.required ? el.checkValidity() : true;
  }

  if (valid) setValid(control, `${id}-valid`);
  else setInvalid(control, `${id}-error`);

  return valid;
}

/** Validate an entire step; returns { valid, firstInvalid } */
function validateStep(stepNumber) {
  const requiredByStep = {
    1: ['firstName', 'lastName', 'dob', 'phone', 'email', 'address1', 'city', 'postalCode', 'country'],
    2: ['provider-input', 'policyNumber', 'policyConfirm', 'coverageStart'],
    3: [], // optional fields only
    4: [], // review step shows data only
  };

  let firstInvalid = null;
  let allValid = true;
  const stepEl = steps[stepNumber - 1];

  // Validate required fields
  const requiredIds = requiredByStep[stepNumber] || [];
  requiredIds.forEach((id) => {
    const el = document.getElementById(id);
    const ok = validateField(el);
    if (allValid && !ok) firstInvalid = el;
    allValid = allValid && ok;
  });

  // Validate optional with patterns (if filled)
  if (stepNumber === 2) {
    const insurerPhone = $('#insurerPhone');
    if (insurerPhone && insurerPhone.value && !validateField(insurerPhone)) {
      allValid = false;
      if (!firstInvalid) firstInvalid = insurerPhone;
    }
  }

  // Additionally check HTML5 constraints present in this step
  $$('input, select, textarea', stepEl).forEach((el) => {
    if (!requiredIds.includes(el.id)) {
      // only validate optional if it's not empty or has pattern/date constraints
      if ((el.value && el.value.trim().length > 0) || el.type === 'date') {
        const ok = validateField(el);
        if (allValid && !ok) firstInvalid = el;
        allValid = allValid && ok;
      }
    }
  });

  return { valid: allValid, firstInvalid };
}

/* =========================================
   Navigation and progress
========================================= */

function handleNext(e) {
  const btn = e.currentTarget;
  const next = Number(btn.dataset.next || (state.step + 1));
  const current = state.step;

  const { valid, firstInvalid } = validateStep(current);
  if (!valid) {
    if (firstInvalid) {
      firstInvalid.focus();
      announceAssertive('Please correct the highlighted fields before proceeding.');
    }
    return;
  }

  // If moving to review, refresh summary
  if (next === 4) populateReview();

  goToStep(next, { focus: true, announce: true });
  persist(false);
}

function handleBack(e) {
  const btn = e.currentTarget;
  const prev = Number(btn.dataset.prev || (state.step - 1));
  const target = Math.max(1, prev);
  goToStep(target, { focus: true, announce: true });
  persist(false);
}

function goToStep(stepNumber, opts = { focus: true, announce: true }) {
  const s = Math.min(Math.max(stepNumber, 1), state.totalSteps);
  const currentEl = steps[state.step - 1];
  const nextEl = steps[s - 1];

  if (currentEl && currentEl !== nextEl) currentEl.hidden = true;
  if (nextEl) nextEl.hidden = false;

  // Update current class
  steps.forEach((fs, i) => {
    if (!fs) return;
    if (i === s - 1) fs.classList.add('is-current');
    else fs.classList.remove('is-current');
  });

  // Progress
  updateProgress(s);

  // Focus management: first invalid or first focusable
  if (opts.focus !== false) {
    const firstInvalid = $$('[aria-invalid="true"]', nextEl)[0];
    if (firstInvalid) firstInvalid.focus();
    else {
      const focusable = $('input, select, textarea, button', nextEl);
      if (focusable) focusable.focus();
    }
  }

  // Announce
  if (opts.announce !== false) {
    const name = nextEl?.getAttribute('data-step-name') || `Step ${s}`;
    announcePolite(`Step ${s} of ${state.totalSteps}: ${name}`);
  }

  // Enable/disable Back in first step
  const backBtn = $(`#back-${s}`);
  if (backBtn) {
    if (s === 1) {
      backBtn.disabled = true;
      backBtn.setAttribute('aria-disabled', 'true');
    } else {
      backBtn.disabled = false;
      backBtn.removeAttribute('aria-disabled');
    }
  }

  state.step = s;
  persist(false);
}

function updateProgress(stepNumber) {
  const percent = (stepNumber / state.totalSteps) * 100;
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (progressbar) {
    progressbar.setAttribute('aria-valuenow', String(stepNumber));
  }
  stepIndicators.forEach((li, i) => {
    if (!li) return;
    if (i === stepNumber - 1) {
      li.classList.add('is-active');
      li.setAttribute('aria-current', 'step');
    } else {
      li.classList.remove('is-active');
      li.removeAttribute('aria-current');
    }
  });
}

/* =========================================
   Combobox (searchable provider)
========================================= */

let providerActiveId = '';
let providerFiltered = [...PROVIDERS];

function initProviderCombobox() {
  if (!providerInput || !providerToggle || !providerListbox) return;

  renderProviderList(providerFiltered);

  providerToggle.addEventListener('click', () => {
    const open = !providerListbox.hidden;
    if (open) closeProviderList();
    else openProviderList();
  });

  providerInput.addEventListener(
    'input',
    debounce(() => {
      const q = providerInput.value.trim().toLowerCase();
      providerFiltered = PROVIDERS.filter((p) => p.toLowerCase().includes(q));
      renderProviderList(providerFiltered);
      if (providerFiltered.length) openProviderList();
      else closeProviderList();

      // Sync and validate
      syncState('provider', providerInput.value);
      validateField(providerInput);
      persist();
    }, 80)
  );

  providerInput.addEventListener('keydown', onProviderKeydown);

  providerListbox.addEventListener('click', (e) => {
    const opt = e.target.closest('.combo-option');
    if (!opt) return;
    selectProvider(opt);
  });

  document.addEventListener('click', (e) => {
    if (!providerCombo.contains(e.target)) closeProviderList();
  });
}

function renderProviderList(items) {
  providerListbox.innerHTML = '';
  items.forEach((name, i) => {
    const li = document.createElement('li');
    li.id = `provider-opt-${i}`;
    li.className = 'combo-option';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    li.textContent = name;
    providerListbox.appendChild(li);
  });
  if (items.length) {
    providerActiveId = 'provider-opt-0';
    providerInput.setAttribute('aria-activedescendant', providerActiveId);
  } else {
    providerActiveId = '';
    providerInput.removeAttribute('aria-activedescendant');
  }
}

function openProviderList() {
  providerListbox.hidden = false;
  providerInput.setAttribute('aria-expanded', 'true');
  providerToggle.setAttribute('aria-expanded', 'true');
}
function closeProviderList() {
  providerListbox.hidden = true;
  providerInput.setAttribute('aria-expanded', 'false');
  providerToggle.setAttribute('aria-expanded', 'false');
}

function onProviderKeydown(e) {
  const open = !providerListbox.hidden;
  const options = $$('.combo-option', providerListbox);
  const idx = options.findIndex((o) => o.id === providerActiveId);

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (!open) openProviderList();
      if (!options.length) return;
      moveProviderActive(options, Math.min(idx + 1, options.length - 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (!open) openProviderList();
      if (!options.length) return;
      moveProviderActive(options, Math.max(idx - 1, 0));
      break;
    case 'Home':
      e.preventDefault();
      if (!open) openProviderList();
      if (!options.length) return;
      moveProviderActive(options, 0);
      break;
    case 'End':
      e.preventDefault();
      if (!open) openProviderList();
      if (!options.length) return;
      moveProviderActive(options, options.length - 1);
      break;
    case 'Enter':
      if (!open) return;
      e.preventDefault();
      if (!options.length) return;
      selectProvider(options[idx >= 0 ? idx : 0]);
      break;
    case 'Escape':
      if (open) {
        e.preventDefault();
        closeProviderList();
      }
      break;
  }
}

function moveProviderActive(options, index) {
  options.forEach((o, i) => o.setAttribute('aria-selected', i === index ? 'true' : 'false'));
  providerActiveId = options[index].id;
  providerInput.setAttribute('aria-activedescendant', providerActiveId);
  options[index].scrollIntoView({ block: 'nearest' });
}

function selectProvider(opt) {
  providerInput.value = opt.textContent;
  syncState('provider', providerInput.value);
  validateField(providerInput);
  persist();
  closeProviderList();
  providerInput.focus();
}

/* =========================================
   Allergies chips
========================================= */

function addAllergyFromInput() {
  const val = String(allergyInput.value || '').trim();
  if (!val) return;
  if (state.data.allergies.includes(val)) {
    announcePolite('Allergy already added.');
    allergyInput.value = '';
    return;
  }
  state.data.allergies.push(val);
  allergyInput.value = '';
  renderAllergyChips();
  persist();
}

function renderAllergyChips() {
  if (!allergyChips) return;
  allergyChips.innerHTML = '';
  state.data.allergies.forEach((name, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.setAttribute('aria-label', `Remove allergy ${name}`);
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      state.data.allergies.splice(index, 1);
      renderAllergyChips();
      persist();
    });

    chip.appendChild(remove);
    allergyChips.appendChild(chip);
  });
}

/* =========================================
   Counters
========================================= */

function updateCounter(el, target) {
  if (!el || !target) return;
  const max = Number(el.getAttribute('maxlength') || 0);
  const len = String(el.value || '').length;
  target.textContent = `${len} / ${max}`;
}
function updateCounters() {
  updateCounter(medicationTextarea, medicationCounter);
  updateCounter(notesTextarea, notesCounter);
}

/* =========================================
   Review population
========================================= */

function populateReview() {
  // Demographics
  setSummary('sum-firstName', state.data.firstName);
  setSummary('sum-lastName', state.data.lastName);
  setSummary('sum-dob', state.data.dob);
  setSummary('sum-gender', labelForSelect('#gender', state.data.gender) || '—');
  setSummary('sum-phone', state.data.phone);
  setSummary('sum-email', state.data.email);
  const addr = [state.data.address1, state.data.address2].filter(Boolean).join(', ');
  setSummary('sum-address', addr || '—');
  setSummary('sum-city', state.data.city);
  setSummary('sum-postalCode', state.data.postalCode);
  setSummary('sum-country', state.data.country);

  // Insurance
  setSummary('sum-provider', state.data.provider);
  setSummary('sum-policyNumber', state.data.policyNumber);
  setSummary('sum-groupNumber', state.data.groupNumber || '—');
  setSummary('sum-coverageStart', state.data.coverageStart);
  setSummary('sum-insurerPhone', state.data.insurerPhone || '—');

  // History
  setSummary('sum-allergies', state.data.allergies.length ? state.data.allergies.join(', ') : 'None reported');
  const conds = (state.data.conditions || []);
  setSummary('sum-conditions', conds.length ? conds.join(', ') : 'None selected');
  setSummary('sum-medications', state.data.medications || '—');
  setSummary('sum-notes', state.data.notes || '—');
}

function setSummary(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '—';
}

function labelForSelect(sel, value) {
  const select = $(sel);
  if (!select) return value;
  const opt = $$('option', select).find((o) => o.value === value);
  return opt ? opt.textContent : value;
}

/* =========================================
   Submit
========================================= */

function handleSubmit(e) {
  e.preventDefault();

  // Validate current step gate
  const { valid, firstInvalid } = validateStep(state.step);
  if (!valid) {
    if (firstInvalid) firstInvalid.focus();
    announceAssertive('Please correct errors before submitting.');
    return;
  }

  // Ensure all required steps are valid before submit
  for (let s = 1; s <= 3; s++) {
    const check = validateStep(s);
    if (!check.valid) {
      goToStep(s, { focus: true, announce: true });
      if (check.firstInvalid) check.firstInvalid.focus();
      announceAssertive('Please fix the errors in this step.');
      return;
    }
  }

  // Simulate API submission
  const status = $('#submission-status');
  if (status) {
    status.hidden = false;
    status.textContent = 'Submitting, please wait…';
  }

  // Disable controls during submit
  toggleFormDisabled(true);

  setTimeout(() => {
    if (status) {
      status.textContent = 'Submitted successfully!';
      setTimeout(() => (status.hidden = true), 1200);
    }

    // Clear storage and reset
    clearState();
    form.reset();

    // Reset state
    Object.assign(state.data, {
      firstName: '',
      lastName: '',
      dob: '',
      gender: '',
      phone: '',
      email: '',
      address1: '',
      address2: '',
      city: '',
      postalCode: '',
      country: '',
      provider: '',
      policyNumber: '',
      policyConfirm: '',
      groupNumber: '',
      coverageStart: '',
      insurerPhone: '',
      allergies: [],
      conditions: [],
      medications: '',
      notes: '',
    });

    renderAllergyChips();
    updateCounters();

    // Return to step 1
    goToStep(1, { focus: true, announce: true });

    // Re-enable
    toggleFormDisabled(false);

    announcePolite('Form submitted and progress cleared.');
  }, 900);
}

function toggleFormDisabled(disabled) {
  $$('input, select, textarea, button', form).forEach((el) => {
    if (el.id === 'toggle-contrast' || el.id === 'print-form') return;
    el.disabled = disabled;
  });
}

/* =========================================
   Accessibility helpers
========================================= */

// Mark aria-invalid on invalid inputs based on .invalid class
const mutationObserver = new MutationObserver(() => {
  $$('.form-control').forEach((control) => {
    const input = $('input, select, textarea, .combo-input', control);
    if (!input) return;
    if (control.classList.contains('invalid')) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  });
});
mutationObserver.observe(document.documentElement, {
  subtree: true,
  attributes: true,
  attributeFilter: ['class'],
});

/* =========================================
   Kickoff
========================================= */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
