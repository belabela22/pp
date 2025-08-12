/**
 * Accessible Multi-Step Medical Intake Form
 * File: script.js
 * Purpose:
 *  - Manage step navigation, animations, and progress
 *  - Real-time validation (HTML5 + custom regex)
 *  - Autosave to localStorage and restore on load
 *  - Searchable combobox for provider with keyboard accessibility
 *  - Allergy chips add/remove and serialization
 *  - Review & Submit population and final validation
 *  - Print handling and High contrast toggle with persistence
 *  - Accessibility helpers: focus management, live region announcements, ARIA updates
 *
 * Design goals:
 *  - Vanilla JS, no external deps
 *  - Strict, modular structure with clear utilities
 *  - Performance-conscious (debounced inputs, minimal reflows)
 */

/* ===========================
   Utilities
=========================== */

/**
 * Debounce a function
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), delay);
  };
}

/**
 * Helper: query selectors
 */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Live region announcers
 */
const livePolite = () => $('#live-region-polite');
const liveAssertive = () => $('#live-region-assertive');

function announcePolite(msg) {
  const r = livePolite();
  if (!r) return;
  r.textContent = ''; // force change
  requestAnimationFrame(() => { r.textContent = msg; });
}

function announceAssertive(msg) {
  const r = liveAssertive();
  if (!r) return;
  r.textContent = '';
  requestAnimationFrame(() => { r.textContent = msg; });
}

/**
 * Storage helpers (namespaced)
 */
const STORE_KEY = 'intakeForm.v1';
function saveState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    announcePolite('Progress saved.');
  } catch (e) {
    // Storage might fail silently; avoid blocking
  }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function clearState() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (e) {}
}

/**
 * Formatting utilities
 */
function toTitleCase(s) {
  return s.replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\p{L}/gu, m => m.toUpperCase());
}

function formatPhone(value) {
  // Simple normalization + grouping; not region-specific
  const digits = value.replace(/[^\d+]/g, '');
  return digits
    .replace(/(?!^\+)(\D)/g, '')
    .replace(/(\+\d{1,3})?(\d{3})(\d{3})(\d{0,4})/, (_, cc = '', a, b, c) => {
      return [cc, a ? ' ' + a : '', b ? ' ' + b : '', c ? ' ' + c : ''].join('').trim();
    });
}

/**
 * Validators with patterns
 */
const patterns = {
  phone: /^\+?[0-9\s\-\(\)]{7,20}$/,
  policy: /^[A-Za-z0-9\-]{6,25}$/,
  postal: /^[A-Za-z0-9\- ]{3,12}$/,
};

function isNonEmpty(v) { return String(v || '').trim().length > 0; }
function isValidPhone(v) { return patterns.phone.test(String(v || '').trim()); }
function isValidPolicy(v) { return patterns.policy.test(String(v || '').trim()); }
function isValidPostal(v) { return patterns.postal.test(String(v || '').trim()); }

/**
 * Date limits
 */
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function setDateLimits() {
  const dob = $('#dob');
  const coverage = $('#coverageStart');
  const today = todayISO();
  if (dob) {
    // Disallow future DOB; allow last 120 years
    const now = new Date();
    const max = today;
    const minDate = new Date(now.getFullYear() - 120, now.getMonth(), now.getDate());
    const m = String(minDate.getMonth() + 1).padStart(2, '0');
    const d = String(minDate.getDate()).padStart(2, '0');
    const min = `${minDate.getFullYear()}-${m}-${d}`;
    dob.max = max;
    dob.min = min;
  }
  if (coverage) {
    coverage.max = today;
  }
}

/* ===========================
   State
=========================== */

const state = {
  step: 1,
  totalSteps: 4,
  data: {
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
  },
  ui: {
    contrast: false,
  },
};

/* ===========================
   DOM references
=========================== */
const form = $('#intake-form');
const steps = [$('#step-1'), $('#step-2'), $('#step-3'), $('#step-4')];
const backButtons = $$('.btn[data-action="back"]');
const nextButtons = $$('.btn[data-action="next"]');
const submitButton = $('#submit-form');

const progressbar = $('#progressbar');
const progressFill = $('#progressbar-fill');
const stepIndicators = [$('#step-indicator-1'), $('#step-indicator-2'), $('#step-indicator-3'), $('#step-indicator-4')];

const contrastToggle = $('#toggle-contrast');
const printButton = $('#print-form');

const allergyInput = $('#allergyInput');
const allergyAddBtn = $('#add-allergy');
const allergyChips = $('#allergy-chips');
const medicationTextarea = $('#medications');
const medicationCounter = $('#medications-counter');
const notesTextarea = $('#notes');
const notesCounter = $('#notes-counter');

const providerInput = $('#provider-input');
const providerToggle = $('#provider-toggle');
const providerListbox = $('#provider-listbox');
const providerCombo = $('#provider-combobox');

/* ===========================
   Provider data (static list)
=========================== */
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

/* ===========================
   Initialization
=========================== */

function restoreFromStorage() {
  const saved = loadState();
  if (!saved) return;

  // Merge known keys only
  state.step = Math.min(Math.max(saved.step || 1, 1), state.totalSteps);
  Object.assign(state.data, saved.data || {});
  state.ui.contrast = !!(saved.ui && saved.ui.contrast);

  // Reflect UI preference
  if (state.ui.contrast) {
    document.documentElement.setAttribute('data-contrast', 'high');
    contrastToggle.setAttribute('aria-pressed', 'true');
  }

  // Populate form fields
  for (const [key, val] of Object.entries(state.data)) {
    if (key === 'allergies' || key === 'conditions') continue; // handled separately
    const el = document.getElementById(key);
    if (el) el.value = val;
  }

  // Conditions (checkboxes)
  $$('#step-3 input[name="conditions"]').forEach(cb => {
    cb.checked = (state.data.conditions || []).includes(cb.value);
  });

  // Allergies
  renderAllergyChips();

  // Counters
  updateCounter(medicationTextarea, medicationCounter);
  updateCounter(notesTextarea, notesCounter);
}

function initDateLimits() {
  setDateLimits();
}

function initEvents() {
  // Next/Back
  nextButtons.forEach(btn => btn.addEventListener('click', handleNext));
  backButtons.forEach(btn => btn.addEventListener('click', handleBack));
  console.log(`Bound ${nextButtons.length} Next buttons and ${backButtons.length} Back buttons`);

}


  // Submit
  if (form) {
    form.addEventListener('submit', handleSubmit);
    form.addEventListener('input', debounce(handleInput, 50));
    form.addEventListener('change', debounce(handleInput, 50));
    form.addEventListener('focusout', handleBlurValidation, true);
  }

  // Counters
  if (medicationTextarea) medicationTextarea.addEventListener('input', () => updateCounter(medicationTextarea, medicationCounter));
  if (notesTextarea) notesTextarea.addEventListener('input', () => updateCounter(notesTextarea, notesCounter));

  // Name capitalization
  const nameFields = ['firstName', 'lastName', 'city'];
  nameFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('blur', () => {
      el.value = toTitleCase(el.value);
      syncState(id, el.value);
      validateField(el);
    });
  });

  // Phone formatting
  const phoneFields = ['phone', 'insurerPhone'];
  phoneFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      const caret = el.selectionStart;
      el.value = el.value.replace(/[^\d+\s\-\(\)]/g, '');
      syncState(id, el.value);
      // Keep simple to avoid caret jumps
    });
  });

  // Postal uppercase
  const postal = $('#postalCode');
  if (postal) {
    postal.addEventListener('input', () => {
      postal.value = postal.value.toUpperCase();
      syncState('postalCode', postal.value);
    });
  }

  // Provider combobox
  initProviderCombobox();

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

  // Conditions
  $$('#step-3 input[name="conditions"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const selected = $$('#step-3 input[name="conditions"]:checked').map(c => c.value);
      state.data.conditions = selected;
      persist();
    });
  });

  // Contrast
  if (contrastToggle) {
    contrastToggle.addEventListener('click', () => {
      const active = document.documentElement.getAttribute('data-contrast') === 'high';
      if (active) {
        document.documentElement.removeAttribute('data-contrast');
        contrastToggle.setAttribute('aria-pressed', 'false');
        state.ui.contrast = false;
      } else {
        document.documentElement.setAttribute('data-contrast', 'high');
        contrastToggle.setAttribute('aria-pressed', 'true');
        state.ui.contrast = true;
      }
      persist();
    });
  }

  // Print
  if (printButton) {
    printButton.addEventListener('click', () => {
      window.print();
    });
  }

  // Initialize current step
  goToStep(state.step, { announce: false });
}

function initProviderCombobox() {
  // Initial render
  renderProviderList(PROVIDERS);

  // Toggle button expands/collapses
  providerToggle.addEventListener('click', () => {
    const open = providerListbox.hidden === false;
    if (open) closeProviderList();
    else openProviderList();
  });

  // Input typing filters list
  providerInput.addEventListener('input', debounce(onProviderInput, 80));
  providerInput.addEventListener('keydown', onProviderKeydown);

  // Click on option selects
  providerListbox.addEventListener('click', (e) => {
    const opt = e.target.closest('.combo-option');
    if (!opt) return;
    selectProviderOption(opt);
  });

  // Outside click closes
  document.addEventListener('click', (e) => {
    if (!providerCombo.contains(e.target)) {
      closeProviderList();
    }
  });
}

/* ===========================
   Provider combobox logic
=========================== */

let providerActiveId = '';
function renderProviderList(items, activeIndex = 0) {
  providerListbox.innerHTML = '';
  items.forEach((name, i) => {
    const li = document.createElement('li');
    li.id = `provider-opt-${i}`;
    li.role = 'option';
    li.className = 'combo-option';
    li.tabIndex = -1;
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
  providerInput.removeAttribute('aria-activedescendant');
}

function onProviderInput() {
  const q = providerInput.value.trim().toLowerCase();
  const matched = PROVIDERS.filter(p => p.toLowerCase().includes(q));
  renderProviderList(matched);
  openProviderList();
  // set validity indicator
  const cc = providerInput.closest('.form-control');
  if (matched.length === 0) {
    setInvalid(cc, 'provider-error', 'No matching providers found.');
  } else {
    clearInvalid(cc, 'provider-error');
  }
  syncState('provider', providerInput.value);
  persist();
}

function onProviderKeydown(e) {
  const open = providerListbox.hidden === false;
  const options = $$('.combo-option', providerListbox);
  const currentIndex = options.findIndex(o => o.id === providerActiveId);

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (!open) openProviderList();
      if (options.length === 0) return;
      moveActive(options, Math.min(currentIndex + 1, options.length - 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (!open) openProviderList();
      if (options.length === 0) return;
      moveActive(options, Math.max(currentIndex - 1, 0));
      break;
    case 'Home':
      e.preventDefault();
      if (!open) openProviderList();
      if (options.length === 0) return;
      moveActive(options, 0);
      break;
    case 'End':
      e.preventDefault();
      if (!open) openProviderList();
      if (options.length === 0) return;
      moveActive(options, options.length - 1);
      break;
    case 'Enter':
      if (!open) return;
      e.preventDefault();
      if (options.length === 0) return;
      selectProviderOption(options[currentIndex >= 0 ? currentIndex : 0]);
      break;
    case 'Escape':
      if (open) {
        e.preventDefault();
        closeProviderList();
      }
      break;
  }
}

function moveActive(options, index) {
  options.forEach((opt, i) => {
    opt.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
  providerActiveId = options[index].id;
  providerInput.setAttribute('aria-activedescendant', providerActiveId);
  options[index].scrollIntoView({ block: 'nearest' });
}

function selectProviderOption(opt) {
  providerInput.value = opt.textContent;
  syncState('provider', providerInput.value);
  persist();
  closeProviderList();
  providerInput.focus();
  // set valid state
  const cc = providerInput.closest('.form-control');
  setValid(cc, 'provider-valid');
}

/* ===========================
   Allergy chips
=========================== */

function addAllergyFromInput() {
  const val = (allergyInput.value || '').trim();
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
  allergyChips.innerHTML = '';
  state.data.allergies.forEach((name, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.setAttribute('data-index', String(index));
    chip.textContent = name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.setAttribute('aria-label', `Remove allergy ${name}`);
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      removeAllergy(index);
    });

    chip.appendChild(remove);
    allergyChips.appendChild(chip);
  });
  // Update summary if on step 4 later
}

function removeAllergy(index) {
  state.data.allergies.splice(index, 1);
  renderAllergyChips();
  persist();
}

/* ===========================
   Counters
=========================== */

function updateCounter(el, target) {
  if (!el || !target) return;
  const max = Number(el.getAttribute('maxlength') || 0);
  const val = String(el.value || '');
  target.textContent = `${val.length} / ${max}`;
}

/* ===========================
   Validation and UI states
=========================== */

function setValid(control, validId) {
  if (!control) return;
  control.classList.remove('invalid');
  control.classList.add('valid');
  if (validId) {
    const elm = document.getElementById(validId);
    if (elm) elm.hidden = false;
  }
  // Hide any error messages inside this control
  $$('.error', control).forEach(e => e.hidden = true);
}

function setInvalid(control, errorId, msg) {
  if (!control) return;
  control.classList.remove('valid');
  control.classList.add('invalid');
  if (errorId) {
    const elm = document.getElementById(errorId);
    if (elm) {
      if (msg) elm.textContent = msg;
      elm.hidden = false;
    }
  }
  // Hide any valid messages
  $$('.valid', control).forEach(v => v.hidden = true);
}

function clearInvalid(control, errorId) {
  if (!control) return;
  control.classList.remove('invalid');
  if (errorId) {
    const elm = document.getElementById(errorId);
    if (elm) elm.hidden = true;
  }
}

/**
 * Validate a single field by id or element, set UI class and messages
 * @param {HTMLElement|string} el
 * @returns {boolean}
 */
function validateField(el) {
  el = typeof el === 'string' ? document.getElementById(el) : el;
  if (!el) return true;

  const control = el.closest('.form-control') || el.closest('.combo')?.parentElement;

  const id = el.id;
  const val = (el.value || '').trim();

  let valid = true;

  switch (id) {
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
    case 'insurerPhone':
      if (!val) {
        valid = id === 'phone' ? false : true; // phone required, insurerPhone optional
      } else {
        valid = isValidPhone(val);
      }
      break;
    case 'email':
      valid = el.checkValidity(); // HTML5 email validation
      break;
    case 'postalCode':
      valid = isValidPostal(val);
      break;
    case 'provider-input':
      valid = isNonEmpty(val);
      break;
    case 'policyNumber':
      valid = isValidPolicy(val);
      // Also verify confirm if present
      const confirm = $('#policyConfirm');
      if (confirm && confirm.value) {
        validateField(confirm);
      }
      break;
    case 'policyConfirm':
      valid = isNonEmpty(val) && val === ($('#policyNumber').value || '');
      break;
    case 'coverageStart':
      valid = isNonEmpty(val) && new Date(val) <= new Date();
      break;
    default:
      // For misc, rely on built-in validity when present
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        valid = el.required ? el.checkValidity() : true;
      }
  }

  if (valid) setValid(control, `${id}-valid`);
  else setInvalid(control, `${id}-error`);

  return valid;
}

/**
 * Validate a full step
 * @param {number} step
 * @returns {{valid: boolean, firstInvalid?: HTMLElement}}
 */
function validateStep(step) {
  const fs = steps[step - 
