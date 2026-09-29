'use strict';

// No server requests: sample offers contain no personal phone numbers.
const STORAGE_KEY = 'souq-almashir-offers-v1';

// غيّر سعر الدولار وتاريخ آخر تحديث من هنا فقط. لا يوجد تحديث تلقائي.
const DOLLAR_RATE = {
  value: '9.50 د.ل',
  lastUpdated: '2026-09-23',
  trend: 'up' // مثال عرض بطلب المستخدم: up أو down؛ ليس اتجاهًا محسوبًا من أسعار السوق.
};

const categories = {
  'sell-usd': { label: 'بيع دولار', name: 'دولار أمريكي', code: 'USD · US DOLLAR', unit: 'دولار', icon: '$', type: 'sell' },
  'buy-usd': { label: 'شراء دولار', name: 'دولار أمريكي', code: 'USD · US DOLLAR', unit: 'دولار', icon: '$', type: 'buy' },
  'sell-eur': { label: 'بيع يورو', name: 'يورو', code: 'EUR · EURO', unit: 'يورو', icon: '€', type: 'sell' },
  'buy-eur': { label: 'شراء يورو', name: 'يورو', code: 'EUR · EURO', unit: 'يورو', icon: '€', type: 'buy' },
  cheque: { label: 'صكوك', name: 'صك مصرفي', code: 'LYD · BANK CHEQUE', unit: 'د.ل', icon: '▤', type: 'cheque' },
  transfer: { label: 'حوالات', name: 'حوالة مالية', code: 'LYD · MONEY TRANSFER', unit: 'د.ل', icon: '⇄', type: 'transfer' }
};
const samples = [
  { id: 'demo-1', ownerName: 'معلن تجريبي', category: 'sell-usd', amount: 5000, rate: 5.85, city: 'طرابلس', minutes: 10 },
  { id: 'demo-2', ownerName: 'سالم', category: 'buy-usd', amount: 10000, rate: 5.80, city: 'بنغازي', minutes: 25 },
  { id: 'demo-3', ownerName: 'ليلى', category: 'sell-eur', amount: 2500, rate: 6.35, city: 'مصراتة', minutes: 45 },
  { id: 'demo-4', ownerName: 'عمر', category: 'buy-eur', amount: 3000, rate: 6.30, city: 'طرابلس', minutes: 60 },
  { id: 'demo-5', ownerName: 'نورا', category: 'cheque', amount: 20000, rate: 21000, city: 'الزاوية', minutes: 120 },
  { id: 'demo-6', ownerName: 'خالد', category: 'transfer', amount: 8000, rate: 8100, city: 'سبها', minutes: 180 }
].map(offer => ({ ...offer, sample: true, phone: '', note: '' }));
const $ = selector => document.querySelector(selector);
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
let selectedCategory = 'all';
let localOffers = [];
let pendingOffer = null;
let toastTimer;

function normalizeDigits(value) {
  return value.replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
}

// Accept Libyan mobile formats, or international numbers with an explicit country prefix.
function normalizePhone(value) {
  let phone = normalizeDigits(value.trim()).replace(/[\s()\-]/g, '');
  if (/^09[1-5]\d{7}$/.test(phone)) phone = '218' + phone.slice(1);
  else if (/^2189[1-5]\d{7}$/.test(phone)) { /* Already normalized. */ }
  else if (/^(\+|00)[1-9]\d{7,14}$/.test(phone)) phone = phone.replace(/^(\+|00)/, '');
  else return null;
  if (phone.startsWith('218') && !/^2189[1-5]\d{7}$/.test(phone)) return null;
  return phone;
}

function showStorageWarning(message) { $('#storage-warning').textContent = message; $('#storage-warning').hidden = false; }
function updateDollarRateDisplay() {
  const price = $('#dollar-rate-value');
  const value = DOLLAR_RATE.value.replace(/\s*د\.ل\s*$/, '').trim();
  price.textContent = value;
  const meta = $('#dollar-rate-meta');
  const time = $('#dollar-rate-date');
  meta.replaceChildren(time);
  // Prefer a real comparison when available; otherwise use the configured UI example.
  const current = Number(value);
  const previous = DOLLAR_RATE.previousValue;
  const canCompare = Number.isFinite(current) && Number.isFinite(previous);
  const trend = canCompare ? (current > previous ? 'up' : current < previous ? 'down' : 'unchanged') : DOLLAR_RATE.trend;
  if (trend === 'up' || trend === 'down') {
    const rising = trend === 'up';
    const arrow = element('span', 'dollar-rate-trend ' + trend, rising ? '↑' : '↓');
    arrow.setAttribute('aria-hidden', 'true');
    price.append(arrow, element('span', 'visually-hidden', rising ? ' ارتفاع' : ' انخفاض'));
  }
  // A date alone does not provide a real update time; leave the time hidden.
  const clock = DOLLAR_RATE.lastUpdated.match(/(?:T|\s)([01]\d|2[0-3]):([0-5]\d)/);
  time.hidden = !clock;
  time.textContent = clock ? `${clock[1]}:${clock[2]}` : '';
  if (clock) time.dateTime = time.textContent;
  else time.removeAttribute('datetime');
  meta.hidden = !clock;
}
function cleanOwnerName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function ownerInitial(name) {
  return cleanOwnerName(name).charAt(0) || '؟';
}
function isStoredOffer(offer) {
  return offer && typeof offer.id === 'string' && offer.id.startsWith('local-') && Object.hasOwn(categories, offer.category)
    && Number.isFinite(offer.amount) && offer.amount >= 0.01 && offer.amount <= 1e9
    && Number.isFinite(offer.rate) && offer.rate >= 0.0001 && offer.rate <= 1e9
    && typeof offer.city === 'string' && offer.city.length > 0 && offer.city.length <= 60
    && typeof offer.phone === 'string' && /^\d{8,15}$/.test(offer.phone) && normalizePhone('+' + offer.phone) === offer.phone
    && typeof offer.note === 'string' && offer.note.length <= 180 && Number.isFinite(offer.createdAt) && offer.createdAt > 0;
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(saved)) throw new Error('Invalid saved data');
  localOffers = saved.filter(isStoredOffer).map(offer => ({ ...offer, ownerName: cleanOwnerName(offer.ownerName) || 'صاحب عرض محلي', sample: false }));
  if (localOffers.length !== saved.length) showStorageWarning('تم تجاهل بيانات محلية غير صالحة. يمكنك إضافة عروض جديدة.');
} catch { showStorageWarning('تعذّر قراءة التخزين المحلي. يمكنك تجربة الإضافة؛ إذا تعذّر الحفظ فسنخبرك، وستبقى العروض لهذه الجلسة فقط.'); }

function saveOffers() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(localOffers)); return true; }
  catch { showStorageWarning('تعذّر حفظ التغيير في المتصفح. التغييرات الحالية مؤقتة لهذه الجلسة ولن تُحفظ بعد إعادة فتح الصفحة.'); return false; }
}

// User-controlled content is always inserted as text, never HTML.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
// Presentation only: extend this map without changing the available offer categories.
const currencyFlags = { USD: 'usd', EUR: 'eur', GBP: 'gbp', TRY: 'try', TND: 'tnd', LYD: 'lyd' };
function currencyLabel(code) {
  const label = element('span', 'currency-label');
  label.dir = 'ltr';
  if (currencyFlags[code]) {
    const flag = element('img', 'currency-flag');
    flag.src = 'assets/flags/' + currencyFlags[code] + '.svg';
    flag.alt = '';
    flag.width = 24; flag.height = 16;
    flag.setAttribute('aria-hidden', 'true');
    label.append(flag);
  }
  label.append(element('span', '', code));
  return label;
}
function renderCurrencyLabels() {
  document.querySelectorAll('[data-currency]').forEach(node => node.replaceChildren(currencyLabel(node.dataset.currency)));
}
function rateLabel(category) { return ['cheque', 'transfer'].includes(category) ? 'السعر الإجمالي (د.ل)' : 'سعر الوحدة (د.ل)'; }
function timeLabel(offer) {
  if (offer.sample) return offer.minutes < 60 ? `قبل ${offer.minutes} دقيقة · مثال` : `قبل ${offer.minutes / 60} ساعة · مثال`;
  return new Intl.DateTimeFormat('ar-LY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(offer.createdAt);
}
function whatsappIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M20 11.5a8.5 8.5 0 0 1-12.8 7.3L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5ZM8 7.5c0 4 2.5 6.5 6.5 7l1-2-2-1-.8 1c-1.6-.6-2.6-1.6-3.2-3.2l1-.8-1-2Z');
  svg.append(path); return svg;
}
function renderCard(offer) {
  const info = categories[offer.category];
  const card = element('article', 'offer-card');
  const owner = element('div', 'offer-owner');
  const avatar = element('span', 'owner-avatar', ownerInitial(offer.ownerName)); avatar.setAttribute('aria-hidden', 'true');
  const ownerName = element('span', 'owner-name', cleanOwnerName(offer.ownerName) || 'صاحب العرض');
  owner.append(avatar, ownerName);
  const top = element('div', 'card-top');
  const badgeLabel = info.type === 'buy' ? 'طلب شراء' : info.type === 'sell' ? 'عرض بيع' : info.label;
  const time = element('time', '', timeLabel(offer)); if (!offer.sample) time.dateTime = new Date(offer.createdAt).toISOString();
  top.append(element('span', 'category-badge ' + info.type, '● ' + badgeLabel), time);
  const title = element('div', 'card-title');
  const icon = currencyLabel(info.code.split(' · ')[0]);
  const titleText = element('div'); titleText.append(element('h3', '', (info.type === 'sell' ? 'بيع ' : info.type === 'buy' ? 'مطلوب شراء ' : '') + info.name)); title.append(icon, titleText);
  const values = element('dl', 'card-values');
  for (const [label, value, unit] of [['💵 الكمية:', offer.amount, info.code.split(' · ')[0]], ['💰 ' + rateLabel(offer.category) + ':', offer.rate, 'د.ل']]) {
    const group = element('div'); const amount = element('dd'); const numeric = element('bdi', '', number.format(value));
    amount.append(numeric, currencyLabel(unit === 'د.ل' ? 'LYD' : unit)); group.append(element('dt', '', label), amount); values.append(group);
  }
  const meta = element('div', 'card-meta');
  meta.append(element('span', 'city', '📍 ' + offer.city));
  card.append(owner, top, title, values, element('span', `sample-label${offer.sample ? '' : ' local'}`, offer.sample ? 'عرض وهمي · السعر والوقت للتوضيح فقط' : 'عرضك التجريبي · محفوظ على هذا الجهاز فقط'));
  if (offer.note) card.append(element('p', 'card-note', offer.note));
  card.append(meta);
  if (offer.sample) {
    const contact = element('button', 'whatsapp', 'واتساب · غير متاح'); contact.type = 'button'; contact.disabled = true; contact.title = 'التواصل مع العروض الوهمية غير متاح'; contact.prepend(whatsappIcon()); meta.append(contact);
  } else {
    const contact = element('a', 'whatsapp', 'تواصل عبر واتساب');
    const message = `السلام عليكم، بخصوص عرض ${info.label} من ${cleanOwnerName(offer.ownerName) || 'صاحب العرض'} في ساوم: المبلغ ${number.format(offer.amount)} ${info.unit}، ${rateLabel(offer.category)}: ${number.format(offer.rate)}، المدينة: ${offer.city}. هل العرض متاح؟`;
    contact.href = `https://wa.me/${offer.phone}?text=${encodeURIComponent(message)}`; contact.target = '_blank'; contact.rel = 'noopener noreferrer'; contact.setAttribute('aria-label', `تواصل عبر واتساب بشأن ${info.label} في ${offer.city} (يفتح في نافذة جديدة)`); contact.prepend(whatsappIcon());
    const phone = element('bdi', 'phone-display', '+' + offer.phone);
    const remove = element('button', 'delete-offer', 'حذف عرضي'); remove.type = 'button'; remove.addEventListener('click', () => {
      if (!window.confirm('هل تريد حذف هذا العرض من العروض المحفوظة على جهازك؟')) return;
      localOffers = localOffers.filter(item => item.id !== offer.id); const saved = saveOffers(); updateCities(); renderOffers(); toast(saved ? 'تم حذف عرضك من هذا المتصفح.' : 'حُذف العرض لهذه الجلسة فقط؛ تعذّر حفظ التغيير.');
    });
    meta.append(contact); card.append(phone, remove);
  }
  return card;
}
function updateCities() {
  const select = $('#city-filter'); const previous = select.value;
  const cities = [...new Set([...samples, ...localOffers].map(offer => offer.city))].sort((a, b) => a.localeCompare(b, 'ar'));
  select.replaceChildren(new Option('جميع المدن', 'all'), ...cities.map(city => new Option(city, city)));
  select.value = cities.includes(previous) ? previous : 'all';
}
function renderOffers() {
  const query = $('#search').value.trim().toLocaleLowerCase('ar'); const type = $('#type-filter').value; const city = $('#city-filter').value;
  const filtered = [...localOffers].sort((a, b) => b.createdAt - a.createdAt).concat(samples).filter(offer => {
    const info = categories[offer.category];
    return (selectedCategory === 'all' || offer.category === selectedCategory || offer.category.endsWith('-' + selectedCategory)) && (type === 'all' || info.type === type) && (city === 'all' || offer.city === city) && `${info.label} ${info.name} ${info.code} ${offer.city} ${offer.note}`.toLocaleLowerCase('ar').includes(query);
  });
  $('#offer-grid').replaceChildren(...filtered.map(renderCard)); $('#empty-state').hidden = filtered.length > 0;
  $('#result-count').textContent = `${filtered.length} عروض`;
  $('#filter-status').textContent = type !== 'all' || city !== 'all' ? '· مفعّلة' : '';
}
function resetFilters() {
  selectedCategory = 'all'; $('#search').value = ''; $('#type-filter').value = 'all'; $('#city-filter').value = 'all';
  document.querySelectorAll('[data-category]').forEach(button => { const active = button.dataset.category === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  renderOffers();
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500); }
const dialog = $('#offer-dialog'); const form = $('#offer-form');
function showDetails() { $('#details-step').hidden = false; $('#confirm-step').hidden = true; $('#dialog-title').textContent = 'أضف عرضك'; pendingOffer = null; }
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
  form.reset(); showDetails(); $('#owner-name').setCustomValidity(''); $('#phone').setCustomValidity(''); $('#phone-consent').setCustomValidity(''); updateAmountLabels(); dialog.showModal(); document.body.classList.add('modal-open'); $('#owner-name').focus();
}));
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { document.body.classList.remove('modal-open'); });
function updateAmountLabels() { const info = categories[$('#offer-category').value]; $('#amount-label').textContent = info ? `المبلغ (${info.unit})` : 'المبلغ'; $('#rate-label').textContent = info ? rateLabel($('#offer-category').value) : 'السعر المطلوب (د.ل)'; }
$('#offer-category').addEventListener('change', updateAmountLabels);
$('#owner-name').addEventListener('input', () => $('#owner-name').setCustomValidity(''));
$('#phone').addEventListener('input', () => $('#phone').setCustomValidity(''));
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!$('#confirm-step').hidden) { publishOffer(); return; }
  const ownerName = cleanOwnerName($('#owner-name').value);
  const phone = normalizePhone($('#phone').value);
  $('#owner-name').setCustomValidity(ownerName ? '' : 'أدخل اسم صاحب العرض.');
  $('#phone').setCustomValidity(phone ? '' : 'أدخل رقم موبايل ليبي صحيحًا أو رقمًا دوليًا يبدأ بـ + ورمز الدولة.');
  if (!form.reportValidity()) return;
  pendingOffer = { ownerName, category: $('#offer-category').value, amount: Number($('#amount').value), rate: Number($('#rate').value), city: $('#offer-city').value, phone, note: $('#note').value.trim() };
  const info = categories[pendingOffer.category]; const summary = $('#offer-summary'); summary.replaceChildren();
  const entries = [['صاحب العرض', pendingOffer.ownerName], ['الفئة', info.label], ['المبلغ', `${number.format(pendingOffer.amount)} ${info.unit}`], [rateLabel(pendingOffer.category), number.format(pendingOffer.rate)], ['المدينة', pendingOffer.city], ['رقم واتساب', '+' + phone]];
  if (pendingOffer.note) entries.push(['ملاحظة', pendingOffer.note]);
  for (const [label, value] of entries) { const data = element('dd'); data.append(element('bdi', '', value)); summary.append(element('dt', '', label), data); }
  $('#details-step').hidden = true; $('#confirm-step').hidden = false; $('#dialog-title').textContent = 'تأكيد تفاصيل العرض'; $('#phone-consent').checked = false; $('#phone-consent').setCustomValidity(''); $('#phone-consent').focus(); dialog.scrollTop = 0;
});
$('#back-to-form').addEventListener('click', () => { showDetails(); $('#offer-category').focus(); });
$('#phone-consent').addEventListener('change', () => $('#phone-consent').setCustomValidity(''));
function publishOffer() {
  if (!pendingOffer) return;
  const consent = $('#phone-consent'); consent.setCustomValidity(consent.checked ? '' : 'يرجى تأكيد موافقتك على إظهار رقم واتساب ضمن العرض.'); if (!consent.reportValidity()) return;
  localOffers.unshift({ ...pendingOffer, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, createdAt: Date.now(), sample: false });
  const saved = saveOffers(); pendingOffer = null; updateCities(); resetFilters(); dialog.close(); $('#market').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  toast(saved ? 'تمت إضافة عرضك وحفظه على هذا الجهاز فقط.' : 'تمت إضافة عرضك لهذه الجلسة فقط؛ تعذّر الحفظ في المتصفح.');
}
$('#publish-offer').addEventListener('click', publishOffer);
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
  selectedCategory = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); renderOffers();
}));
$('#search').addEventListener('input', renderOffers); $('#type-filter').addEventListener('change', renderOffers); $('#city-filter').addEventListener('change', renderOffers); $('#reset-filters').addEventListener('click', resetFilters);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
$('#ticker-toggle').addEventListener('click', () => { const paused = $('.ticker-track').classList.toggle('paused'); $('#ticker-toggle').setAttribute('aria-pressed', String(paused)); $('#ticker-toggle').setAttribute('aria-label', paused ? 'تشغيل حركة النشرة' : 'إيقاف حركة النشرة'); $('#ticker-toggle').textContent = paused ? '▷' : 'Ⅱ'; });
function updateMotionPreference() { $('#ticker-toggle').hidden = reduceMotion.matches; }
reduceMotion.addEventListener('change', updateMotionPreference); updateMotionPreference();
// Only compare supplied prices; historical demo comparisons have been removed.
// Missing or unchanged previous prices deliberately have no arrow.
function updateTickerTrends() {
  document.querySelectorAll('.ticker-price').forEach(price => {
    price.querySelectorAll('.price-trend').forEach(arrow => arrow.remove());
    price.classList.remove('price-up', 'price-down');
    price.dataset.direction = 'unchanged';
    const current = Number(price.dataset.current);
    const previous = Number(price.dataset.previous);
    if (!price.dataset.current?.trim() || !price.dataset.previous?.trim() || !Number.isFinite(current) || !Number.isFinite(previous) || current === previous) return;
    const rising = current > previous;
    price.dataset.direction = rising ? 'up' : 'down';
    price.classList.add(rising ? 'price-up' : 'price-down');
    const arrow = element('span', 'price-trend', rising ? '↑' : '↓');
    arrow.setAttribute('aria-hidden', 'true');
    price.append(arrow);
    const label = element('span', 'price-trend visually-hidden', rising ? ' ارتفاع عن السعر السابق' : ' انخفاض عن السعر السابق');
    price.append(label);
  });
}
renderCurrencyLabels(); updateTickerTrends();
updateDollarRateDisplay(); $('#year').textContent = new Date().getFullYear(); updateCities(); renderOffers();
