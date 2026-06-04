const STORAGE_KEY = 'auditAccessSecret';
const SECRET_HEADER = 'x-internal-processing-secret';

const state = {
  filter: 'todos',
  search: '',
  items: [],
  selectedId: null,
  detail: null,
  loadingList: false,
  loadingDetail: false,
  error: null,
  searchTimer: null,
};

const els = {
  gate: document.getElementById('access-gate'),
  app: document.getElementById('audit-app'),
  secretInput: document.getElementById('access-secret-input'),
  secretSubmit: document.getElementById('access-secret-submit'),
  list: document.getElementById('inbox-list'),
  listStatus: document.getElementById('list-status'),
  detailStatus: document.getElementById('detail-status'),
  detailContent: document.getElementById('detail-content'),
  searchInput: document.getElementById('search-input'),
  filterButtons: document.querySelectorAll('.filter-btn'),
};

function getStoredSecret() {
  return sessionStorage.getItem(STORAGE_KEY) || '';
}

function setStoredSecret(value) {
  if (value) sessionStorage.setItem(STORAGE_KEY, value);
  else sessionStorage.removeItem(STORAGE_KEY);
}

function captureSecretFromUrl() {
  // Intentionally disabled: query-string secrets leak via history/logs.
}

function authHeaders() {
  const secret = getStoredSecret();
  return secret ? { [SECRET_HEADER]: secret } : {};
}

async function apiFetch(path) {
  const res = await fetch(path, { headers: authHeaders() });
  if (res.status === 401) {
    showAccessGate(true);
    throw new Error('Acesso não autorizado. Informe o segredo interno.');
  }
  if (res.status === 503) {
    throw new Error(
      'Auditoria indisponível neste ambiente. Configure INTERNAL_PROCESSING_SECRET em production.',
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return res.json();
}

function showAccessGate(show) {
  els.gate.classList.toggle('hidden', !show);
  els.app.classList.toggle('hidden', show);
}

function badgeClass(visualStatus) {
  return `badge badge-${visualStatus}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR');
}

function renderList() {
  els.list.innerHTML = '';

  if (state.loadingList) {
    els.listStatus.textContent = 'Carregando entradas…';
    return;
  }

  if (state.error) {
    els.listStatus.textContent = state.error;
    els.listStatus.className = 'list-status error-state';
    return;
  }

  els.listStatus.className = 'list-status';

  if (!state.items.length) {
    els.listStatus.textContent =
      'Nenhuma entrada processada ainda. Envie uma mensagem pelo canal de captura para começar a auditoria.';
    return;
  }

  els.listStatus.textContent = `${state.items.length} entrada(s)`;

  for (const item of state.items) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `inbox-item${item.id === state.selectedId ? ' selected' : ''}`;
    button.dataset.id = item.id;

    const pendingBadge =
      item.pending_clarifications_count > 0
        ? `<span class="badge badge-revisar">${item.pending_clarifications_count} pendência(s)</span>`
        : '';

    button.innerHTML = `
      <div class="inbox-item-top">
        <span class="${badgeClass(item.visual_status)}">${escapeHtml(item.visual_status_label)}</span>
        ${pendingBadge}
      </div>
      <p class="inbox-preview">${escapeHtml(item.raw_content_preview)}</p>
      <div class="inbox-meta">
        <span>${escapeHtml(formatDateTime(item.received_at))}</span>
        <span>${escapeHtml(item.source_channel)}</span>
      </div>
    `;

    button.addEventListener('click', () => {
      state.selectedId = item.id;
      renderList();
      loadDetail(item.id);
    });

    li.appendChild(button);
    els.list.appendChild(li);
  }
}

function renderMeta(label, value) {
  if (value == null || value === '') return '';
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderCards(items, renderItem, emptyMessage) {
  if (!items.length) {
    return `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
  }
  return `<div class="card-list">${items.map(renderItem).join('')}</div>`;
}

function renderDetail() {
  if (state.loadingDetail) {
    els.detailStatus.textContent = 'Carregando detalhes…';
    els.detailContent.innerHTML = '';
    return;
  }

  if (!state.selectedId) {
    els.detailStatus.textContent = 'Selecione uma entrada.';
    els.detailContent.innerHTML = '';
    return;
  }

  if (!state.detail) {
    els.detailStatus.textContent = 'Entrada não encontrada.';
    els.detailContent.innerHTML = '';
    return;
  }

  els.detailStatus.textContent = '';
  const { inbox_item: inbox, entities, events, assertions, tasks, clarifications, technical } =
    state.detail;

  const meta = [
    renderMeta('inbox_item_id', inbox.id),
    renderMeta('source_channel', inbox.source_channel),
    renderMeta('source_mode', inbox.source_mode),
    renderMeta('source_reference', inbox.source_reference),
    renderMeta('received_at', formatDateTime(inbox.received_at)),
    renderMeta('processing_status', inbox.processing_status),
    renderMeta('created_at', formatDateTime(inbox.created_at)),
    renderMeta('updated_at', formatDateTime(inbox.updated_at)),
  ]
    .filter(Boolean)
    .join('');

  const entitiesHtml = renderCards(
    entities,
    (entity) => `
      <article class="card">
        <div class="card-title">${escapeHtml(entity.name)}</div>
        <div class="card-meta">
          <span class="chip">${escapeHtml(entity.entity_type)}</span>
          ${entity.registry_status ? `<span>${escapeHtml(entity.registry_status)}</span>` : ''}
        </div>
      </article>
    `,
    'Nenhuma entidade canônica promovida.',
  );

  const peripheralBlock =
    state.detail.peripheral_terms?.length
      ? `<section class="block">
          <h2>Termos preservados sem canonização</h2>
          <div class="term-list">
            ${state.detail.peripheral_terms
              .map((term) => `<span class="term-pill">${escapeHtml(term)}</span>`)
              .join('')}
          </div>
        </section>`
      : '';

  const eventsHtml = renderCards(
    events,
    (event) => `
      <article class="card">
        <div class="card-title">${escapeHtml(event.title)}</div>
        <div class="card-meta">
          <span class="chip">${escapeHtml(event.event_type)}</span>
          ${event.occurred_at ? `<span>${escapeHtml(formatDateTime(event.occurred_at))}</span>` : ''}
          <span>${escapeHtml(event.record_status)}</span>
        </div>
      </article>
    `,
    'Nenhum evento promovido.',
  );

  const assertionsHtml = renderCards(
    assertions,
    (assertion) => `
      <article class="card">
        <div class="card-title">${escapeHtml(assertion.content)}</div>
        <div class="card-meta">
          <span class="chip">${escapeHtml(assertion.assertion_kind_label)}</span>
          <span>${escapeHtml(assertion.verification_status)}</span>
          ${
            assertion.confidence != null
              ? `<span>confiança ${escapeHtml(assertion.confidence)}</span>`
              : ''
          }
        </div>
      </article>
    `,
    'Nenhuma afirmação promovida.',
  );

  const tasksHtml = renderCards(
    tasks,
    (task) => `
      <article class="card">
        <div class="card-title">${escapeHtml(task.title)}</div>
        <div class="card-meta">
          <span>${escapeHtml(task.status)}</span>
          ${task.task_kind ? `<span class="chip">${escapeHtml(task.task_kind)}</span>` : ''}
          ${task.due_at ? `<span>${escapeHtml(formatDateTime(task.due_at))}</span>` : ''}
          ${task.target ? `<span>alvo: ${escapeHtml(task.target)}</span>` : ''}
          ${
            task.missing_target
              ? '<span class="badge badge-revisar">Alvo ainda não identificado</span>'
              : ''
          }
        </div>
      </article>
    `,
    'Nenhuma tarefa promovida.',
  );

  const clarificationsHtml = clarifications.length
    ? renderCards(
        clarifications,
        (clarification) => `
          <article class="card">
            <div class="card-title">${escapeHtml(clarification.question)}</div>
            <div class="card-meta">
              <span>${escapeHtml(clarification.reason)}</span>
              <span>${escapeHtml(clarification.priority)}</span>
              <span>${escapeHtml(clarification.blocking_scope)}</span>
              <span>${escapeHtml(clarification.status)}</span>
            </div>
            ${
              clarification.source_excerpt
                ? `<p class="card-meta">${escapeHtml(clarification.source_excerpt)}</p>`
                : ''
            }
          </article>
        `,
        '',
      )
    : '<p class="empty-state">Nenhuma pendência registrada.</p>';

  const technicalJson = {
    run_id: technical.run_id,
    extractor_version: technical.extractor_version,
    processing_status: technical.processing_status,
    processing_notes: technical.processing_notes,
    warnings: technical.warnings,
    metadata: technical.metadata,
    parsed_output: technical.parsed_output,
    compiled_output: technical.compiled_output,
  };

  els.detailContent.innerHTML = `
    <section class="block">
      <h2>Conteúdo original</h2>
      <div class="raw-content">${escapeHtml(inbox.raw_content)}</div>
      <dl class="meta-grid">${meta}</dl>
    </section>

    <section class="block">
      <h2>Entidades canônicas</h2>
      ${entitiesHtml}
    </section>

    ${peripheralBlock}

    <section class="block">
      <h2>Eventos</h2>
      ${eventsHtml}
    </section>

    <section class="block">
      <h2>Afirmações</h2>
      ${assertionsHtml}
    </section>

    <section class="block">
      <h2>Tarefas</h2>
      ${tasksHtml}
    </section>

    <section class="block">
      <h2>Clarifications</h2>
      ${clarificationsHtml}
    </section>

    <details class="technical">
      <summary>Ver detalhes técnicos</summary>
      <pre class="json-block">${escapeHtml(JSON.stringify(technicalJson, null, 2))}</pre>
    </details>
  `;
}

async function loadList() {
  state.loadingList = true;
  state.error = null;
  renderList();

  const params = new URLSearchParams();
  if (state.filter !== 'todos') params.set('status', state.filter);
  if (state.search.trim()) params.set('search', state.search.trim());
  params.set('limit', '100');

  try {
    const data = await apiFetch(`/audit/inbox-items?${params.toString()}`);
    state.items = data.items ?? [];
    if (!state.selectedId && state.items.length) {
      state.selectedId = state.items[0].id;
      await loadDetail(state.selectedId, { skipListRender: true });
    } else if (state.selectedId && !state.items.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.items[0]?.id ?? null;
      state.detail = null;
      if (state.selectedId) await loadDetail(state.selectedId, { skipListRender: true });
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    state.items = [];
  } finally {
    state.loadingList = false;
    renderList();
    if (!state.selectedId) renderDetail();
  }
}

async function loadDetail(id, options = {}) {
  state.loadingDetail = true;
  if (!options.skipListRender) renderDetail();

  try {
    state.detail = await apiFetch(`/audit/inbox-items/${id}`);
  } catch (err) {
    state.detail = null;
    els.detailStatus.textContent = err instanceof Error ? err.message : String(err);
    els.detailStatus.className = 'detail-status error-state';
  } finally {
    state.loadingDetail = false;
    renderDetail();
  }
}

function bindEvents() {
  els.filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      els.filterButtons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      state.filter = button.dataset.filter || 'todos';
      loadList();
    });
  });

  els.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.search = els.searchInput.value;
      loadList();
    }, 300);
  });

  els.secretSubmit.addEventListener('click', () => {
    setStoredSecret(els.secretInput.value.trim());
    bootstrap();
  });

  els.secretInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      setStoredSecret(els.secretInput.value.trim());
      bootstrap();
    }
  });
}

async function bootstrap() {
  captureSecretFromUrl();
  showAccessGate(false);
  state.error = null;

  try {
    await loadList();
  } catch (err) {
    if (String(err.message || err).includes('não autorizado')) {
      showAccessGate(true);
      return;
    }
    state.error = err instanceof Error ? err.message : String(err);
    renderList();
  }
}

bindEvents();
bootstrap();
