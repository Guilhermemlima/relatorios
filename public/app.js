// Estado global
let usuario = null;
let modalCallback = null;
let paginaAtual = 'dashboard';

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('data-hoje').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('form-login').addEventListener('submit', fazerLogin);
  document.querySelectorAll('.nav-item[data-pagina]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navegarPara(el.dataset.pagina); });
  });
  verificarSessao();
});

async function verificarSessao() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) {
      usuario = await r.json();
      iniciarApp();
    }
  } catch {}
}

// ── LOGIN ──
async function fazerLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  erroEl.style.display = 'none';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, senha }) });
    const data = await r.json();
    if (!r.ok) { erroEl.textContent = data.erro; erroEl.style.display = 'block'; return; }
    usuario = data.usuario;
    iniciarApp();
  } catch { erroEl.textContent = 'Erro de conexão. Tente novamente.'; erroEl.style.display = 'block'; }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  usuario = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('tela-login').style.display = 'flex';
}

function iniciarApp() {
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-nome').textContent = usuario.nome;
  document.getElementById('user-cargo').textContent = usuario.cargo;
  document.getElementById('user-avatar').textContent = usuario.nome.charAt(0).toUpperCase();
  if (usuario.cargo !== 'Administrador') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }
  navegarPara('dashboard');
}

// ── NAVEGAÇÃO ──
function navegarPara(pagina) {
  document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('ativo'));
  const alvo = document.getElementById('pag-' + pagina);
  if (alvo) alvo.classList.add('ativa');
  document.querySelector(`.nav-item[data-pagina="${pagina}"]`)?.classList.add('ativo');
  const titulos = { dashboard: 'Dashboard', novo: 'Novo Relatório', lista: 'Todos os Relatórios', meus: 'Meus Relatórios', exportar: 'Exportar', usuarios: 'Usuários', ver: 'Relatório', editar: 'Editar Relatório' };
  document.getElementById('titulo-pagina').textContent = titulos[pagina] || pagina;
  paginaAtual = pagina;
  if (document.getElementById('sidebar').classList.contains('aberta')) toggleSidebar();

  if (pagina === 'dashboard') renderDashboard();
  else if (pagina === 'novo') renderNovo();
  else if (pagina === 'lista') renderLista();
  else if (pagina === 'meus') renderMeus();
  else if (pagina === 'exportar') renderExportar();
  else if (pagina === 'usuarios') renderUsuarios();
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('aberta'); }

// ── DASHBOARD ──
async function renderDashboard() {
  const el = document.getElementById('pag-dashboard');
  el.innerHTML = '<div class="stats-grid"><div class="stat-card azul"><div class="stat-label">Carregando...</div></div></div>';
  const stats = await api('/api/stats');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card azul"><div class="stat-label">Total de Relatórios</div><div class="stat-valor">${stats.total}</div></div>
      <div class="stat-card verde"><div class="stat-label">Diários</div><div class="stat-valor">${stats.diarios}</div></div>
      <div class="stat-card roxo"><div class="stat-label">Semanais</div><div class="stat-valor">${stats.semanais}</div></div>
      <div class="stat-card vermelho"><div class="stat-label">Mensais</div><div class="stat-valor">${stats.mensais}</div></div>
      <div class="stat-card amarelo"><div class="stat-label">Usuários</div><div class="stat-valor">${stats.usuarios}</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-titulo">Atividade Recente</div>
        ${stats.recentes.length === 0 ? '<div class="vazio"><p>Nenhum relatório ainda.</p></div>' :
          stats.recentes.map(r => `
            <div class="recente-item">
              <div class="recente-dot ${r.tipo}"></div>
              <div class="recente-info">
                <strong>${esc(r.titulo)}</strong>
                <small>${r.autor} · ${r.tipo} · ${formatarData(r.criado_em)}</small>
              </div>
            </div>
          `).join('')}
      </div>
      <div class="card">
        <div class="card-titulo">Ações Rápidas</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn-primario" onclick="navegarPara('novo')">+ Novo Relatório Diário</button>
          <button class="btn-secundario" onclick="navegarPara('lista')">Ver Todos os Relatórios</button>
          <button class="btn-secundario" onclick="navegarPara('meus')">Meus Relatórios</button>
          <button class="btn-secundario" onclick="navegarPara('exportar')">Exportar Relatórios</button>
        </div>
      </div>
    </div>
  `;
}

// ── NOVO RELATÓRIO ──
function renderNovo(dados = null) {
  const el = document.getElementById('pag-novo');
  const hoje = new Date().toISOString().split('T')[0];
  const d = dados || {};
  el.innerHTML = `
    <div class="form-rel">
      <div class="card">
        <div class="card-titulo">${d.id ? 'Editar Relatório' : 'Criar Novo Relatório'}</div>
        <form id="form-relatorio">
          <div class="campo" style="margin-bottom:20px">
            <label>Tipo de Relatório</label>
            <div class="tipo-grid">
              ${['diario','semanal','mensal'].map(t => `
                <label class="tipo-opt sel-${t} ${(d.tipo||'diario')===t?'ativo':''}" onclick="selecionarTipo('${t}')">
                  <input type="radio" name="tipo" value="${t}" ${(d.tipo||'diario')===t?'checked':''}>
                  <div class="tipo-icone">${t==='diario'?'📅':t==='semanal'?'📆':'🗓️'}</div>
                  <strong>${t.charAt(0).toUpperCase()+t.slice(1)}</strong>
                  <small>${t==='diario'?'Atividades do dia':t==='semanal'?'Resumo da semana':'Balanço do mês'}</small>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="campo">
            <label>Título do Relatório *</label>
            <input type="text" id="rel-titulo" placeholder="Ex.: Relatório do dia 04/06/2025" value="${esc(d.titulo||'')}" required>
          </div>
          <div class="grid-2">
            <div class="campo">
              <label>Data / Período Início *</label>
              <input type="date" id="rel-inicio" value="${d.periodo_inicio||hoje}" required>
            </div>
            <div class="campo">
              <label>Data / Período Fim *</label>
              <input type="date" id="rel-fim" value="${d.periodo_fim||hoje}" required>
            </div>
          </div>
          <div class="campo">
            <label>O que foi feito? *</label>
            <textarea id="rel-conteudo" placeholder="Descreva as atividades realizadas, resultados, observações importantes..." required>${esc(d.conteudo||'')}</textarea>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn-primario">${d.id ? '💾 Salvar Alterações' : '✅ Criar Relatório'}</button>
            <button type="button" class="btn-secundario" onclick="navegarPara('${d.id?'lista':'dashboard'}')">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('form-relatorio').addEventListener('submit', e => salvarRelatorio(e, d.id));
}

function selecionarTipo(tipo) {
  document.querySelectorAll('.tipo-opt').forEach(el => el.classList.remove('ativo'));
  document.querySelector(`.sel-${tipo}`)?.classList.add('ativo');
  document.querySelector(`input[value="${tipo}"]`).checked = true;
}

async function salvarRelatorio(e, id = null) {
  e.preventDefault();
  const tipo = document.querySelector('input[name="tipo"]:checked')?.value || 'diario';
  const titulo = document.getElementById('rel-titulo').value.trim();
  const conteudo = document.getElementById('rel-conteudo').value.trim();
  const periodo_inicio = document.getElementById('rel-inicio').value;
  const periodo_fim = document.getElementById('rel-fim').value;
  if (!titulo || !conteudo || !periodo_inicio || !periodo_fim) { toast('Preencha todos os campos obrigatórios.', 'erro'); return; }
  const body = { tipo, titulo, conteudo, periodo_inicio, periodo_fim };
  const url = id ? `/api/relatorios/${id}` : '/api/relatorios';
  const method = id ? 'PUT' : 'POST';
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) { toast(data.erro || 'Erro ao salvar.', 'erro'); return; }
  toast(id ? 'Relatório atualizado!' : 'Relatório criado com sucesso!', 'sucesso');
  navegarPara('lista');
}

// ── LISTA ──
async function renderLista(meusFiltro = false) {
  const el = document.getElementById(meusFiltro ? 'pag-meus' : 'pag-lista');
  const usuarios = await api('/api/usuarios');
  el.innerHTML = `
    <div class="filtros">
      <div class="filtro-grupo">
        <label>Tipo</label>
        <select id="${meusFiltro?'m':'l'}-tipo" onchange="aplicarFiltros(${meusFiltro})">
          <option value="">Todos</option>
          <option value="diario">Diário</option>
          <option value="semanal">Semanal</option>
          <option value="mensal">Mensal</option>
        </select>
      </div>
      ${!meusFiltro ? `<div class="filtro-grupo">
        <label>Autor</label>
        <select id="l-autor" onchange="aplicarFiltros(false)">
          <option value="">Todos</option>
          ${usuarios.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="filtro-grupo">
        <label>De</label>
        <input type="date" id="${meusFiltro?'m':'l'}-inicio" onchange="aplicarFiltros(${meusFiltro})">
      </div>
      <div class="filtro-grupo">
        <label>Até</label>
        <input type="date" id="${meusFiltro?'m':'l'}-fim" onchange="aplicarFiltros(${meusFiltro})">
      </div>
      <button class="btn-secundario" onclick="limparFiltros(${meusFiltro})">Limpar</button>
    </div>
    <div id="${meusFiltro?'m':'l'}-lista-relatorios"></div>
  `;
  await aplicarFiltros(meusFiltro);
}

async function renderMeus() { await renderLista(true); }

async function aplicarFiltros(meusFiltro) {
  const p = meusFiltro ? 'm' : 'l';
  const tipo = document.getElementById(`${p}-tipo`)?.value || '';
  const inicio = document.getElementById(`${p}-inicio`)?.value || '';
  const fim = document.getElementById(`${p}-fim`)?.value || '';
  const usuario_id = meusFiltro ? usuario.id : (document.getElementById('l-autor')?.value || '');
  const params = new URLSearchParams();
  if (tipo) params.set('tipo', tipo);
  if (inicio) params.set('inicio', inicio);
  if (fim) params.set('fim', fim);
  if (usuario_id) params.set('usuario_id', usuario_id);
  const relatorios = await api('/api/relatorios?' + params);
  const cont = document.getElementById(`${p}-lista-relatorios`);
  if (!cont) return;
  if (relatorios.length === 0) {
    cont.innerHTML = `<div class="vazio">
      <svg width="64" height="64" fill="none" viewBox="0 0 24 24"><path d="M9 12h6M9 16h6M7 8h10M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" stroke="currentColor" stroke-width="1.5"/></svg>
      <h3>Nenhum relatório encontrado</h3>
      <p>Tente ajustar os filtros ou <a href="#" onclick="navegarPara('novo')">crie um novo relatório</a>.</p>
    </div>`;
    return;
  }
  cont.innerHTML = relatorios.map(r => `
    <div class="rel-item ${r.tipo}">
      <div class="rel-body">
        <div class="rel-titulo">${esc(r.titulo)}</div>
        <div class="rel-meta">
          <span>${badgeTipo(r.tipo)}</span>
          <span>👤 ${esc(r.autor)}</span>
          <span>📅 ${formatarData(r.periodo_inicio)}${r.periodo_inicio !== r.periodo_fim ? ' → ' + formatarData(r.periodo_fim) : ''}</span>
          <span>🕐 ${formatarData(r.criado_em)}</span>
        </div>
        <div class="rel-preview">${esc(r.conteudo)}</div>
      </div>
      <div class="rel-acoes">
        <button class="btn-icon" onclick="verRelatorio(${r.id})" title="Ver">
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        ${r.usuario_id == usuario.id || usuario.cargo === 'Administrador' ? `
          <button class="btn-icon" onclick="editarRelatorio(${r.id})" title="Editar">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="btn-icon perigo" onclick="confirmarExclusao(${r.id})" title="Excluir">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function limparFiltros(meusFiltro) {
  const p = meusFiltro ? 'm' : 'l';
  ['tipo','inicio','fim'].forEach(id => { const el = document.getElementById(`${p}-${id}`); if (el) el.value = ''; });
  if (!meusFiltro) { const el = document.getElementById('l-autor'); if (el) el.value = ''; }
  aplicarFiltros(meusFiltro);
}

// ── VER RELATÓRIO ──
async function verRelatorio(id) {
  const r = await api(`/api/relatorios/${id}`);
  const el = document.getElementById('pag-ver');
  el.innerHTML = `
    <div class="rel-detalhe-header ${r.tipo}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          ${badgeTipo(r.tipo)}
          <h2 style="margin-top:8px">${esc(r.titulo)}</h2>
        </div>
        <div style="display:flex;gap:8px">
          ${r.usuario_id == usuario.id || usuario.cargo === 'Administrador' ? `
            <button class="btn-secundario" onclick="editarRelatorio(${r.id})" style="color:var(--azul)">Editar</button>
          ` : ''}
          <a href="/api/exportar/pdf?id=${r.id}" target="_blank" class="btn-primario" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" stroke-width="2"/></svg>
            PDF
          </a>
        </div>
      </div>
      <div class="rel-detalhe-meta">
        <span>👤 ${esc(r.autor)} · ${esc(r.cargo)}</span>
        <span>📅 ${formatarData(r.periodo_inicio)} ${r.periodo_inicio !== r.periodo_fim ? '→ ' + formatarData(r.periodo_fim) : ''}</span>
        <span>🕐 Registrado em ${formatarData(r.criado_em)}</span>
      </div>
    </div>
    <div class="card">
      <div class="card-titulo">Conteúdo do Relatório</div>
      <div class="rel-conteudo">${esc(r.conteudo)}</div>
    </div>
    <button class="btn-secundario" onclick="history.back()">← Voltar</button>
  `;
  navegarParaDiretamente('ver');
}

async function editarRelatorio(id) {
  const r = await api(`/api/relatorios/${id}`);
  renderNovo(r);
  navegarParaDiretamente('editar');
}

function navegarParaDiretamente(pagina) {
  document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'));
  document.getElementById(`pag-${pagina}`)?.classList.add('ativa');
  const titulos = { ver: 'Visualizar Relatório', editar: 'Editar Relatório' };
  document.getElementById('titulo-pagina').textContent = titulos[pagina] || pagina;
}

// ── EXCLUIR ──
function confirmarExclusao(id) {
  document.getElementById('modal-titulo').textContent = 'Excluir Relatório';
  document.getElementById('modal-texto').textContent = 'Tem certeza que deseja excluir este relatório? Esta ação não pode ser desfeita.';
  document.getElementById('modal-ok').onclick = () => excluirRelatorio(id);
  document.getElementById('modal-confirma').style.display = 'flex';
}

async function excluirRelatorio(id) {
  fecharModal();
  const r = await fetch(`/api/relatorios/${id}`, { method: 'DELETE' });
  if (r.ok) { toast('Relatório excluído.', 'sucesso'); aplicarFiltros(paginaAtual === 'meus'); }
  else { const d = await r.json(); toast(d.erro || 'Erro ao excluir.', 'erro'); }
}

function fecharModal() { document.getElementById('modal-confirma').style.display = 'none'; }

// ── EXPORTAR ──
function renderExportar() {
  const el = document.getElementById('pag-exportar');
  el.innerHTML = `
    <div class="card" style="max-width:700px">
      <div class="card-titulo">Filtros de Exportação</div>
      <div class="filtros" style="margin-bottom:0">
        <div class="filtro-grupo">
          <label>Tipo</label>
          <select id="exp-tipo">
            <option value="">Todos</option>
            <option value="diario">Diário</option>
            <option value="semanal">Semanal</option>
            <option value="mensal">Mensal</option>
          </select>
        </div>
        <div class="filtro-grupo">
          <label>De</label>
          <input type="date" id="exp-inicio">
        </div>
        <div class="filtro-grupo">
          <label>Até</label>
          <input type="date" id="exp-fim">
        </div>
      </div>
    </div>
    <div class="export-grid" style="max-width:700px">
      <div class="export-card" onclick="exportar('excel')">
        <div class="export-icone">📊</div>
        <h3>Exportar Excel</h3>
        <p>Planilha .xlsx com todos os relatórios filtrados, formatada e pronta para análise.</p>
      </div>
      <div class="export-card" onclick="exportar('pdf')">
        <div class="export-icone">📄</div>
        <h3>Exportar PDF</h3>
        <p>Documento .pdf profissional com o conteúdo completo dos relatórios.</p>
      </div>
    </div>
  `;
}

function exportar(formato) {
  const tipo = document.getElementById('exp-tipo')?.value || '';
  const inicio = document.getElementById('exp-inicio')?.value || '';
  const fim = document.getElementById('exp-fim')?.value || '';
  const params = new URLSearchParams();
  if (tipo) params.set('tipo', tipo);
  if (inicio) params.set('inicio', inicio);
  if (fim) params.set('fim', fim);
  const url = `/api/exportar/${formato}?${params}`;
  window.open(url, '_blank');
  toast(`Exportando ${formato.toUpperCase()}...`, 'sucesso');
}

// ── USUÁRIOS ──
async function renderUsuarios() {
  if (usuario.cargo !== 'Administrador') { navegarPara('dashboard'); return; }
  const el = document.getElementById('pag-usuarios');
  const usuarios = await api('/api/usuarios');
  el.innerHTML = `
    <div class="card" style="max-width:800px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div class="card-titulo" style="margin:0">Usuários Cadastrados</div>
        <button class="btn-primario" onclick="mostrarFormUsuario()">+ Novo Usuário</button>
      </div>
      <div id="form-novo-usuario" style="display:none;background:var(--cinza-100);border-radius:var(--raio);padding:20px;margin-bottom:20px">
        <div class="grid-2">
          <div class="campo"><label>Nome *</label><input type="text" id="nu-nome" placeholder="Nome completo"></div>
          <div class="campo"><label>Email *</label><input type="email" id="nu-email" placeholder="email@empresa.com"></div>
          <div class="campo"><label>Senha *</label><input type="password" id="nu-senha" placeholder="Mínimo 6 caracteres"></div>
          <div class="campo"><label>Cargo</label>
            <select id="nu-cargo">
              <option value="Colaborador">Colaborador</option>
              <option value="Gestor">Gestor</option>
              <option value="Administrador">Administrador</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button class="btn-primario" onclick="criarUsuario()">Criar Usuário</button>
          <button class="btn-secundario" onclick="document.getElementById('form-novo-usuario').style.display='none'">Cancelar</button>
        </div>
      </div>
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Email</th><th>Cargo</th><th>Desde</th><th>Ações</th></tr></thead>
          <tbody>
            ${usuarios.map(u => `
              <tr>
                <td><strong>${esc(u.nome)}</strong></td>
                <td>${esc(u.email)}</td>
                <td>${badgeCargo(u.cargo)}</td>
                <td>${formatarData(u.criado_em)}</td>
                <td>${u.id !== 1 ? `<button class="btn-icon perigo" onclick="confirmarExclusaoUsuario(${u.id},'${esc(u.nome)}')">Remover</button>` : '<span style="color:var(--cinza-400);font-size:.8rem">Admin</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function mostrarFormUsuario() {
  const f = document.getElementById('form-novo-usuario');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function criarUsuario() {
  const nome = document.getElementById('nu-nome').value.trim();
  const email = document.getElementById('nu-email').value.trim();
  const senha = document.getElementById('nu-senha').value;
  const cargo = document.getElementById('nu-cargo').value;
  if (!nome || !email || !senha) { toast('Preencha todos os campos.', 'erro'); return; }
  const r = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, email, senha, cargo }) });
  const d = await r.json();
  if (!r.ok) { toast(d.erro || 'Erro ao criar.', 'erro'); return; }
  toast('Usuário criado com sucesso!', 'sucesso');
  renderUsuarios();
}

function confirmarExclusaoUsuario(id, nome) {
  document.getElementById('modal-titulo').textContent = 'Remover Usuário';
  document.getElementById('modal-texto').textContent = `Tem certeza que deseja remover o usuário "${nome}"?`;
  document.getElementById('modal-ok').onclick = async () => {
    fecharModal();
    const r = await fetch(`/api/usuarios/${id}`, { method: 'DELETE' });
    if (r.ok) { toast('Usuário removido.', 'sucesso'); renderUsuarios(); }
  };
  document.getElementById('modal-confirma').style.display = 'flex';
}

// ── HELPERS ──
async function api(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Erro na requisição');
  return r.json();
}

function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${tipo} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatarData(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return str.slice(0, 10).split('-').reverse().join('/');
  return d.toLocaleDateString('pt-BR');
}

function badgeTipo(tipo) {
  const map = { diario: ['badge-verde', 'Diário'], semanal: ['badge-roxo', 'Semanal'], mensal: ['badge-vermelho', 'Mensal'] };
  const [cls, label] = map[tipo] || ['badge-azul', tipo];
  return `<span class="badge ${cls}">${label}</span>`;
}

function badgeCargo(cargo) {
  const map = { 'Administrador': 'badge-vermelho', 'Gestor': 'badge-roxo', 'Colaborador': 'badge-azul' };
  return `<span class="badge ${map[cargo]||'badge-azul'}">${esc(cargo)}</span>`;
}
