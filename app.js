import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { appSettings, firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const stateLabels = {
  recibido: 'Recibida',
  por_vencer: 'Por vencer',
  vencida: 'Vencida',
  completada: 'Completada',
};

const authView = document.querySelector('#authView');
const appView = document.querySelector('#appView');
const loginForm = document.querySelector('#loginForm');
const authError = document.querySelector('#authError');
const emailInput = document.querySelector('#emailInput');
const passwordInput = document.querySelector('#passwordInput');
const googleLoginButton = document.querySelector('#googleLoginButton');
const userEmail = document.querySelector('#userEmail');
const userAvatar = document.querySelector('#userAvatar');
const workspace = document.querySelector('.workspace');
const confirmDialogNode = document.querySelector('#confirmDialog');
const toastRegion = document.querySelector('#toastRegion');
const logoutButton = document.querySelector('#logoutButton');
const refreshButton = document.querySelector('#refreshButton');
const themeToggle = document.querySelector('#themeToggle');
const searchInput = document.querySelector('#searchInput');
const dueSortButton = document.querySelector('#dueSortButton');
const bulkActions = document.querySelector('#bulkActions');
const bulkSelectedCount = document.querySelector('#bulkSelectedCount');
const bulkSelectedHint = document.querySelector('#bulkSelectedHint');
const bulkFeedback = document.querySelector('#bulkFeedback');
const selectVisibleButton = document.querySelector('#selectVisibleButton');
const selectExpiredButton = document.querySelector('#selectExpiredButton');
const clearSelectionButton = document.querySelector('#clearSelectionButton');
const deleteSelectedButton = document.querySelector('#deleteSelectedButton');
const queueList = document.querySelector('#queueList');
const emptyState = document.querySelector('#emptyState');
const detailPanel = document.querySelector('#detailPanel');
const queueItemTemplate = document.querySelector('#queueItemTemplate');
const tabButtons = document.querySelectorAll('[data-inbox-tab]');

let refreshTimer = null;
let solicitudes = [];
let selectedId = null;
let selectedFileIndex = 0;
let currentUser = null;
let sortByUpcomingDue = false;
let activeInboxTab = 'documentacion';
const selectedBulkIds = new Set();
let bulkDeleteInProgress = false;
const feedbackById = new Map();
const mergeInProgressIds = new Set();
const uploadInProgressIds = new Set();
const pdfPageEditInProgressIds = new Set();
const pdfPageCountCache = new Map();
const pdfPageCountInFlight = new Set();
const pdfPageCountFailedIds = new Set();
const viewInProgressIds = new Set();
const metadataEditIds = new Set();
const metadataSaveInProgressIds = new Set();
const selectedFileDeleteIndexesById = new Map();
const fileDeleteInProgressIds = new Set();
const supportedUploadTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const supportedUploadExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const maxUploadBytes = 20 * 1024 * 1024;

initTheme();

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.textContent = '';
  try {
    await signInWithEmailAndPassword(
      auth,
      emailInput.value.trim(),
      passwordInput.value,
    );
  } catch (error) {
    authError.textContent =
      error.code === 'auth/invalid-credential'
        ? 'Usuario o contraseña incorrectos.'
        : 'No se pudo iniciar sesión.';
  }
});

googleLoginButton.addEventListener('click', async () => {
  authError.textContent = '';
  googleLoginButton.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (error) {
    authError.textContent =
      error.code === 'auth/popup-closed-by-user'
        ? 'Inicio de sesi\u00f3n cancelado.'
        : 'No se pudo iniciar sesi\u00f3n con Google.';
  } finally {
    googleLoginButton.disabled = false;
  }
});

logoutButton.addEventListener('click', () => signOut(auth));
refreshButton.addEventListener('click', refreshSolicitudes);
themeToggle.addEventListener('click', toggleTheme);
searchInput.addEventListener('input', render);
dueSortButton.addEventListener('click', () => {
  sortByUpcomingDue = !sortByUpcomingDue;
  render();
});
selectVisibleButton.addEventListener('click', selectVisibleSolicitudes);
selectExpiredButton.addEventListener('click', selectExpiredSolicitudes);
clearSelectionButton.addEventListener('click', clearBulkSelection);
deleteSelectedButton.addEventListener('click', deleteSelectedMessages);
tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const nextTab = button.dataset.inboxTab || 'documentacion';
    if (nextTab === activeInboxTab) return;
    activeInboxTab = nextTab;
    selectedId = null;
    selectedFileIndex = 0;
    selectedBulkIds.clear();
    bulkFeedback.textContent = '';
    render();
  });
});
document.addEventListener('keydown', (event) => {
  if (appView.classList.contains('is-hidden') || confirmDialogNode.open) return;
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if (event.key === '/' && !typing) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (event.key === 'Escape' && target === searchInput && searchInput.value) {
    searchInput.value = '';
    render();
  }
});

if (appSettings.authRequired) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      showApp(user.email);
      subscribe();
    } else {
      showAuth();
      stopSubscription();
    }
  });
} else {
  showApp('modo interno');
  subscribe();
}

function initTheme() {
  const savedTheme = localStorage.getItem('secretaria-theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (prefersDark ? 'dark' : 'light');
  setTheme(theme);
}

function toggleTheme() {
  const nextTheme =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(nextTheme);
  localStorage.setItem('secretaria-theme', nextTheme);
}

function setTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  const label = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  themeToggle.innerHTML = icon(isDark ? 'sun' : 'moon');
  themeToggle.title = label;
  themeToggle.setAttribute('aria-label', label);
  themeToggle.setAttribute('aria-pressed', String(isDark));
}

function showAuth() {
  authView.classList.remove('is-hidden');
  appView.classList.add('is-hidden');
}

function showApp(email) {
  authView.classList.add('is-hidden');
  appView.classList.remove('is-hidden');
  userEmail.textContent = email || '';
  userEmail.title = email || '';
  const photoUrl = currentUser?.photoURL || '';
  userAvatar.innerHTML = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="" referrerpolicy="no-referrer" />`
    : escapeHtml(initials(currentUser?.displayName || email || '?'));
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function confirmDialog(message, options = {}) {
  const { title = 'Confirmar acción', confirmLabel = 'Confirmar', danger = false } = options;
  confirmDialogNode.querySelector('#confirmTitle').textContent = title;
  confirmDialogNode.querySelector('#confirmMessage').textContent = message;
  const accept = confirmDialogNode.querySelector('#confirmAccept');
  accept.textContent = confirmLabel;
  accept.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  confirmDialogNode.classList.toggle('is-danger', danger);
  confirmDialogNode.returnValue = '';
  return new Promise((resolve) => {
    confirmDialogNode.addEventListener(
      'close',
      () => resolve(confirmDialogNode.returnValue === 'ok'),
      { once: true },
    );
    confirmDialogNode.showModal();
    accept.focus();
  });
}

function showToast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${escapeHtml(message)}</span>`;
  toastRegion.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 220);
  }, 3500);
}

function subscribe() {
  stopSubscription();
  refreshSolicitudes({ silent: true });
  refreshTimer = window.setInterval(() => {
    refreshSolicitudes({ silent: true });
  }, 20000);
}

function stopSubscription() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function currentAdminToken() {
  if (!currentUser) {
    throw new Error('No hay una sesión admin activa.');
  }
  return currentUser.getIdToken();
}

async function callAdminFunction(name, body = {}) {
  const idToken = await currentAdminToken();
  const response = await fetch(`${appSettings.functionsBase}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => '');
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { error: text };
    }
  }
  if (!response.ok || data.error) {
    throw new Error(data.error || data.message || text || `No se pudo ejecutar ${name}.`);
  }
  return data;
}


function render(options = {}) {
  const items = filteredSolicitudes();
  pruneBulkSelection();
  renderTabs();
  renderStats();
  renderSortControls();
  renderBulkActions(items);
  renderQueue(items);
  const selected = solicitudes.find((item) => item.id === selectedId);
  workspace.classList.toggle('has-selection', Boolean(selected));
  if (selected) {
    if (!options.preserveDetail) {
      renderDetail(selected);
    }
  } else {
    renderPlaceholder();
  }
}
function isCorrectionInboxItem(item) {
  if (!item || item.tipoSolicitud === 'correccion') return false;
  const correctionId = (item.correccionMedico?.solicitudCorregidaId || '')
    .toString()
    .trim();
  return item.estado === 'correccion_enviada' || correctionId.length > 0;
}

function isDocumentInboxItem(item) {
  return Boolean(item) && item.tipoSolicitud !== 'correccion' && !isCorrectionInboxItem(item);
}

function matchesActiveInboxTab(item) {
  if (activeInboxTab === 'correcciones') return isCorrectionInboxItem(item);
  if (activeInboxTab === 'listas') {
    return isDocumentInboxItem(item) && isReadyToLoadSolicitud(item);
  }
  return isDocumentInboxItem(item) && !isReadyToLoadSolicitud(item);
}

function renderCorrectionBadge(item) {
  return isCorrectionInboxItem(item)
    ? `<span class="correction-pill">${icon('rotate')}Corrección</span>`
    : '';
}

function inboxTabCount(tab) {
  const previousTab = activeInboxTab;
  activeInboxTab = tab;
  const count = solicitudes.filter(
    (item) => item.eliminadoMesa !== true && matchesActiveInboxTab(item) && !isCompletedSolicitud(item),
  ).length;
  activeInboxTab = previousTab;
  return count;
}

function renderTabs() {
  tabButtons.forEach((button) => {
    const tab = button.dataset.inboxTab;
    const isActive = tab === activeInboxTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
    const counter = button.querySelector('.tab-count');
    if (counter) {
      const count = tab === 'listas'
        ? solicitudes.filter((item) => item.eliminadoMesa !== true && isDocumentInboxItem(item) && isReadyToLoadSolicitud(item)).length
        : inboxTabCount(tab);
      counter.textContent = count;
    }
  });
}

function isCompletedSolicitud(item) {
  return (
    item?.estado === 'completada' ||
    item?.estado === 'completado' ||
    item?.estado === 'cargado' ||
    item?.revisionPrestacional?.revisada === true
  );
}

function isReadyToLoadSolicitud(item) {
  return item?.estado === 'listo_para_cargar' || isCompletedSolicitud(item);
}

function inboxAgeDays(item) {
  const created = dateValue(item?.createdAt);
  if (!Number.isFinite(created)) return 0;
  return Math.floor((Date.now() - created) / 86400000);
}

function isOldInboxSolicitud(item) {
  return !isCompletedSolicitud(item) && inboxAgeDays(item) > 30;
}

function canDeleteWithSingleWarning(item) {
  return isExpiredSolicitud(item) || isOldInboxSolicitud(item);
}

function inboxSortRank(item) {
  if (isCompletedSolicitud(item)) return 3;
  if (isOldInboxSolicitud(item)) return 2;
  if (item?.vistoMesa === true) return 1;
  return 0;
}

function sortInboxItems(items) {
  return items.slice().sort((a, b) => {
    const rankDiff = inboxSortRank(a) - inboxSortRank(b);
    if (rankDiff !== 0) return rankDiff;
    if (sortByUpcomingDue) {
      const priorityDiff = priorityScore(a) - priorityScore(b);
      if (priorityDiff !== 0) return priorityDiff;
    }
    const dueDiff = dateValue(resolveFechaVencimiento(a)) - dateValue(resolveFechaVencimiento(b));
    if (dueDiff !== 0) return dueDiff;
    return dateValue(b.createdAt) - dateValue(a.createdAt);
  });
}

function filteredSolicitudes() {
  const query = normalize(searchInput.value);

  const items = solicitudes.filter((item) => {
      if (!matchesActiveInboxTab(item)) return false;
      if (item.eliminadoMesa === true) return false;
      if (!query) return true;
      const haystack = normalize(
        [
          item.id,
          item.codme,
          item.preId,
          item.pacienteNombre,
          item.doctorDestino,
          item.socio?.nombre,
          item.socio?.email,
          item.socio?.matricula,
          item.observaciones,
        ].join(' '),
      );
      return haystack.includes(query);
    });

  return sortInboxItems(items);
}

function renderSortControls() {
  dueSortButton.classList.toggle('is-active', sortByUpcomingDue);
  dueSortButton.setAttribute('aria-pressed', String(sortByUpcomingDue));
}

function renderStats() {
  const visibleSolicitudes = solicitudes.filter(
    (item) => matchesActiveInboxTab(item) && item.eliminadoMesa !== true,
  );
  const notDone = visibleSolicitudes.filter((item) => !isCompletedSolicitud(item));
  const totalLabel = document.querySelector('#statTotal')?.nextElementSibling;
  const totalCount = activeInboxTab === 'listas' ? visibleSolicitudes.length : notDone.length;
  document.querySelector('#statTotal').textContent = totalCount;
  if (totalLabel) {
    totalLabel.textContent =
      activeInboxTab === 'listas' ? 'Listas para cargar' : 'Total pendientes';
  }
  document.querySelector('#statUrgent').textContent = notDone.filter(
    (item) => priorityInfo(item).level === 'vencida' || priorityInfo(item).level === 'alta',
  ).length;
  document.querySelector('#statReady').textContent = visibleSolicitudes.filter(
    isReadyToLoadSolicitud,
  ).length;
}

function renderBulkActions(items) {
  const selectedItems = selectedBulkItems();
  const expiredCount = selectedItems.filter(isExpiredSolicitud).length;
  const visibleExpired = items.filter(isExpiredSolicitud).length;
  const count = selectedItems.length;

  bulkActions.classList.toggle('has-selection', count > 0);
  bulkActions.classList.toggle('is-processing', bulkDeleteInProgress);
  bulkSelectedCount.textContent =
    count === 1 ? '1 seleccionada' : `${count} seleccionadas`;
  bulkSelectedHint.textContent =
    count > 0
      ? `${expiredCount} vencida${expiredCount === 1 ? '' : 's'} seleccionada${expiredCount === 1 ? '' : 's'}.`
      : visibleExpired > 0
        ? `${visibleExpired} vencida${visibleExpired === 1 ? '' : 's'} en esta vista.`
        : 'Elegí mensajes para operar en lote.';

  clearSelectionButton.disabled = count === 0 || bulkDeleteInProgress;
  deleteSelectedButton.disabled = count === 0 || bulkDeleteInProgress;
  selectVisibleButton.disabled = items.length === 0 || bulkDeleteInProgress;
  selectExpiredButton.disabled = visibleExpired === 0 || bulkDeleteInProgress;
  clearSelectionButton.classList.toggle('is-hidden', count === 0);
  deleteSelectedButton.classList.toggle('is-hidden', count === 0);
  selectExpiredButton.classList.toggle('is-hidden', visibleExpired === 0);
  selectVisibleButton.classList.toggle('is-hidden', items.length === 0);
}

function renderQueue(items) {
  queueList.innerHTML = '';
  emptyState.classList.toggle('is-hidden', items.length > 0);

  for (const item of items) {
    const node = queueItemTemplate.content.firstElementChild.cloneNode(true);
    const itemButton = node.querySelector('.queue-item');
    const checkbox = node.querySelector('.queue-select');
    const priority = priorityInfo(item);
    node.classList.toggle('is-selected', item.id === selectedId);
    node.classList.toggle('is-bulk-selected', selectedBulkIds.has(item.id));
    node.classList.toggle('is-viewed', item.vistoMesa === true);
    node.classList.toggle('is-completed', isCompletedSolicitud(item));
    node.classList.toggle('is-correction', isCorrectionInboxItem(item));
    node.dataset.priority = isCompletedSolicitud(item) ? 'completada' : priority.level;
    checkbox.checked = selectedBulkIds.has(item.id);
    checkbox.setAttribute(
      'aria-label',
      `Seleccionar ${doctorName(item) || patientName(item) || `solicitud ${shortId(item.id)}`}`,
    );
    node.querySelector('.queue-title').textContent =
      doctorName(item) || patientName(item) || `Solicitud ${item.id}`;
    node.querySelector('.queue-subtitle').textContent = `Paciente: ${patientName(item)}`;
    node.querySelector('.queue-dates').innerHTML = `
      <span title="Fecha de práctica">${icon('clock')}${formatDate(item.fechaPractica)}</span>
      <span title="Vencimiento">Vence ${formatDate(resolveFechaVencimiento(item))}</span>
    `;
    const priorityPill = node.querySelector('.priority-pill');
    priorityPill.textContent = priority.label;
    priorityPill.classList.add(`priority-${priority.level}`);
    node.querySelector('.status-pill').textContent = statusLabel(item);
    const correctionBadge = renderCorrectionBadge(item);
    if (correctionBadge) {
      node.querySelector('.queue-meta').insertAdjacentHTML('afterbegin', correctionBadge);
    }
    if (item.vistoMesa === true) {
      const viewedPill = document.createElement('span');
      viewedPill.className = 'viewed-pill';
      viewedPill.innerHTML = `${icon('eye')}${escapeHtml(viewedCountLabel(item))}`;
      viewedPill.title = viewedLabel(item);
      node.querySelector('.queue-meta').appendChild(viewedPill);
    }
    checkbox.addEventListener('change', () => {
      setBulkSelected(item.id, checkbox.checked);
    });
    itemButton.addEventListener('click', () => {
      selectedId = item.id;
      selectedFileIndex = 0;
      const shouldMarkViewed = !hasCurrentViewer(item);
      if (shouldMarkViewed) markSolicitudViewedLocally(item);
      render();
      if (shouldMarkViewed) markSolicitudViewed(item.id);
    });
    queueList.appendChild(node);
  }
}

function renderPlaceholder() {
  detailPanel.innerHTML = `
    <div class="placeholder">
      ${icon('file')}
      <h2>Seleccioná una solicitud</h2>
      <p>La documentación, los archivos y el seguimiento aparecerán en este panel.</p>
    </div>
  `;
}

function renderDetail(item) {
  const archivosOriginales = normalizedFiles(item);
  const archivosCorregidos = normalizedCorrectedFiles(item);
  const archivos = [...archivosOriginales, ...archivosCorregidos];
  const selectedFile = archivos[selectedFileIndex] || archivos[0];
  const priority = priorityInfo(item);
  const cleanupNotice = item.archivosEliminados
    ? `<div class="notice notice-warning">${icon('alert')}<span>Los archivos fueron eliminados por la limpieza mensual el ${formatDateTime(item.archivosEliminadosAt)}. El historial del trámite se conserva.</span></div>`
    : '';
  const correctionNotice = isCorrectionInboxItem(item)
    ? `<div class="notice notice-violet">${icon('rotate')}<span><strong>Corrección recibida:</strong> este mensaje corresponde a documentación reenviada por el médico.</span></div>`
    : '';

  detailPanel.innerHTML = `
    <article class="detail">
      <header class="detail-header">
        <div class="detail-heading">
          <button id="detailBackButton" class="icon-button detail-back" type="button" aria-label="Volver a la bandeja">
            ${icon('chevron-left')}
          </button>
          <div>
            <p class="eyebrow">Solicitud ${shortId(item.id)}</p>
            <h2>${escapeHtml(doctorName(item))}</h2>
            <div class="detail-tags">
              <span class="priority-pill priority-${priority.level}">${icon('clock')}${priority.label}</span>
              <span class="tag">${statusLabel(item)}</span>
              ${renderCorrectionBadge(item)}
              <span class="tag">${icon('file')}${archivos.length} archivo${archivos.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
        <div class="detail-header-side">
          ${renderViewSummary(item)}
        </div>
      </header>

      ${correctionNotice}
      ${cleanupNotice}
      ${renderMetadataPanel(item)}
      ${renderUploadObservations(item.observaciones)}

      <div class="detail-body">
        <div class="files-panel">
          <section class="card">
            <div class="card-head">
              <h3>${icon('file')}Archivos</h3>
            </div>
            <div class="card-body">
              <div class="file-section">
                <p class="file-section-title">Originales</p>
                ${renderFileButtons(archivosOriginales, { offset: 0, solicitudId: item.id })}
                ${renderRemoveSelectedFilesControl(item, archivosOriginales)}
              </div>
              ${renderCorrectedFilesSection(archivosCorregidos, archivosOriginales.length)}
            </div>
          </section>
          ${renderAppendFileControl(item)}
          ${renderPdfPageControl(item, selectedFile)}
          <section class="card merge-card">
            <div class="card-head">
              <h3>${icon('layers')}PDF final unificado</h3>
            </div>
            <div class="card-body">
              ${mergeStatusHtml(item)}
              <button id="mergeFilesButton" class="btn btn-primary" type="button" ${mergeButtonDisabled(item)}>
                ${icon('layers')}${mergeButtonLabel(item)}
              </button>
              ${feedbackHtml(item.id, 'merge')}
            </div>
          </section>
        </div>
        <div class="viewer-panel">
          ${renderViewerToolbar(selectedFile)}
          ${feedbackHtml(item.id, 'save')}
          ${renderViewer(selectedFile)}
        </div>
      </div>

      <div class="actions-grid">
        ${renderCompleteReviewControl(item)}
        <section class="card doctor-card">
          <div class="card-head">
            <h3>${icon('message')}Aviso al médico</h3>
          </div>
          <div class="card-body">
            <p>
              Enviá una observación visible en la app. La solicitud quedará como
              observada y el médico recibirá una notificación.
            </p>
            <label class="sr-only" for="doctorNoticeInput">Motivo para el médico</label>
            <textarea
              id="doctorNoticeInput"
              class="textarea"
              rows="3"
              placeholder="Motivo. Ej: El pedido está incompleto, falta firma o la imagen no es legible."
            >${escapeHtml(item.observacionMedico?.motivo || '')}</textarea>
            <button id="doctorNoticeButton" class="btn btn-secondary" type="button">
              ${icon('send')}Notificar archivo incorrecto
            </button>
            ${notificationStatusHtml(item)}
            ${feedbackHtml(item.id, 'doctor')}
          </div>
        </section>
        <section class="card danger-card">
          <div class="card-head">
            <h3>${icon('trash')}Eliminar de la bandeja</h3>
          </div>
          <div class="card-body">
            <p>
              Oculta esta solicitud de la bandeja de prestacional. El trámite y
              sus archivos quedan guardados en Firebase para auditoría.
            </p>
            <button id="deleteMessageButton" class="btn btn-danger-soft" type="button">
              ${icon('trash')}Eliminar de la bandeja
            </button>
            ${feedbackHtml(item.id, 'delete')}
          </div>
        </section>
      </div>

      ${renderHistory(item.historial)}
    </article>
  `;

  bindFilePickers(detailPanel);
  detailPanel.querySelector('#detailBackButton')?.addEventListener('click', () => {
    selectedId = null;
    selectedFileIndex = 0;
    render();
    window.scrollTo({ top: 0 });
  });
  detailPanel
    .querySelector('#editMetadataButton')
    ?.addEventListener('click', () => {
      metadataEditIds.add(item.id);
      renderDetail(item);
    });
  detailPanel
    .querySelector('#cancelMetadataEditButton')
    ?.addEventListener('click', () => {
      metadataEditIds.delete(item.id);
      renderDetail(item);
    });
  detailPanel
    .querySelector('#metadataEditForm')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveSolicitudMetadata(item.id);
    });
  detailPanel.querySelectorAll('.file-delete-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      setFileSelectedForDelete(item.id, Number(checkbox.dataset.originalIndex), checkbox.checked);
      renderDetail(item);
    });
  });
  detailPanel
    .querySelector('#removeSelectedFilesButton')
    ?.addEventListener('click', () => removeSelectedFilesFromSolicitud(item.id));
  updateRemoveSelectedFilesButton(item.id);
  detailPanel.querySelectorAll('.file-button').forEach((button) => {
    button.addEventListener('click', () => {
      selectedFileIndex = Number(button.dataset.index);
      renderDetail(item);
    });
  });
  detailPanel
    .querySelector('#completeReviewButton')
    ?.addEventListener('click', () => markSolicitudCompleted(item.id));
  detailPanel
    .querySelector('#doctorNoticeButton')
    .addEventListener('click', () => sendDoctorObservation(item.id));
  detailPanel
    .querySelector('#mergeFilesButton')
    ?.addEventListener('click', () => mergeFiles(item.id));
  detailPanel
    .querySelector('#appendFileButton')
    ?.addEventListener('click', () => appendFileToSolicitud(item.id));
  detailPanel
    .querySelector('#removePdfPageButton')
    ?.addEventListener('click', () => removePageFromSelectedPdf(item.id, selectedFile));
  detailPanel
    .querySelector('#movePdfPageButton')
    ?.addEventListener('click', () => movePageInSelectedPdf(item.id, selectedFile));
  detailPanel
    .querySelector('#appendPdfPageButton')
    ?.addEventListener('click', () => appendPageToSelectedPdf(item.id, selectedFile));
  detailPanel.querySelectorAll('.remove-file-button').forEach((button) => {
    button.addEventListener('click', () => {
      removeUploadedFileFromSolicitud(item.id, Number(button.dataset.originalIndex));
    });
  });
  detailPanel
    .querySelector('#deleteMessageButton')
    ?.addEventListener('click', () => deleteMessageFromInbox(item.id));
  detailPanel.querySelector('#downloadFileButton')?.addEventListener('click', () => {
    downloadFile(selectedFile);
  });
  detailPanel.querySelector('#openFileButton')?.addEventListener('click', () => {
    if (selectedFile?.downloadUrl) {
      window.open(selectedFile.downloadUrl, '_blank', 'noopener');
    }
  });
}

function currentViewerProfile() {
  const email = currentUser?.email || 'mesa de ayuda prestacional';
  return {
    uid: currentUser?.uid || email,
    email,
    name: currentUser?.displayName || email,
    photoUrl: currentUser?.photoURL || '',
  };
}

function viewerKey(viewer) {
  return (viewer?.uid || viewer?.email || viewer?.name || '').toString().trim().toLowerCase();
}

function normalizedViewers(item) {
  const source = Array.isArray(item?.vistoMesaUsuarios) ? item.vistoMesaUsuarios : [];
  const legacy =
    item?.vistoMesa === true && (item.vistoMesaEmail || item.vistoMesaPor)
      ? [
          {
            uid: item.vistoMesaUserId || item.vistoMesaEmail || item.vistoMesaPor,
            email: item.vistoMesaEmail || item.vistoMesaPor,
            name: item.vistoMesaPor || item.vistoMesaEmail,
            photoUrl: '',
            firstViewedAt: item.vistoMesaAt,
            lastViewedAt: item.vistoMesaAt,
          },
        ]
      : [];
  const merged = [...legacy, ...source];
  const byKey = new Map();

  for (const viewer of merged) {
    const normalized = {
      uid: viewer?.uid || viewer?.email || viewer?.name || '',
      email: viewer?.email || viewer?.name || '',
      name: viewer?.name || viewer?.email || 'Usuario no identificado',
      photoUrl: viewer?.photoUrl || viewer?.photoURL || '',
      firstViewedAt: viewer?.firstViewedAt || viewer?.at || '',
      lastViewedAt: viewer?.lastViewedAt || viewer?.at || '',
    };
    const key = viewerKey(normalized);
    if (!key) continue;
    byKey.set(key, { ...byKey.get(key), ...normalized });
  }

  return Array.from(byKey.values());
}

function hasCurrentViewer(item) {
  const current = currentViewerProfile();
  const currentKeys = new Set([viewerKey(current), (current.email || '').toLowerCase()]);
  return normalizedViewers(item).some((viewer) => currentKeys.has(viewerKey(viewer)));
}

function upsertLocalViewer(item, viewer) {
  const viewers = normalizedViewers(item);
  const key = viewerKey(viewer);
  const index = viewers.findIndex((entry) => viewerKey(entry) === key);
  const now = new Date().toISOString();
  const nextViewer = {
    uid: viewer.uid,
    email: viewer.email,
    name: viewer.name,
    photoUrl: viewer.photoUrl,
    firstViewedAt: index >= 0 ? viewers[index].firstViewedAt || now : now,
    lastViewedAt: now,
  };

  if (index >= 0) {
    viewers[index] = { ...viewers[index], ...nextViewer };
  } else {
    viewers.push(nextViewer);
  }

  item.vistoMesa = true;
  item.vistoMesaAt = item.vistoMesaAt || now;
  item.vistoMesaPor = item.vistoMesaPor || viewer.name;
  item.vistoMesaEmail = item.vistoMesaEmail || viewer.email;
  item.vistoMesaUsuarios = viewers;
  item.vistoMesaCantidad = viewers.length;
}

function markSolicitudViewedLocally(item) {
  upsertLocalViewer(item, currentViewerProfile());
}

async function markSolicitudViewed(id) {
  if (!id || viewInProgressIds.has(id)) return;
  viewInProgressIds.add(id);
  const viewer = currentViewerProfile();

  try {
    const data = await callAdminFunction('adminMarkObraSocialSolicitudViewed', {
      solicitudId: id,
      actor: viewer.name || viewer.email,
      displayName: viewer.name,
      photoUrl: viewer.photoUrl,
    });
    const item = solicitudes.find((entry) => entry.id === id);
    if (item) {
      item.vistoMesa = true;
      item.vistoMesaUsuarios = Array.isArray(data.viewedUsers)
        ? data.viewedUsers
        : item.vistoMesaUsuarios;
      item.vistoMesaCantidad = data.viewedCount || normalizedViewers(item).length;
      item.vistoMesaPor = data.viewedBy || item.vistoMesaPor || viewer.name;
      item.vistoMesaEmail = data.viewedByEmail || item.vistoMesaEmail || viewer.email;
    }
  } catch (error) {
    setFeedback(
      id,
      'save',
      'error',
      firestoreErrorMessage(error, 'No se pudo marcar la solicitud como vista.'),
    );
  } finally {
    viewInProgressIds.delete(id);
    render({ preserveDetail: true });
  }
}

function patientName(item) {
  return item?.pacienteNombre || item?.doctorDestino || '-';
}

function doctorName(item) {
  return item?.socio?.nombre || 'Socio sin nombre';
}

function viewedCountLabel(item) {
  const count = normalizedViewers(item).length;
  return count === 1 ? '1 vista' : `${count} vistas`;
}

function viewedLabel(item) {
  const viewers = normalizedViewers(item);
  if (!viewers.length) return 'Sin abrir';
  return viewers
    .map((viewer) => `${viewer.name || viewer.email}${viewer.email && viewer.email !== viewer.name ? ` · ${viewer.email}` : ''}`)
    .join('\n');
}

function renderViewSummary(item) {
  const viewers = normalizedViewers(item);
  const count = viewers.length;
  const visibleViewers = viewers.slice(0, 6);
  const hiddenCount = Math.max(0, count - visibleViewers.length);
  const avatars = visibleViewers
    .map((viewer) => renderViewerAvatar(viewer))
    .join('');

  return `
    <div class="view-summary" title="${escapeHtml(viewedLabel(item))}" aria-label="${escapeHtml(viewedCountLabel(item))}">
      ${icon('eye')}
      <strong>${count}</strong>
      <div class="viewer-stack">
        ${avatars}
        ${hiddenCount > 0 ? `<span class="viewer-avatar viewer-avatar-extra" title="${hiddenCount} usuarios m&aacute;s">+${hiddenCount}</span>` : ''}
      </div>
    </div>
  `;
}

function renderViewerAvatar(viewer) {
  const label = viewer.name || viewer.email || 'Usuario no identificado';
  const title = viewer.email && viewer.email !== label ? `${label} · ${viewer.email}` : label;
  const photoUrl = viewer.photoUrl || '';
  if (photoUrl) {
    return `
      <span class="viewer-avatar" title="${escapeHtml(title)}">
        <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(label)}" referrerpolicy="no-referrer" />
      </span>
    `;
  }
  return `<span class="viewer-avatar viewer-avatar-initials" title="${escapeHtml(title)}">${escapeHtml(initials(label))}</span>`;
}

function initials(value) {
  const parts = (value || '')
    .toString()
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

function selectedFileDeleteIndexes(id) {
  return selectedFileDeleteIndexesById.get(id) || new Set();
}

function setFileSelectedForDelete(id, originalIndex, selected) {
  if (!Number.isInteger(originalIndex)) return;
  const current = new Set(selectedFileDeleteIndexes(id));
  if (selected) {
    current.add(originalIndex);
  } else {
    current.delete(originalIndex);
  }
  if (current.size) {
    selectedFileDeleteIndexesById.set(id, current);
  } else {
    selectedFileDeleteIndexesById.delete(id);
  }
}

function clearFileDeleteSelection(id) {
  selectedFileDeleteIndexesById.delete(id);
}

function updateRemoveSelectedFilesButton(id) {
  const button = detailPanel.querySelector('#removeSelectedFilesButton');
  const countNode = detailPanel.querySelector('#selectedFilesCount');
  if (!button || !countNode) return;
  const count = selectedFileDeleteIndexes(id).size;
  countNode.textContent = count === 1 ? '1 archivo seleccionado' : `${count} archivos seleccionados`;
  button.disabled = count === 0 || fileDeleteInProgressIds.has(id);
}

function renderRemoveSelectedFilesControl(item, files) {
  const removableCount = files.filter((file) => file.canRemove).length;
  if (!removableCount) return '';
  const count = selectedFileDeleteIndexes(item.id).size;
  const busy = fileDeleteInProgressIds.has(item.id);
  if (count === 0 && !busy) return '';
  return `
    <div class="bulk-file-delete-box">
      <span id="selectedFilesCount">${count === 1 ? '1 archivo seleccionado' : `${count} archivos seleccionados`}</span>
      <button id="removeSelectedFilesButton" class="btn btn-danger btn-sm" type="button" ${busy ? 'disabled' : ''}>
        ${icon('trash')}${busy ? 'Quitando…' : 'Quitar'}
      </button>
    </div>
  `;
}

function renderFileButtons(files, options = {}) {
  const offset = options.offset || 0;
  const solicitudId = options.solicitudId || selectedId || '';
  const selectedForDelete = selectedFileDeleteIndexes(solicitudId);
  const emptyText = options.emptyText || 'Todavía no hay archivos cargados.';
  if (!files.length) {
    return `<p class="hint">${emptyText}</p>`;
  }

  const rows = files
    .map((file, index) => {
      const globalIndex = offset + index;
      const name = file.name || `Archivo ${globalIndex + 1}`;
      const checked = selectedForDelete.has(file.originalIndex) ? 'checked' : '';
      const deleteCheck = file.canRemove
        ? `<label class="file-delete-check" title="Seleccionar para quitar"><input class="file-delete-checkbox" type="checkbox" data-original-index="${file.originalIndex}" aria-label="Seleccionar ${escapeHtml(name)} para quitar" ${checked} /></label>`
        : '';
      const removeButton = file.canRemove
        ? `<button class="icon-button icon-button-sm icon-button-danger remove-file-button" data-original-index="${file.originalIndex}" type="button" title="Quitar archivo" aria-label="Quitar ${escapeHtml(name)}">${icon('x')}</button>`
        : '';
      const isImage = ['jpg', 'jpeg', 'png'].includes((file.extension || '').toLowerCase());
      const iconClass = file.isMerged ? 'file-icon-merged' : isImage ? 'file-icon-image' : '';
      return `
        <div class="file-row">
          ${deleteCheck}
          <button class="file-button ${globalIndex === selectedFileIndex ? 'is-selected' : ''}" data-index="${globalIndex}" type="button" title="Ver ${escapeHtml(name)}">
            <span class="file-icon ${iconClass}">${icon(file.isMerged ? 'layers' : isImage ? 'image' : 'file')}</span>
            <span class="file-text">
              <strong>${escapeHtml(name)}</strong>
              <small>${file.isMerged ? 'Unificado · ' : ''}${escapeHtml((file.extension || '').toUpperCase())} · ${formatBytes(file.sizeBytes)}</small>
            </span>
          </button>
          ${removeButton}
        </div>
      `;
    })
    .join('');
  return `<div class="file-list">${rows}</div>`;
}

function bindFilePickers(root) {
  root.querySelectorAll('.dropzone').forEach((zone) => {
    const input = zone.querySelector('input[type="file"]');
    const label = zone.querySelector('.dropzone-text strong');
    if (!input || !label) return;
    const emptyLabel = label.textContent;
    const sync = () => {
      const file = input.files?.[0];
      label.textContent = file ? file.name : emptyLabel;
      zone.classList.toggle('has-file', Boolean(file));
    };
    input.addEventListener('change', sync);
    zone.addEventListener('dragover', (event) => {
      if (input.disabled) return;
      event.preventDefault();
      zone.classList.add('is-dragging');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
    zone.addEventListener('drop', (event) => {
      zone.classList.remove('is-dragging');
      if (input.disabled || !event.dataTransfer?.files?.length) return;
      event.preventDefault();
      const transfer = new DataTransfer();
      transfer.items.add(event.dataTransfer.files[0]);
      input.files = transfer.files;
      sync();
    });
  });
}

function renderDropzone({ id, title, disabled = '' }) {
  return `
    <label class="dropzone" for="${id}">
      ${icon('upload')}
      <span class="dropzone-text">
        <strong>${title}</strong>
        <small>PDF, JPG o PNG · hasta 20 MB</small>
      </span>
      <input id="${id}" type="file" accept="application/pdf,image/jpeg,image/png" ${disabled} />
    </label>
  `;
}

function renderCorrectedFilesSection(files, offset) {
  if (!files.length) return '';
  return `
    <div class="file-section file-section-corrected">
      <p class="file-section-title">Corregidos por el médico</p>
      ${renderFileButtons(files, { offset, emptyText: 'Todavía no hay archivos corregidos.' })}
    </div>
  `;
}

function renderAppendFileControl(item) {
  return `
    <section class="card">
      <div class="card-head">
        <h3>${icon('upload')}Agregar archivo</h3>
      </div>
      <div class="card-body">
        ${renderDropzone({ id: 'appendFileInput', title: 'Elegí o arrastrá un archivo', disabled: uploadButtonDisabled(item) })}
        <button id="appendFileButton" class="btn btn-secondary" type="button" ${uploadButtonDisabled(item)}>
          ${icon('plus')}${uploadButtonLabel(item)}
        </button>
        ${feedbackHtml(item.id, 'upload')}
      </div>
    </section>
  `;
}

function canEditPdfPages(item, file) {
  return Boolean(
    file &&
      !item?.archivosEliminados &&
      !file.isMerged &&
      Number.isInteger(file.originalIndex) &&
      (file.extension || '').toLowerCase() === 'pdf',
  );
}

function pdfPageEditKey(id, file) {
  return `${id}::${file?.originalIndex ?? 'none'}::${file?.storagePath || file?.downloadUrl || ''}`;
}

function pdfPageEditButtonDisabled(item, file) {
  if (!canEditPdfPages(item, file)) return 'disabled';
  if (pdfPageEditInProgressIds.has(pdfPageEditKey(item.id, file))) return 'disabled';
  return '';
}

function ensurePdfPageCount(item, file) {
  if (!canEditPdfPages(item, file)) return;
  const key = pdfPageEditKey(item.id, file);
  if (pdfPageCountFailedIds.has(key)) return;
  const known = Number(file.pageCount || pdfPageCountCache.get(key) || 0);
  if (Number.isInteger(known) && known > 0) {
    pdfPageCountCache.set(key, known);
    return;
  }
  if (pdfPageCountInFlight.has(key)) return;

  pdfPageCountInFlight.add(key);
  callAdminFunction('adminGetObraSocialSolicitudPdfPageCount', {
    solicitudId: item.id,
    originalIndex: file.originalIndex,
  })
    .then((data) => {
      const pageCount = Number(data.pageCount || 0);
      if (Number.isInteger(pageCount) && pageCount > 0) {
        pdfPageCountCache.set(key, pageCount);
        const current = solicitudes.find((entry) => entry.id === item.id);
        if (current?.archivos?.[file.originalIndex]) {
          current.archivos[file.originalIndex].pageCount = pageCount;
        }
      }
    })
    .catch((error) => {
      pdfPageCountFailedIds.add(key);
      setFeedback(
        item.id,
        'pdfPage',
        'error',
        firestoreErrorMessage(error, 'No se pudo leer la cantidad de páginas del PDF.'),
      );
    })
    .finally(() => {
      pdfPageCountInFlight.delete(key);
      const current = solicitudes.find((entry) => entry.id === item.id);
      if (current && selectedId === item.id) renderDetail(current);
    });
}

function renderPdfPageNumberField({ id, label, pageCount, disabled, defaultValue = 1 }) {
  const normalizedDefault = Number(defaultValue);
  const selectedValue =
    Number.isInteger(normalizedDefault) && normalizedDefault >= 1 && normalizedDefault <= pageCount
      ? normalizedDefault
      : 1;

  if (pageCount <= 10) {
    const options = Array.from({ length: pageCount }, (_, index) => {
      const page = index + 1;
      const selected = page === selectedValue ? 'selected' : '';
      return `<option value="${page}" ${selected}>Página ${page}</option>`;
    }).join('');
    return `
      <label class="field" for="${id}">
        <span>${label}</span>
        <select id="${id}" ${disabled}>
          ${options}
        </select>
      </label>
    `;
  }

  return `
    <label class="field" for="${id}">
      <span>${label}</span>
      <input
        id="${id}"
        type="number"
        min="1"
        max="${pageCount}"
        step="1"
        inputmode="numeric"
        value="${selectedValue}"
        placeholder="1 a ${pageCount}"
        ${disabled}
      />
    </label>
  `;
}

function renderRemovePagePicker(item, file, disabled, busy) {
  const key = pdfPageEditKey(item.id, file);
  const failed = pdfPageCountFailedIds.has(key);
  const pageCount = Number(file.pageCount || pdfPageCountCache.get(key) || 0);
  const loading = pdfPageCountInFlight.has(key) && !pageCount;
  const removeDisabled =
    disabled || loading || !Number.isInteger(pageCount) || pageCount <= 1
      ? 'disabled'
      : '';

  if (failed || loading || !pageCount) {
    return `
      <div class="pdf-page-actions">
        <label class="field">
          <span>Quitar página</span>
          <input
            type="text"
            value="${failed ? 'No se pudo leer' : loading ? 'Cargando páginas…' : 'Leyendo PDF…'}"
            disabled
          />
        </label>

      </div>
    `;
  }

  if (pageCount <= 1) {
    return `
      <div class="pdf-page-actions">
        <label class="field">
          <span>Quitar página</span>
          <input type="text" value="PDF de 1 página" disabled />
        </label>

      </div>
    `;
  }

  return `
    <div class="pdf-page-actions">
      ${renderPdfPageNumberField({
        id: 'removePdfPageInput',
        label: 'Quitar página',
        pageCount,
        disabled: removeDisabled,
      })}
      <button id="removePdfPageButton" class="btn btn-danger-soft btn-sm" type="button" ${removeDisabled}>
        ${icon('scissors')}${busy ? 'Editando…' : 'Quitar'}
      </button>
    </div>
  `;
}

function renderMovePagePicker(item, file, disabled, busy) {
  const key = pdfPageEditKey(item.id, file);
  const failed = pdfPageCountFailedIds.has(key);
  const pageCount = Number(file.pageCount || pdfPageCountCache.get(key) || 0);
  const loading = pdfPageCountInFlight.has(key) && !pageCount;
  const moveDisabled =
    disabled || failed || loading || !Number.isInteger(pageCount) || pageCount <= 1
      ? 'disabled'
      : '';

  if (failed || loading || !pageCount || pageCount <= 1) {
    return '';
  }

  return `
    <div class="pdf-page-actions pdf-page-actions-move">
      ${renderPdfPageNumberField({
        id: 'movePdfPageFromInput',
        label: 'Mover página',
        pageCount,
        disabled: moveDisabled,
      })}
      ${renderPdfPageNumberField({
        id: 'movePdfPageToInput',
        label: 'A posición',
        pageCount,
        disabled: moveDisabled,
        defaultValue: Math.min(2, pageCount),
      })}
      <button id="movePdfPageButton" class="btn btn-secondary btn-sm" type="button" ${moveDisabled}>
        ${icon('move')}${busy ? 'Editando…' : 'Mover'}
      </button>
    </div>
  `;
}

function renderPdfPageControl(item, file) {
  if (!canEditPdfPages(item, file)) {
    return '';
  }
  ensurePdfPageCount(item, file);
  const disabled = pdfPageEditButtonDisabled(item, file);
  const busy = pdfPageEditInProgressIds.has(pdfPageEditKey(item.id, file));
  return `
    <section class="card">
      <div class="card-head">
        <h3>${icon('pencil')}Editar páginas del PDF</h3>
      </div>
      <div class="card-body pdf-page-tools">
        <p class="hint">Sobre: <strong>${escapeHtml(file.name || 'PDF seleccionado')}</strong></p>
        ${renderRemovePagePicker(item, file, disabled, busy)}
        ${renderMovePagePicker(item, file, disabled, busy)}
        <div class="tool-divider"></div>
        <div class="pdf-page-actions">
          ${renderDropzone({ id: 'appendPdfPageInput', title: 'Agregar página al final', disabled })}
          <button id="appendPdfPageButton" class="btn btn-secondary btn-sm" type="button" ${disabled}>
            ${icon('plus')}${busy ? 'Editando…' : 'Agregar'}
          </button>
        </div>
        <p class="hint">La edición crea una nueva versión del PDF original. Después regenerá el PDF unificado.</p>
        ${feedbackHtml(item.id, 'pdfPage')}
      </div>
    </section>
  `;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      resolve(result.toString().split(',').pop() || '');
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function renderViewer(file) {
  if (!file?.downloadUrl) {
    return `<div class="placeholder">${icon('file')}<p>No hay archivo para previsualizar.</p></div>`;
  }

  const url = escapeHtml(file.downloadUrl);
  const extension = (file.extension || '').toLowerCase();
  if (['jpg', 'jpeg', 'png'].includes(extension)) {
    return `<div class="viewer-content"><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Archivo adjunto" /></a></div>`;
  }

  return `<div class="viewer-content"><iframe title="Vista previa PDF" src="${url}"></iframe></div>`;
}

function renderViewerToolbar(file) {
  const disabled = file?.downloadUrl ? '' : 'disabled';
  return `
    <div class="viewer-toolbar">
      <div class="viewer-title">
        <strong>${escapeHtml(file?.name || 'Archivo')}</strong>
        <span>${escapeHtml((file?.extension || '').toUpperCase())} · ${formatBytes(file?.sizeBytes)}</span>
      </div>
      <div class="viewer-toolbar-actions">
        <button id="openFileButton" class="btn btn-ghost btn-sm" type="button" ${disabled}>
          ${icon('external')}Abrir
        </button>
        <button id="downloadFileButton" class="btn btn-primary btn-sm" type="button" ${disabled}>
          ${icon('download')}Descargar a la PC
        </button>
      </div>
    </div>
  `;
}

async function saveSolicitudMetadata(id) {
  const item = solicitudes.find((entry) => entry.id === id);
  if (!item || metadataSaveInProgressIds.has(id)) return;

  const medicoNombre = detailPanel.querySelector('#metadataMedicoInput')?.value.trim() || '';
  const pacienteNombre = detailPanel.querySelector('#metadataPacienteInput')?.value.trim() || '';
  const fechaPractica = detailPanel.querySelector('#metadataFechaInput')?.value || '';
  const matricula = detailPanel.querySelector('#metadataMatriculaInput')?.value.trim() || '';
  if (!medicoNombre || !pacienteNombre || !fechaPractica) {
    setFeedback(id, 'metadata', 'error', 'Completa medico, paciente y fecha de practica.');
    renderDetail(item);
    return;
  }

  metadataSaveInProgressIds.add(id);
  setFeedback(id, 'metadata', 'info', 'Guardando datos...');
  renderDetail(item);

  try {
    const result = await callAdminFunction('adminUpdateObraSocialSolicitudMetadata', {
      solicitudId: id,
      fields: {
        medicoNombre,
        pacienteNombre,
        fechaPractica,
        matricula,
      },
      actor: currentUser?.email || 'mesa de ayuda prestacional',
    });
    const index = solicitudes.findIndex((entry) => entry.id === id);
    if (index >= 0 && result.item) {
      solicitudes[index] = result.item;
    }
    metadataEditIds.delete(id);
    setFeedback(id, 'metadata', 'success', 'Datos actualizados.');
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(id, 'metadata', 'error', firestoreErrorMessage(error, 'No se pudieron actualizar los datos.'));
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  } finally {
    metadataSaveInProgressIds.delete(id);
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

async function markSolicitudCompleted(id) {
  const item = solicitudes.find((entry) => entry.id === id);
  if (!item) return;
  if (isCompletedSolicitud(item)) {
    setFeedback(id, 'complete', 'success', 'Esta documentacion ya esta completada.');
    renderDetail(item);
    return;
  }

  const title = doctorName(item) || patientName(item) || shortId(id);
  const confirmed = await confirmDialog(
    `Vas a marcar "${title}" como completada. Quedará al final de la bandeja para priorizar lo pendiente.`,
    { title: 'Marcar como completada', confirmLabel: 'Marcar completada' },
  );
  if (!confirmed) return;

  setFeedback(id, 'complete', 'info', 'Marcando documentacion como completada...');
  renderDetail(item);

  try {
    const result = await callAdminFunction('adminMarkObraSocialSolicitudReviewed', {
      solicitudId: id,
      actor: currentUser?.email || 'mesa de ayuda prestacional',
    });
    Object.assign(item, {
      estado: 'completada',
      revisionPrestacional: {
        ...(item.revisionPrestacional || {}),
        revisada: true,
        revisadaAt: result.reviewedAt || new Date().toISOString(),
        revisadaPor: result.reviewedBy || currentUser?.email || 'mesa de ayuda prestacional',
        revisadaEmail: result.reviewedByEmail || currentUser?.email || '',
      },
    });
    setFeedback(id, 'complete', 'success', 'Documentacion completada. La solicitud quedo al final de la bandeja.');
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(id, 'complete', 'error', firestoreErrorMessage(error, 'No se pudo marcar como completada.'));
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

async function sendDoctorObservation(id) {
  const item = solicitudes.find((entry) => entry.id === id);
  const textarea = detailPanel.querySelector('#doctorNoticeInput');
  const button = detailPanel.querySelector('#doctorNoticeButton');
  const reason = textarea.value.trim();
  if (!reason) {
    textarea.focus();
    textarea.classList.add('has-error');
    setFeedback(id, 'doctor', 'error', 'Escribí el motivo antes de enviar el aviso.');
    if (item) renderDetail(item);
    return;
  }

  const title = doctorName(item) || patientName(item) || shortId(id);
  const confirmed = await confirmDialog(
    `Vas a marcar la solicitud de "${title}" como observada y enviar este motivo al médico:\n\n"${reason}"`,
    { title: '¿Notificar al médico?', confirmLabel: 'Enviar aviso' },
  );
  if (!confirmed) return;

  textarea.classList.remove('has-error');
  const actor = currentUser?.email || 'mesa de ayuda prestacional';

  button.disabled = true;
  button.textContent = 'Enviando aviso...';
  try {
    await callAdminFunction('adminObserveObraSocialSolicitud', {
      solicitudId: id,
      motivo: reason,
      actor,
    });
    
    setFeedback(
      id,
      'doctor',
      'success',
      'Médico notificado. La observación quedó visible en la app.',
    );
  } catch (error) {
    setFeedback(id, 'doctor', 'error', firestoreErrorMessage(error, 'No se pudo enviar el aviso al médico.'));
  } finally {
    button.disabled = false;
    button.textContent = 'Notificar archivo incorrecto';
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

async function mergeFiles(id) {
  const button = detailPanel.querySelector('#mergeFilesButton');
  const item = solicitudes.find((entry) => entry.id === id);
  const archivos = Array.isArray(item?.archivos) ? item.archivos : [];

  if (!archivos.length) {
    setFeedback(id, 'merge', 'error', 'Esta solicitud no tiene archivos originales para unificar.');
    if (item) renderDetail(item);
    return;
  }

  button.disabled = true;
  button.textContent = 'Unificando PDF...';
  mergeInProgressIds.add(id);
  setFeedback(id, 'merge', 'info', 'Procesando archivos. Puede tardar unos segundos si hay PDFs pesados.');
  if (item) renderDetail(item);

  try {
    await callAdminFunction('mergeObraSocialSolicitudFiles', {
      solicitudId: id,
      actor: currentUser?.email || 'mesa de ayuda prestacional',
    });
    

    setFeedback(
      id,
      'merge',
      'success',
      'PDF unificado generado correctamente. Ya aparece como primer archivo para abrir o descargar.',
    );
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(
      id,
      'merge',
      'error',
      error.message || 'No se pudo unificar la documentación.',
    );
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  } finally {
    mergeInProgressIds.delete(id);
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

async function appendFileToSolicitud(id) {
  if (uploadInProgressIds.has(id)) return;

  const input = detailPanel.querySelector('#appendFileInput');
  const button = detailPanel.querySelector('#appendFileButton');
  const file = input?.files?.[0];
  const item = solicitudes.find((entry) => entry.id === id);

  if (!file) {
    setFeedback(id, 'upload', 'error', 'Seleccioná un PDF o una imagen antes de agregar.');
    if (item) renderDetail(item);
    return;
  }

  const extension = fileExtension(file.name);
  const contentType = supportedUploadTypes.has(file.type)
    ? file.type
    : mimeFromExtension(extension);
  if (
    !supportedUploadExtensions.has(extension) ||
    !supportedUploadTypes.has(contentType)
  ) {
    setFeedback(id, 'upload', 'error', 'Solo se permiten archivos PDF, JPG o PNG.');
    if (item) renderDetail(item);
    return;
  }

  if (file.size > maxUploadBytes) {
    setFeedback(id, 'upload', 'error', 'El archivo no puede superar los 20 MB.');
    if (item) renderDetail(item);
    return;
  }

  const currentFiles = Array.isArray(item?.archivos) ? item.archivos : [];
  const actor = currentUser?.email || 'mesa de ayuda prestacional';
  const order = currentFiles.length + 1;
  const filename = safeFilename(file.name || `archivo-${order}.${extension}`);

  uploadInProgressIds.add(id);
  button.disabled = true;
  button.textContent = 'Subiendo archivo...';
  setFeedback(id, 'upload', 'info', 'Subiendo documentación a Firebase Storage.');
  if (item) renderDetail(item);

  try {
    const upload = await callAdminFunction('adminCreateObraSocialAppendUpload', {
      solicitudId: id,
      archivo: {
        name: filename,
        extension,
        contentType,
        sizeBytes: file.size,
      },
    });
    const uploadResponse = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error('No se pudo subir el archivo a Storage.');
    }
    await callAdminFunction('adminFinalizeObraSocialAppendUpload', {
      solicitudId: id,
      uploadId: upload.uploadId,
      actor,
    });
    
    selectedFileIndex = order - 1;
    setFeedback(
      id,
      'upload',
      'success',
      'Archivo agregado. Regenerá el PDF unificado para incluirlo en la versión final.',
    );
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(
      id,
      'upload',
      'error',
      firestoreErrorMessage(error, 'No se pudo agregar el archivo a la solicitud.'),
    );
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  } finally {
    uploadInProgressIds.delete(id);
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

async function removePageFromSelectedPdf(id, selectedFile) {
  const item = solicitudes.find((entry) => entry.id === id);
  if (!canEditPdfPages(item, selectedFile)) {
    setFeedback(id, 'pdfPage', 'error', 'Seleccioná un PDF original para editar sus páginas.');
    if (item) renderDetail(item);
    return;
  }

  const key = pdfPageEditKey(id, selectedFile);
  const pageCount = Number(selectedFile.pageCount || pdfPageCountCache.get(key) || 0);
  const input =
    detailPanel.querySelector('#removePdfPageSelect') ||
    detailPanel.querySelector('#removePdfPageInput');
  const pageNumber = Number(input?.value);
  if (!Number.isInteger(pageCount) || pageCount <= 0) {
    setFeedback(id, 'pdfPage', 'error', 'Esperá a que se lea la cantidad de páginas del PDF.');
    if (item) renderDetail(item);
    return;
  }
  if (pageCount <= 1) {
    setFeedback(id, 'pdfPage', 'error', 'No se puede quitar la única página del PDF.');
    if (item) renderDetail(item);
    return;
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
    setFeedback(id, 'pdfPage', 'error', `Elegí una página entre 1 y ${pageCount}.`);
    if (item) renderDetail(item);
    return;
  }

  const filename = selectedFile.name || selectedFile.originalName || 'PDF seleccionado';
  const confirmed = await confirmDialog(
    `¿Querés quitar la página ${pageNumber} de "${filename}"? Esta acción crea una nueva versión del PDF.`,
    { title: 'Quitar página', confirmLabel: 'Quitar página', danger: true },
  );
  if (!confirmed) return;

  pdfPageEditInProgressIds.add(key);
  setFeedback(id, 'pdfPage', 'info', 'Editando PDF. Puede tardar unos segundos.');
  if (item) renderDetail(item);

  try {
    await callAdminFunction('adminEditObraSocialSolicitudPdfPages', {
      solicitudId: id,
      originalIndex: selectedFile.originalIndex,
      action: 'remove_page',
      pageNumber,
      actor: currentUser?.email || 'mesa de ayuda prestacional',
    });
    pdfPageCountCache.delete(key);
    pdfPageCountFailedIds.delete(key);
    setFeedback(id, 'pdfPage', 'success', 'Página eliminada. Regenerá el PDF unificado para reflejar el cambio.');
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(id, 'pdfPage', 'error', firestoreErrorMessage(error, 'No se pudo quitar la página del PDF.'));
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  } finally {
    pdfPageEditInProgressIds.delete(key);
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

async function movePageInSelectedPdf(id, selectedFile) {
  const item = solicitudes.find((entry) => entry.id === id);
  if (!canEditPdfPages(item, selectedFile)) {
    setFeedback(id, 'pdfPage', 'error', 'Selecciona un PDF original para editar sus paginas.');
    if (item) renderDetail(item);
    return;
  }

  const key = pdfPageEditKey(id, selectedFile);
  const pageCount = Number(selectedFile.pageCount || pdfPageCountCache.get(key) || 0);
  const fromInput = detailPanel.querySelector('#movePdfPageFromInput');
  const toInput = detailPanel.querySelector('#movePdfPageToInput');
  const pageNumber = Number(fromInput?.value);
  const targetPageNumber = Number(toInput?.value);

  if (!Number.isInteger(pageCount) || pageCount <= 0) {
    setFeedback(id, 'pdfPage', 'error', 'Espera a que se lea la cantidad de paginas del PDF.');
    if (item) renderDetail(item);
    return;
  }
  if (pageCount <= 1) {
    setFeedback(id, 'pdfPage', 'error', 'No se puede reordenar un PDF de una sola pagina.');
    if (item) renderDetail(item);
    return;
  }
  if (
    !Number.isInteger(pageNumber) ||
    !Number.isInteger(targetPageNumber) ||
    pageNumber < 1 ||
    targetPageNumber < 1 ||
    pageNumber > pageCount ||
    targetPageNumber > pageCount
  ) {
    setFeedback(id, 'pdfPage', 'error', `Elegi paginas entre 1 y ${pageCount}.`);
    if (item) renderDetail(item);
    return;
  }
  if (pageNumber === targetPageNumber) {
    setFeedback(id, 'pdfPage', 'error', 'Elegi una posicion distinta para mover la pagina.');
    if (item) renderDetail(item);
    return;
  }

  const filename = selectedFile.name || selectedFile.originalName || 'PDF seleccionado';
  const confirmed = await confirmDialog(
    `¿Querés mover la página ${pageNumber} a la posición ${targetPageNumber} en "${filename}"? Esta acción crea una nueva versión del PDF.`,
    { title: 'Mover página', confirmLabel: 'Mover página' },
  );
  if (!confirmed) return;

  pdfPageEditInProgressIds.add(key);
  setFeedback(id, 'pdfPage', 'info', 'Reordenando PDF. Puede tardar unos segundos.');
  if (item) renderDetail(item);

  try {
    await callAdminFunction('adminEditObraSocialSolicitudPdfPages', {
      solicitudId: id,
      originalIndex: selectedFile.originalIndex,
      action: 'move_page',
      pageNumber,
      targetPageNumber,
      actor: currentUser?.email || 'mesa de ayuda prestacional',
    });
    pdfPageCountCache.delete(key);
    pdfPageCountFailedIds.delete(key);
    setFeedback(id, 'pdfPage', 'success', 'Pagina movida. Regenera el PDF unificado para reflejar el cambio.');
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(id, 'pdfPage', 'error', firestoreErrorMessage(error, 'No se pudo mover la pagina del PDF.'));
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  } finally {
    pdfPageEditInProgressIds.delete(key);
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}
async function appendPageToSelectedPdf(id, selectedFile) {
  const item = solicitudes.find((entry) => entry.id === id);
  if (!canEditPdfPages(item, selectedFile)) {
    setFeedback(id, 'pdfPage', 'error', 'Selecciona un PDF original para editar sus paginas.');
    if (item) renderDetail(item);
    return;
  }

  const input = detailPanel.querySelector('#appendPdfPageInput');
  const file = input?.files?.[0];
  if (!file) {
    setFeedback(id, 'pdfPage', 'error', 'Selecciona un PDF o imagen para agregar.');
    if (item) renderDetail(item);
    return;
  }

  const extension = fileExtension(file.name);
  const contentType = supportedUploadTypes.has(file.type)
    ? file.type
    : mimeFromExtension(extension);
  if (!supportedUploadExtensions.has(extension) || !supportedUploadTypes.has(contentType)) {
    setFeedback(id, 'pdfPage', 'error', 'Solo se permiten archivos PDF, JPG o PNG.');
    if (item) renderDetail(item);
    return;
  }
  if (file.size > maxUploadBytes) {
    setFeedback(id, 'pdfPage', 'error', 'El archivo no puede superar los 20 MB.');
    if (item) renderDetail(item);
    return;
  }

  const key = pdfPageEditKey(id, selectedFile);
  pdfPageEditInProgressIds.add(key);
  setFeedback(id, 'pdfPage', 'info', 'Leyendo archivo y editando PDF. Puede tardar unos segundos.');
  if (item) renderDetail(item);

  try {
    const filename = safeFilename(file.name || `pagina.${extension}`);
    const fileBase64 = await fileToBase64(file);
    const result = await callAdminFunction('adminEditObraSocialSolicitudPdfPages', {
      solicitudId: id,
      originalIndex: selectedFile.originalIndex,
      action: 'append_page_direct',
      archivo: {
        name: filename,
        extension,
        contentType,
        sizeBytes: file.size,
      },
      fileBase64,
      actor: currentUser?.email || 'mesa de ayuda prestacional',
    });
    pdfPageCountCache.delete(key);
    pdfPageCountFailedIds.delete(key);
    const pages = Number(result.addedPages || 1);
    setFeedback(
      id,
      'pdfPage',
      'success',
      pages === 1
        ? 'Pagina agregada. Regenera el PDF unificado para reflejar el cambio.'
        : `${pages} paginas agregadas. Regenera el PDF unificado para reflejar el cambio.`,
    );
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(id, 'pdfPage', 'error', firestoreErrorMessage(error, 'No se pudo agregar la pagina al PDF.'));
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  } finally {
    pdfPageEditInProgressIds.delete(key);
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}
async function removeUploadedFileFromSolicitud(id, originalIndex) {
  const item = solicitudes.find((entry) => entry.id === id);
  const currentFiles = Array.isArray(item?.archivos) ? item.archivos : [];
  const file = currentFiles[originalIndex];

  if (!file) {
    setFeedback(id, 'upload', 'error', 'No se encontró el archivo para quitar.');
    if (item) renderDetail(item);
    return;
  }

  const filename = file.name || file.originalName || 'archivo adjunto';
  const confirmed = await confirmDialog(
    `¿Querés quitar "${filename}" de esta solicitud? El archivo no se incluirá en el PDF unificado.`,
    { title: 'Quitar archivo', confirmLabel: 'Quitar archivo', danger: true },
  );
  if (!confirmed) return;

  const actor = currentUser?.email || 'mesa de ayuda prestacional';

  try {
    await callAdminFunction('adminRemoveObraSocialSolicitudFile', {
      solicitudId: id,
      originalIndex,
      actor,
    });
    
    selectedFileIndex = 0;
    setFeedback(
      id,
      'upload',
      'success',
      'Archivo quitado. Regenerá el PDF unificado para dejar la versión final actualizada.',
    );
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(
      id,
      'upload',
      'error',
      firestoreErrorMessage(error, 'No se pudo quitar el archivo adjunto.'),
    );
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

async function deleteMessageFromInbox(id) {
  const item = solicitudes.find((entry) => entry.id === id);
  const title = doctorName(item) || patientName(item) || shortId(id);
  const singleWarning = canDeleteWithSingleWarning(item);
  const confirmed = await confirmDialog(
    singleWarning
      ? `Vas a eliminar "${title}" de la bandeja. El mensaje ya no tiene prioridad.`
      : `¿Seguro que querés eliminar "${title}" de la bandeja de prestacional?`,
    { title: 'Eliminar de la bandeja', confirmLabel: 'Eliminar', danger: true },
  );
  if (!confirmed) return;

  if (!singleWarning) {
    const finalConfirmation = await confirmDialog(
      'Esta solicitud todavía tiene prioridad. El historial se conserva en Firebase. ¿Eliminar igual?',
      { title: 'Confirmación final', confirmLabel: 'Eliminar igual', danger: true },
    );
    if (!finalConfirmation) return;
  }

  const button = detailPanel.querySelector('#deleteMessageButton');
  button.disabled = true;
  button.textContent = 'Eliminando...';
  const actor = currentUser?.email || 'mesa de ayuda prestacional';

  try {
    await callAdminFunction('adminHideObraSocialSolicitud', {
      solicitudId: id,
      actor,
    });
    
    selectedId = null;
    setFeedback(id, 'delete', 'success', 'Mensaje eliminado de la bandeja.');
    await refreshSolicitudes({ silent: true });
  } catch (error) {
    setFeedback(
      id,
      'delete',
      'error',
      firestoreErrorMessage(error, 'No se pudo eliminar el mensaje.'),
    );
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  } finally {
    button.disabled = false;
    button.textContent = 'Eliminar de la bandeja';
  }
}
async function removeSelectedFilesFromSolicitud(id) {
  const item = solicitudes.find((entry) => entry.id === id);
  const selected = Array.from(selectedFileDeleteIndexes(id)).sort((a, b) => b - a);
  if (!item || selected.length === 0 || fileDeleteInProgressIds.has(id)) return;

  const currentFiles = Array.isArray(item.archivos) ? item.archivos : [];
  const names = selected
    .map((index) => currentFiles[index]?.name || currentFiles[index]?.originalName || `archivo ${index + 1}`)
    .filter(Boolean);
  const confirmed = await confirmDialog(
    `Vas a quitar ${selected.length} archivo${selected.length === 1 ? '' : 's'} de esta solicitud:\n\n${names.join('\n')}\n\nEl PDF unificado deberá regenerarse.`,
    { title: 'Quitar archivos', confirmLabel: 'Quitar', danger: true },
  );
  if (!confirmed) return;

  fileDeleteInProgressIds.add(id);
  setFeedback(id, 'upload', 'info', `Quitando ${selected.length} archivo${selected.length === 1 ? '' : 's'}...`);
  if (item) renderDetail(item);

  const actor = currentUser?.email || 'mesa de ayuda prestacional';
  let deleted = 0;
  let failed = 0;

  try {
    for (const originalIndex of selected) {
      try {
        await callAdminFunction('adminRemoveObraSocialSolicitudFile', {
          solicitudId: id,
          originalIndex,
          actor,
        });
        deleted += 1;
      } catch (error) {
        failed += 1;
        console.error('Error removing selected file:', originalIndex, error);
      }
    }
    clearFileDeleteSelection(id);
    selectedFileIndex = 0;
    setFeedback(
      id,
      'upload',
      failed ? 'warning' : 'success',
      failed
        ? `Se quitaron ${deleted} archivo${deleted === 1 ? '' : 's'}. Fallaron ${failed}.`
        : `Se quitaron ${deleted} archivo${deleted === 1 ? '' : 's'}. Regenera el PDF unificado.`,
    );
    await refreshSolicitudes({ silent: true });
  } finally {
    fileDeleteInProgressIds.delete(id);
    const current = solicitudes.find((entry) => entry.id === id);
    if (current) renderDetail(current);
  }
}

function selectedBulkItems() {
  return solicitudes.filter(
    (item) =>
      matchesActiveInboxTab(item) &&
      item.eliminadoMesa !== true &&
      selectedBulkIds.has(item.id),
  );
}

function pruneBulkSelection() {
  const activeIds = new Set(
    solicitudes
      .filter((item) => matchesActiveInboxTab(item) && item.eliminadoMesa !== true)
      .map((item) => item.id),
  );
  for (const id of Array.from(selectedBulkIds)) {
    if (!activeIds.has(id)) selectedBulkIds.delete(id);
  }
}

function setBulkSelected(id, selected) {
  if (selected) {
    selectedBulkIds.add(id);
  } else {
    selectedBulkIds.delete(id);
  }
  bulkFeedback.textContent = '';
  render();
}

function selectVisibleSolicitudes() {
  filteredSolicitudes().forEach((item) => selectedBulkIds.add(item.id));
  bulkFeedback.textContent = '';
  render();
}

function selectExpiredSolicitudes() {
  filteredSolicitudes()
    .filter(isExpiredSolicitud)
    .forEach((item) => selectedBulkIds.add(item.id));
  bulkFeedback.textContent = '';
  render();
}

function clearBulkSelection() {
  selectedBulkIds.clear();
  bulkFeedback.textContent = '';
  render();
}

function isExpiredSolicitud(item) {
  return priorityInfo(item).level === 'vencida';
}

async function deleteSelectedMessages() {
  const items = selectedBulkItems();
  if (items.length === 0 || bulkDeleteInProgress) return;

  const allSingleWarning = items.every(canDeleteWithSingleWarning);
  const countLabel =
    items.length === 1 ? '1 mensaje seleccionado' : `${items.length} mensajes seleccionados`;
  const expiredCount = items.filter(isExpiredSolicitud).length;
  const oldCount = items.filter(isOldInboxSolicitud).length;
  const lowPriorityLabel = `${expiredCount} vencido${expiredCount === 1 ? '' : 's'}, ${oldCount} con mas de 30 dias`;

  const confirmed = await confirmDialog(
    allSingleWarning
      ? `Vas a eliminar ${countLabel} de la bandeja. Ya no tienen prioridad.`
      : `Vas a eliminar ${countLabel} de la bandeja (${lowPriorityLabel}).`,
    { title: 'Eliminar en lote', confirmLabel: 'Eliminar', danger: true },
  );
  if (!confirmed) return;

  if (!allSingleWarning) {
    const finalConfirmation = await confirmDialog(
      'Algunos mensajes todavía tienen prioridad. El historial se conserva en Firebase. ¿Eliminar igual?',
      { title: 'Confirmación final', confirmLabel: 'Eliminar igual', danger: true },
    );
    if (!finalConfirmation) return;
  }

  bulkDeleteInProgress = true;
  bulkFeedback.textContent = `Eliminando ${items.length} mensaje${items.length === 1 ? '' : 's'}...`;
  render();

  const actor = currentUser?.email || 'mesa de ayuda prestacional';
  let deleted = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await callAdminFunction('adminHideObraSocialSolicitud', {
        solicitudId: item.id,
        actor,
      });
      deleted += 1;
      selectedBulkIds.delete(item.id);
      if (selectedId === item.id) {
        selectedId = null;
        selectedFileIndex = 0;
      }
    } catch (error) {
      failed += 1;
      console.error('Error deleting selected message:', item.id, error);
    }
  }

  bulkDeleteInProgress = false;
  bulkFeedback.textContent =
    failed > 0
      ? `Se eliminaron ${deleted}. Fallaron ${failed}.`
      : `Se eliminaron ${deleted} mensaje${deleted === 1 ? '' : 's'}.`;
  await refreshSolicitudes({ silent: true });
}
async function refreshSolicitudes(options = {}) {
  refreshButton.disabled = true;
  try {
    const data = await callAdminFunction('adminListObraSocialSolicitudes');
    const preserveDetail = options.silent && Boolean(selectedId);
    solicitudes = Array.isArray(data.items) ? data.items : [];
    render({ preserveDetail });
    if (!options.silent) showToast('Lista actualizada.');
  } catch (error) {
    if (!options.silent) {
      showToast(
        firestoreErrorMessage(error, 'No se pudo actualizar la lista.'),
        'error',
      );
    }
  } finally {
    refreshButton.disabled = false;
  }
}

async function downloadFile(file) {
  if (!file?.downloadUrl) return;
  const filename = safeFilename(file.name || `solicitud-${selectedId || 'archivo'}.${file.extension || 'pdf'}`);
  try {
    const response = await fetch(file.downloadUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 2500);
    if (selectedId) {
      setFeedback(selectedId, 'save', 'success', `Descarga iniciada: ${filename}`);
      const item = solicitudes.find((entry) => entry.id === selectedId);
      if (item) renderDetail(item);
    }
  } catch (_) {
    triggerDownload(file.downloadUrl, filename);
    if (selectedId) {
      setFeedback(
        selectedId,
        'save',
        'success',
        'Abrí el archivo en otra pestaña. Si el navegador no lo descarga solo, usá Archivo > Guardar.',
      );
      const item = solicitudes.find((entry) => entry.id === selectedId);
      if (item) renderDetail(item);
    }
  }
}

function triggerDownload(url, filename) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function setFeedback(id, key, type, message) {
  const existing = feedbackById.get(id) || {};
  feedbackById.set(id, {
    ...existing,
    [key]: { type, message },
  });
}

const feedbackIcons = {
  info: 'clock',
  success: 'check-circle',
  warning: 'alert',
  error: 'alert',
};

function feedbackBox(type, message) {
  return `
    <div class="feedback-message feedback-${type}" role="status">
      ${icon(feedbackIcons[type] || 'clock')}<span>${escapeHtml(message)}</span>
    </div>
  `;
}

function feedbackHtml(id, key) {
  const feedback = feedbackById.get(id)?.[key];
  if (!feedback) return '';
  return feedbackBox(feedback.type, feedback.message);
}

function notificationStatusHtml(item) {
  const status = item.notificacionMedico?.status;
  if (!status) return '';

  const labels = {
    pending: {
      type: 'info',
      message: 'Notificación pendiente: se está procesando el envío.',
    },
    sent: {
      type: 'success',
      message: 'Médico notificado correctamente.',
    },
    stored: {
      type: 'warning',
      message:
        'Aviso registrado en la app. El médico lo verá al entrar a sus revisiones.',
    },
    error: {
      type: 'error',
      message: item.notificacionMedico?.error || 'No se pudo preparar la notificación.',
    },
  };
  const detail = labels[status] || {
    type: 'info',
    message: `Estado de notificación: ${status}`,
  };
  return feedbackBox(detail.type, detail.message);
}

function mergeButtonLabel(item) {
  if (mergeInProgressIds.has(item.id)) return 'Unificando…';
  const status = item.merge?.status;
  if (status === 'processing') return 'Unificando…';
  if (status === 'done') return 'Regenerar PDF unificado';
  return 'Unificar archivos en PDF';
}

function mergeButtonDisabled(item) {
  if (mergeInProgressIds.has(item.id)) return 'disabled';
  if (item.archivosEliminados) return 'disabled';
  if (item.merge?.status === 'processing') return 'disabled';
  return '';
}

function uploadButtonLabel(item) {
  return uploadInProgressIds.has(item.id)
    ? 'Subiendo archivo…'
    : 'Agregar a la solicitud';
}

function uploadButtonDisabled(item) {
  if (uploadInProgressIds.has(item.id)) return 'disabled';
  if (item.archivosEliminados) return 'disabled';
  return '';
}

function mergeStatusHtml(item) {
  const merge = item.merge || {};
  if (merge.status === 'done') {
    return feedbackBox(
      'success',
      `PDF unificado listo.${merge.sizeBytes ? ` Tamaño: ${formatBytes(merge.sizeBytes)}.` : ''}`,
    );
  }
  if (merge.status === 'processing') {
    return feedbackBox('info', 'El PDF unificado se está generando.');
  }
  if (merge.status === 'error') {
    return feedbackBox('error', merge.error || 'Falló la generación del PDF unificado.');
  }
  if (merge.required) {
    return feedbackBox(
      'warning',
      'Esta solicitud necesita un PDF unificado antes de cargarla al sistema externo.',
    );
  }
  return `<p class="hint">Aunque tenga un solo archivo, podés generar un PDF final para dejar el flujo uniforme.</p>`;
}

function firestoreErrorMessage(error, fallback) {
  if (error?.code === 'permission-denied') {
    return 'No tenes permisos para realizar esta accion en Firebase.';
  }
  if (error?.code === 'storage/unauthorized') {
    return 'No tenes permisos para subir archivos a Firebase Storage.';
  }
  if (error?.code === 'unavailable') {
    return 'No hay conexion con Firebase. Proba de nuevo en unos segundos.';
  }
  if (error?.message) {
    return error.message;
  }
  return fallback;
}
function normalizedFiles(item) {
  return normalizedFilesFromItem(item, { canRemove: true });
}

function normalizedCorrectedFiles(item) {
  const correction = item?.correccionMedico?.solicitudCorregida;
  if (!correction) return [];
  return normalizedFilesFromItem(correction, {
    canRemove: false,
    mergedFallbackName: 'PDF corregido',
  });
}

function normalizedFilesFromItem(item, options = {}) {
  const mergedUrl = item?.merge?.outputUrl || item?.merge?.downloadUrl;
  const mergedPath = item?.merge?.outputPath;
  const originals = (item?.archivos || []).map((file, index) => ({
    ...file,
    originalIndex: index,
    canRemove: options.canRemove === true,
  }));
  if (mergedUrl) {
    return [
      {
        name: item?.merge?.filename || options.mergedFallbackName || 'PDF unificado',
        extension: 'pdf',
        downloadUrl: mergedUrl,
        storagePath: mergedPath,
        sizeBytes: item?.merge?.sizeBytes || 0,
        isMerged: true,
      },
      ...originals,
    ];
  }
  return originals;
}

function renderHistory(history = []) {
  const entries = history
    .slice()
    .reverse()
    .map(
      (entry) => `
        <li>
          <span>${escapeHtml(entry.note || entry.action || '')}</span>
          <span class="history-meta"><strong>${escapeHtml(entry.actor || 'Sistema')}</strong> · ${formatDateTime(entry.at)}</span>
        </li>
      `,
    )
    .join('');
  return `
    <section class="card">
      <div class="card-head">
        <h3>${icon('history')}Historial</h3>
      </div>
      <div class="card-body">
        ${entries ? `<ul class="history-list">${entries}</ul>` : '<p>Sin movimientos registrados.</p>'}
      </div>
    </section>
  `;
}

function dateInputValue(value) {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function metadataEditedBadge(item) {
  const metadata = item?.metadataPrestacional || {};
  if (metadata.editada !== true) return '';
  const author = metadata.editadaPor || metadata.editadaEmail || 'prestacional';
  return `<span class="metadata-edited-badge" title="Modificado por ${escapeHtml(author)}">${icon('check')}Datos modificados</span>`;
}

function renderMetadataPanel(item) {
  const editing = metadataEditIds.has(item.id);
  const saving = metadataSaveInProgressIds.has(item.id);
  const disabled = saving ? 'disabled' : '';
  if (!editing) {
    return `
      <section class="card metadata-card">
        <div class="card-head">
          <h3>${icon('file')}Datos de la solicitud ${metadataEditedBadge(item)}</h3>
          <button id="editMetadataButton" class="btn btn-ghost btn-sm" type="button">
            ${icon('pencil')}Editar datos
          </button>
        </div>
        <div class="card-body">
          <div class="metadata-grid">
            ${infoItem('Fecha de práctica', formatDate(item.fechaPractica))}
            ${infoItem('Vence', formatDate(resolveFechaVencimiento(item)))}
            ${infoItem('Paciente', patientName(item))}
            ${infoItem('Matrícula / Codme', item.socio?.matricula || item.codme || '-')}
            ${infoItem('PDF unificado', mergeLabel(item.merge))}
            ${infoItem('Creada', formatDateTime(item.createdAt))}
          </div>
          ${feedbackHtml(item.id, 'metadata')}
        </div>
      </section>
    `;
  }

  return `
    <section class="card metadata-card">
      <div class="card-head">
        <h3>${icon('pencil')}Editar datos de la solicitud</h3>
      </div>
      <div class="card-body">
        <form id="metadataEditForm" class="metadata-edit-form">
          <label class="field">
            <span>Médico</span>
            <input id="metadataMedicoInput" type="text" value="${escapeHtml(doctorName(item))}" ${disabled} />
          </label>
          <label class="field">
            <span>Paciente</span>
            <input id="metadataPacienteInput" type="text" value="${escapeHtml(patientName(item))}" ${disabled} />
          </label>
          <label class="field">
            <span>Fecha de práctica</span>
            <input id="metadataFechaInput" type="date" value="${dateInputValue(item.fechaPractica)}" ${disabled} />
          </label>
          <label class="field">
            <span>Matrícula / Codme</span>
            <input id="metadataMatriculaInput" type="text" value="${escapeHtml(item.socio?.matricula || item.codme || '')}" ${disabled} />
          </label>
          <p class="metadata-edit-note">
            El vencimiento se recalcula automáticamente desde la fecha de práctica.
          </p>
          <div class="metadata-edit-actions">
            <button id="saveMetadataButton" class="btn btn-primary btn-sm" type="submit" ${disabled}>
              ${icon('check')}${saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button id="cancelMetadataEditButton" class="btn btn-ghost btn-sm" type="button" ${disabled}>
              Cancelar
            </button>
          </div>
          ${feedbackHtml(item.id, 'metadata')}
        </form>
      </div>
    </section>
  `;
}

function infoItem(label, value) {
  return `
    <div class="info-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderCompleteReviewControl(item) {
  const completed = isCompletedSolicitud(item);
  const reviewed = item?.revisionPrestacional || {};
  const reviewer = reviewed.revisadaPor || reviewed.revisadaEmail || 'mesa prestacional';
  const reviewedAt = reviewed.revisadaAt ? formatDateTime(reviewed.revisadaAt) : '';
  return `
    <section class="card complete-card ${completed ? 'is-done' : ''}">
      <div class="card-head">
        <h3>${icon('check-circle')}${completed ? 'Documentación completada' : 'Revisión prestacional'}</h3>
      </div>
      <div class="card-body">
        <p>
          ${completed
            ? `Revisada por ${escapeHtml(reviewer)}${reviewedAt ? ` el ${reviewedAt}` : ''}. Queda al final de la bandeja.`
            : 'Usalo cuando la documentación ya fue revisada y está lista para seguir el proceso.'}
        </p>
        <button id="completeReviewButton" class="btn btn-success" type="button" ${completed ? 'disabled' : ''}>
          ${icon('check')}${completed ? 'Completada' : 'Marcar como completada'}
        </button>
        ${feedbackHtml(item.id, 'complete')}
      </div>
    </section>
  `;
}

function renderUploadObservations(value) {
  const text = (value || '').toString().trim();
  if (!text) return '';

  return `
    <details class="upload-observations">
      <summary>
        ${icon('message')}
        <span>Observaciones enviadas por el médico</span>
        ${icon('chevron-down')}
      </summary>
      <p>${escapeHtml(text)}</p>
    </details>
  `;
}

function resolveFechaVencimiento(item) {
  const fechaPractica = toDate(item?.fechaPractica);
  if (fechaPractica) {
    const due = new Date(fechaPractica.getTime());
    due.setDate(due.getDate() + 14);
    return due.toISOString();
  }
  return item?.fechaVencimiento || null;
}
function priorityInfo(item) {
  const value = dateValue(resolveFechaVencimiento(item));
  if (!Number.isFinite(value)) return { level: 'normal', label: 'Sin fecha' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((value - today.getTime()) / 86400000);
  if (diffDays < 0) return { level: 'vencida', label: 'Vencida' };
  if (diffDays <= 2) return { level: 'alta', label: `${diffDays} días` };
  if (diffDays <= 7) return { level: 'media', label: `${diffDays} días` };
  return { level: 'normal', label: `${diffDays} días` };
}

function priorityScore(item) {
  const level = priorityInfo(item).level;
  return { vencida: 0, alta: 1, media: 2, normal: 3 }[level] ?? 4;
}

function dateValue(value) {
  const date = toDate(value);
  return date ? date.getTime() : Number.POSITIVE_INFINITY;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return '-';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value) {
  const date = toDate(value) || (typeof value === 'string' ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBytes(bytes = 0) {
  if (!bytes) return '-';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function mergeLabel(merge) {
  if (!merge?.required) return 'No requerido';
  if (merge.status === 'done') return 'Unificado';
  if (merge.status === 'error') return 'Error';
  return 'Pendiente';
}

function statusLabel(value) {
  const item = value && typeof value === 'object' ? value : null;
  const status = item ? item.estado : value;
  if (status === 'cargado' || status === 'completada' || status === 'completado') {
    return stateLabels.completada;
  }
  if (item) {
    const priority = priorityInfo(item).level;
    if (priority === 'vencida') return stateLabels.vencida;
    if (priority === 'alta' || priority === 'media') return stateLabels.por_vencer;
  }
  return stateLabels.recibido;
}

function shortId(id = '') {
  return id.slice(0, 8).toUpperCase();
}

function normalize(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function safeFilename(value = 'archivo.pdf') {
  return value
    .toString()
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || 'archivo.pdf';
}

function fileExtension(filename = '') {
  const parts = filename.toString().toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function mimeFromExtension(extension = '') {
  const types = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  };
  return types[extension.toLowerCase()] || '';
}

function escapeHtml(value = '') {
  return value
    .toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
