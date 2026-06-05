const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const admin = require('firebase-admin');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined,
    }),
  });
}

const db = admin.firestore();
const colUsuarios = db.collection('usuarios');
const colRelatorios = db.collection('relatorios');
const colContadores = db.collection('contadores');

async function nextId(tipo) {
  const ref = colContadores.doc(tipo);
  const doc = await ref.get();
  const n = doc.exists ? (doc.data().valor || 1) : 1;
  await ref.set({ valor: n + 1 });
  return n;
}

function agora() {
  return new Date().toLocaleString('pt-BR');
}

async function criarAdminPadrao() {
  const snap = await colUsuarios.where('email', '==', 'admin@empresa.com').limit(1).get();
  if (snap.empty) {
    const id = await nextId('usuario');
    await colUsuarios.doc(String(id)).set({
      id, nome: 'Administrador', email: 'admin@empresa.com',
      senha: bcrypt.hashSync('admin123', 10),
      cargo: 'Administrador', criado_em: agora(),
    });
    console.log('Admin padrao criado.');
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'relatorios-secret-key-2024',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

function autenticado(req, res, next) {
  if (req.session.usuario) return next();
  res.status(401).json({ erro: 'Nao autenticado' });
}

app.post('/api/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const snap = await colUsuarios.where('email', '==', email).limit(1).get();
    if (snap.empty) return res.status(401).json({ erro: 'Email ou senha invalidos' });
    const u = snap.docs[0].data();
    if (!bcrypt.compareSync(senha, u.senha)) return res.status(401).json({ erro: 'Email ou senha invalidos' });
    req.session.usuario = { id: u.id, nome: u.nome, email: u.email, cargo: u.cargo };
    res.json({ sucesso: true, usuario: req.session.usuario });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ sucesso: true }); });
app.get('/api/me', autenticado, (req, res) => res.json(req.session.usuario));

app.get('/api/usuarios', autenticado, async (req, res) => {
  try {
    const snap = await colUsuarios.orderBy('nome').get();
    res.json(snap.docs.map(d => { const u = d.data(); return { id: u.id, nome: u.nome, email: u.email, cargo: u.cargo, criado_em: u.criado_em }; }));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/usuarios', autenticado, async (req, res) => {
  try {
    const { nome, email, senha, cargo } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Campos obrigatorios faltando' });
    const existe = await colUsuarios.where('email', '==', email).limit(1).get();
    if (!existe.empty) return res.status(400).json({ erro: 'Email ja cadastrado' });
    const id = await nextId('usuario');
    await colUsuarios.doc(String(id)).set({ id, nome, email, senha: bcrypt.hashSync(senha, 10), cargo: cargo || 'Colaborador', criado_em: agora() });
    res.json({ sucesso: true, id });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/usuarios/:id', autenticado, async (req, res) => {
  try {
    if (req.session.usuario.cargo !== 'Administrador') return res.status(403).json({ erro: 'Sem permissao' });
    const id = parseInt(req.params.id);
    if (id === 1) return res.status(400).json({ erro: 'Nao e possivel remover o admin principal' });
    await colUsuarios.doc(String(id)).delete();
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

async function filtrarRelatorios(query) {
  let snap = await colRelatorios.orderBy('id', 'desc').get();
  let lista = snap.docs.map(d => d.data());
  if (query.tipo) lista = lista.filter(r => r.tipo === query.tipo);
  if (query.usuario_id) lista = lista.filter(r => r.usuario_id === parseInt(query.usuario_id));
  if (query.inicio) lista = lista.filter(r => r.periodo_inicio >= query.inicio);
  if (query.fim) lista = lista.filter(r => r.periodo_fim <= query.fim);
  const usersSnap = await colUsuarios.get();
  const usersMap = {};
  usersSnap.docs.forEach(d => { const u = d.data(); usersMap[u.id] = u; });
  return lista.map(r => ({ ...r, autor: usersMap[r.usuario_id]?.nome || '=', cargo: usersMap[r.usuario_id]?.cargo || '=' }));
}

app.get('/api/relatorios', autenticado, async (req, res) => {
  try { res.json(await filtrarRelatorios(req.query)); } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/relatorios/:id', autenticado, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const doc = await colRelatorios.doc(String(id)).get();
    if (!doc.exists) return res.status(404).json({ erro: 'Nao encontrado' });
    const r = doc.data();
    const uDoc = await colUsuarios.doc(String(r.usuario_id)).get();
    const u = uDoc.exists ? uDoc.data() : null;
    res.json({ ...r, autor: u?.nome || '=', cargo: u?.cargo || '=' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/relatorios', autenticado, async (req, res) => {
  try {
    const { tipo, titulo, conteudo, periodo_inicio, periodo_fim } = req.body;
    if (!tipo || !titulo || !conteudo || !periodo_inicio || !periodo_fim) return res.status(400).json({ erro: 'Campos obrigatorios faltando' });
    const id = await nextId('relatorio');
    await colRelatorios.doc(String(id)).set({ id, usuario_id: req.session.usuario.id, tipo, titulo, conteudo, periodo_inicio, periodo_fim, criado_em: agora(), atualizado_em: agora() });
    res.json({ sucesso: true, id });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/relatorios/:id', autenticado, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const doc = await colRelatorios.doc(String(id)).get();
    if (!doc.exists) return res.status(404).json({ erro: 'Nao encontrado' });
    const r = doc.data();
    if (r.usuario_id !== req.session.usuario.id && req.session.usuario.cargo !== 'Administrador') return res.status(403).json({ erro: 'Sem permissao' });
    const { titulo, conteudo, periodo_inicio, periodo_fim } = req.body;
    await colRelatorios.doc(String(id)).update({ titulo, conteudo, periodo_inicio, periodo_fim, atualizado_em: agora() });
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/relatorios/:id', autenticado, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const doc = await colRelatorios.doc(String(id)).get();
    if (!doc.exists) return res.status(404).json({ erro: 'Nao encontrado' });
    const r = doc.data();
    if (r.usuario_id !== req.session.usuario.id && req.session.usuario.cargo !== 'Administrador') return res.status(403).json({ erro: 'Sem permissao' });
    await colRelatorios.doc(String(id)).delete();
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/stats', autenticado, async (req, res) => {
  try {
    const relsSnap = await colRelatorios.get();
    const rels = relsSnap.docs.map(d => d.data());
    const usersSnap = await colUsuarios.get();
    const usersMap = {};
    usersSnap.docs.forEach(d => { const u = d.data(); usersMap[u.id] = u; });
    const recentes = [...rels].sort((a, b) => b.id - a.id).slice(0, 5).map(r => ({ titulo: r.titulo, tipo: r.tipo, autor: usersMap[r.usuario_id]?.nome || '=', criado_em: r.criado_em }));
    res.json({ total: rels.length, diarios: rels.filter(r => r.tipo === 'diario').length, semanais: rels.filter(r => r.tipo === 'semanal').length, mensais: rels.filter(r => r.tipo === 'mensal').length, usuarios: usersSnap.size, recentes });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/exportar/excel', autenticado, async (req, res) => {
  try {
    const lista = await filtrarRelatorios(req.query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema de Relatorios';
    const ws = wb.addWorksheet('Relatorios');
    ws.columns = [
      { header: 'ID', key: 'id', width: 6 }, { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Titulo', key: 'titulo', width: 35 }, { header: 'Autor', key: 'autor', width: 25 },
      { header: 'Cargo', key: 'cargo', width: 20 }, { header: 'Periodo Inicio', key: 'periodo_inicio', width: 16 },
      { header: 'Periodo Fim', key: 'periodo_fim', width: 16 }, { header: 'Conteudo', key: 'conteudo', width: 60 },
      { header: 'Criado em', key: 'criado_em', width: 20 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    lista.forEach(r => { ws.addRow({ ...r, tipo: r.tipo.charAt(0).toUpperCase() + r.tipo.slice(1) }); });
    ws.eachRow((row, n) => { if (n > 1 && n % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } }; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorios.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/exportar/pdf', autenticado, async (req, res) => {
  try {
    const q = { ...req.query };
    let lista;
    if (q.id) {
      const doc = await colRelatorios.doc(q.id).get();
      if (doc.exists) {
        const r = doc.data();
        const uDoc = await colUsuarios.doc(String(r.usuario_id)).get();
        const u = uDoc.exists ? uDoc.data() : null;
        lista = [{ ...r, autor: u?.nome || '=', cargo: u?.cargo || '=' }];
      } else { lista = []; }
    } else { lista = await filtrarRelatorios(q); }
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorios.pdf"');
    doc.pipe(res);
    doc.fontSize(22).fillColor('#2563EB').text('Sistema de Relatorios', { align: 'center' });
    doc.fontSize(11).fillColor('#64748b').text('Gerado em: ' + new Date().toLocaleString('pt-BR'), { align: 'center' });
    doc.moveDown(1.5);
    if (lista.length === 0) { doc.fontSize(13).fillColor('#374151').text('Nenhum relatorio encontrado.', { align: 'center' }); }
    lista.forEach((r, i) => {
      if (i > 0) doc.addPage();
      const tipoLabel = { diario: 'Diario', semanal: 'Semanal', mensal: 'Mensal' }[r.tipo] || r.tipo;
      const cor = { diario: '#059669', semanal: '#7C3AED', mensal: '#DC2626' }[r.tipo] || '#374151';
      const y = doc.y;
      doc.roundedRect(50, y, 495, 30, 4).fill(cor);
      doc.fillColor('#FFFFFF').fontSize(13).text(' ' + tipoLabel.toUpperCase() + ' - ' + r.titulo, 55, y + 8);
      doc.moveDown(1.2);
      doc.fillColor('#374151').fontSize(10);
      doc.text('Autor: ' + r.autor + ' | Cargo: ' + r.cargo);
      doc.text('Periodo: ' + r.periodo_inicio + ' ate ' + r.periodo_fim);
      doc.text('Registrado em: ' + r.criado_em);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').stroke();
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#111827').text(r.conteudo, { align: 'justify', lineGap: 3 });
    });
    doc.end();
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

async function main() {
  await criarAdminPadrao();
  app.listen(3000, () => {
    console.log('Sistema de Relatorios rodando em http://localhost:3000');
  });
}

main().catch(console.error);
