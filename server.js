const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ── BANCO DE DADOS ──
const adapter = new FileSync(path.join(__dirname, 'dados.json'));
const db = low(adapter);

db.defaults({ usuarios: [], relatorios: [], _seq: { usuario: 1, relatorio: 1 } }).write();

function nextId(tipo) {
  const n = db.get(`_seq.${tipo}`).value();
  db.set(`_seq.${tipo}`, n + 1).write();
  return n;
}

function agora() { return new Date().toLocaleString('pt-BR'); }

// Cria admin padrão
if (!db.get('usuarios').find({ email: 'admin@empresa.com' }).value()) {
  db.get('usuarios').push({
    id: nextId('usuario'),
    nome: 'Administrador',
    email: 'admin@empresa.com',
    senha: bcrypt.hashSync('admin123', 10),
    cargo: 'Administrador',
    criado_em: agora()
  }).write();
}

// ── EXPRESS ──
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'relatorios-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

function autenticado(req, res, next) {
  if (req.session.usuario) return next();
  res.status(401).json({ erro: 'Não autenticado' });
}

// ── AUTH ──
app.post('/api/login', (req, res) => {
  const { email, senha } = req.body;
  const u = db.get('usuarios').find({ email }).value();
  if (!u || !bcrypt.compareSync(senha, u.senha)) return res.status(401).json({ erro: 'Email ou senha inválidos' });
  req.session.usuario = { id: u.id, nome: u.nome, email: u.email, cargo: u.cargo };
  res.json({ sucesso: true, usuario: req.session.usuario });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ sucesso: true }); });

app.get('/api/me', autenticado, (req, res) => res.json(req.session.usuario));

// ── USUÁRIOS ──
app.get('/api/usuarios', autenticado, (req, res) => {
  const lista = db.get('usuarios').map(u => ({ id: u.id, nome: u.nome, email: u.email, cargo: u.cargo, criado_em: u.criado_em })).sortBy('nome').value();
  res.json(lista);
});

app.post('/api/usuarios', autenticado, (req, res) => {
  const { nome, email, senha, cargo } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
  if (db.get('usuarios').find({ email }).value()) return res.status(400).json({ erro: 'Email já cadastrado' });
  const id = nextId('usuario');
  db.get('usuarios').push({ id, nome, email, senha: bcrypt.hashSync(senha, 10), cargo: cargo || 'Colaborador', criado_em: agora() }).write();
  res.json({ sucesso: true, id });
});

app.delete('/api/usuarios/:id', autenticado, (req, res) => {
  if (req.session.usuario.cargo !== 'Administrador') return res.status(403).json({ erro: 'Sem permissão' });
  const id = parseInt(req.params.id);
  if (id === 1) return res.status(400).json({ erro: 'Não é possível remover o admin principal' });
  db.get('usuarios').remove({ id }).write();
  res.json({ sucesso: true });
});

// ── RELATÓRIOS ──
function filtrarRelatorios(query) {
  let lista = db.get('relatorios').value();
  if (query.tipo) lista = lista.filter(r => r.tipo === query.tipo);
  if (query.usuario_id) lista = lista.filter(r => r.usuario_id === parseInt(query.usuario_id));
  if (query.inicio) lista = lista.filter(r => r.periodo_inicio >= query.inicio);
  if (query.fim) lista = lista.filter(r => r.periodo_fim <= query.fim);
  return lista.sort((a, b) => b.id - a.id).map(r => {
    const u = db.get('usuarios').find({ id: r.usuario_id }).value();
    return { ...r, autor: u?.nome || '—', cargo: u?.cargo || '—' };
  });
}

app.get('/api/relatorios', autenticado, (req, res) => res.json(filtrarRelatorios(req.query)));

app.get('/api/relatorios/:id', autenticado, (req, res) => {
  const r = db.get('relatorios').find({ id: parseInt(req.params.id) }).value();
  if (!r) return res.status(404).json({ erro: 'Não encontrado' });
  const u = db.get('usuarios').find({ id: r.usuario_id }).value();
  res.json({ ...r, autor: u?.nome || '—', cargo: u?.cargo || '—' });
});

app.post('/api/relatorios', autenticado, (req, res) => {
  const { tipo, titulo, conteudo, periodo_inicio, periodo_fim } = req.body;
  if (!tipo || !titulo || !conteudo || !periodo_inicio || !periodo_fim) return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
  const id = nextId('relatorio');
  db.get('relatorios').push({ id, usuario_id: req.session.usuario.id, tipo, titulo, conteudo, periodo_inicio, periodo_fim, criado_em: agora(), atualizado_em: agora() }).write();
  res.json({ sucesso: true, id });
});

app.put('/api/relatorios/:id', autenticado, (req, res) => {
  const id = parseInt(req.params.id);
  const r = db.get('relatorios').find({ id }).value();
  if (!r) return res.status(404).json({ erro: 'Não encontrado' });
  if (r.usuario_id !== req.session.usuario.id && req.session.usuario.cargo !== 'Administrador') return res.status(403).json({ erro: 'Sem permissão' });
  const { titulo, conteudo, periodo_inicio, periodo_fim } = req.body;
  db.get('relatorios').find({ id }).assign({ titulo, conteudo, periodo_inicio, periodo_fim, atualizado_em: agora() }).write();
  res.json({ sucesso: true });
});

app.delete('/api/relatorios/:id', autenticado, (req, res) => {
  const id = parseInt(req.params.id);
  const r = db.get('relatorios').find({ id }).value();
  if (!r) return res.status(404).json({ erro: 'Não encontrado' });
  if (r.usuario_id !== req.session.usuario.id && req.session.usuario.cargo !== 'Administrador') return res.status(403).json({ erro: 'Sem permissão' });
  db.get('relatorios').remove({ id }).write();
  res.json({ sucesso: true });
});

// ── ESTATÍSTICAS ──
app.get('/api/stats', autenticado, (req, res) => {
  const rels = db.get('relatorios').value();
  const recentes = rels.sort((a, b) => b.id - a.id).slice(0, 5).map(r => {
    const u = db.get('usuarios').find({ id: r.usuario_id }).value();
    return { titulo: r.titulo, tipo: r.tipo, autor: u?.nome || '—', criado_em: r.criado_em };
  });
  res.json({
    total: rels.length,
    diarios: rels.filter(r => r.tipo === 'diario').length,
    semanais: rels.filter(r => r.tipo === 'semanal').length,
    mensais: rels.filter(r => r.tipo === 'mensal').length,
    usuarios: db.get('usuarios').size().value(),
    recentes
  });
});

// ── EXPORTAR EXCEL ──
app.get('/api/exportar/excel', autenticado, async (req, res) => {
  const relatorios = filtrarRelatorios(req.query);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Relatórios';
  const ws = wb.addWorksheet('Relatórios');
  ws.columns = [
    { header: 'ID', key: 'id', width: 6 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Título', key: 'titulo', width: 35 },
    { header: 'Autor', key: 'autor', width: 25 },
    { header: 'Cargo', key: 'cargo', width: 20 },
    { header: 'Período Início', key: 'periodo_inicio', width: 16 },
    { header: 'Período Fim', key: 'periodo_fim', width: 16 },
    { header: 'Conteúdo', key: 'conteudo', width: 60 },
    { header: 'Criado em', key: 'criado_em', width: 20 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  relatorios.forEach(r => {
    ws.addRow({ ...r, tipo: r.tipo.charAt(0).toUpperCase() + r.tipo.slice(1) });
  });
  ws.eachRow((row, n) => {
    if (n > 1 && n % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorios.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// ── EXPORTAR PDF ──
app.get('/api/exportar/pdf', autenticado, (req, res) => {
  const q = { ...req.query };
  let relatorios;
  if (q.id) relatorios = [db.get('relatorios').find({ id: parseInt(q.id) }).value()].filter(Boolean).map(r => {
    const u = db.get('usuarios').find({ id: r.usuario_id }).value();
    return { ...r, autor: u?.nome || '—', cargo: u?.cargo || '—' };
  });
  else relatorios = filtrarRelatorios(q);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorios.pdf"');
  doc.pipe(res);

  doc.fontSize(22).fillColor('#2563EB').text('Sistema de Relatórios', { align: 'center' });
  doc.fontSize(11).fillColor('#64748b').text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
  doc.moveDown(1.5);

  if (relatorios.length === 0) {
    doc.fontSize(13).fillColor('#374151').text('Nenhum relatório encontrado.', { align: 'center' });
  }

  relatorios.forEach((r, i) => {
    if (i > 0) doc.addPage();
    const tipoLabel = { diario: 'Diário', semanal: 'Semanal', mensal: 'Mensal' }[r.tipo] || r.tipo;
    const cor = { diario: '#059669', semanal: '#7C3AED', mensal: '#DC2626' }[r.tipo] || '#374151';
    const y = doc.y;
    doc.roundedRect(50, y, 495, 30, 4).fill(cor);
    doc.fillColor('#FFFFFF').fontSize(13).text(`  ${tipoLabel.toUpperCase()} — ${r.titulo}`, 55, y + 8);
    doc.moveDown(1.2);
    doc.fillColor('#374151').fontSize(10);
    doc.text(`Autor: ${r.autor}  |  Cargo: ${r.cargo}`);
    doc.text(`Período: ${r.periodo_inicio} até ${r.periodo_fim}`);
    doc.text(`Registrado em: ${r.criado_em}`);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#111827').text(r.conteudo, { align: 'justify', lineGap: 3 });
  });
  doc.end();
});

app.listen(3000, () => {
  console.log('✅ Sistema de Relatórios rodando em http://localhost:3000');
  console.log('📧 Login padrão: admin@empresa.com / admin123');
});
