const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const DB_PATH = path.join(__dirname, 'banco.db');
const app = express();

// ── BANCO DE DADOS (SQLite via sql.js / WebAssembly) ──
let db;

async function iniciarBanco() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Salva banco no disco após cada escrita
  function salvar() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  // Cria tabelas
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      cargo TEXT DEFAULT 'Colaborador',
      criado_em TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS relatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('diario','semanal','mensal')),
      titulo TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      periodo_inicio TEXT NOT NULL,
      periodo_fim TEXT NOT NULL,
      criado_em TEXT DEFAULT (datetime('now','localtime')),
      atualizado_em TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
  `);
  salvar();

  // Admin padrão
  const admins = db.exec("SELECT id FROM usuarios WHERE email='admin@empresa.com'");
  if (!admins.length || !admins[0].values.length) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO usuarios (nome, email, senha, cargo) VALUES (?,?,?,?)',
      ['Administrador', 'admin@empresa.com', hash, 'Administrador']);
    salvar();
  }

  // ── Helpers de consulta ──
  db.query = (sql, params = []) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      const cols = stmt.getColumnNames();
      const vals = stmt.get();
      const obj = {};
      cols.forEach((c, i) => obj[c] = vals[i]);
      rows.push(obj);
    }
    stmt.free();
    return rows;
  };

  db.queryOne = (sql, params = []) => db.query(sql, params)[0] || null;

  db.execute = (sql, params = []) => {
    db.run(sql, params);
    salvar();
    return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0];
  };

  return db;
}

// ── INICIALIZA E SOBE O SERVIDOR ──
iniciarBanco().then(() => {

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
    const u = db.queryOne('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (!u || !bcrypt.compareSync(senha, u.senha))
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    req.session.usuario = { id: u.id, nome: u.nome, email: u.email, cargo: u.cargo };
    res.json({ sucesso: true, usuario: req.session.usuario });
  });

  app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ sucesso: true }); });
  app.get('/api/me', autenticado, (req, res) => res.json(req.session.usuario));

  // ── USUÁRIOS ──
  app.get('/api/usuarios', autenticado, (req, res) => {
    res.json(db.query('SELECT id, nome, email, cargo, criado_em FROM usuarios ORDER BY nome'));
  });

  app.post('/api/usuarios', autenticado, (req, res) => {
    const { nome, email, senha, cargo } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    if (db.queryOne('SELECT id FROM usuarios WHERE email = ?', [email]))
      return res.status(400).json({ erro: 'Email já cadastrado' });
    try {
      const id = db.execute('INSERT INTO usuarios (nome, email, senha, cargo) VALUES (?,?,?,?)',
        [nome, email, bcrypt.hashSync(senha, 10), cargo || 'Colaborador']);
      res.json({ sucesso: true, id });
    } catch (e) {
      res.status(400).json({ erro: 'Erro ao criar usuário' });
    }
  });

  app.delete('/api/usuarios/:id', autenticado, (req, res) => {
    if (req.session.usuario.cargo !== 'Administrador')
      return res.status(403).json({ erro: 'Sem permissão' });
    const id = parseInt(req.params.id);
    if (id === 1) return res.status(400).json({ erro: 'Não é possível remover o admin principal' });
    db.execute('DELETE FROM usuarios WHERE id = ?', [id]);
    res.json({ sucesso: true });
  });

  // ── RELATÓRIOS ──
  function buildFiltro(query) {
    let sql = `
      SELECT r.*, u.nome as autor, u.cargo
      FROM relatorios r
      JOIN usuarios u ON r.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (query.tipo)       { sql += ' AND r.tipo = ?';           params.push(query.tipo); }
    if (query.usuario_id) { sql += ' AND r.usuario_id = ?';     params.push(parseInt(query.usuario_id)); }
    if (query.inicio)     { sql += ' AND r.periodo_inicio >= ?'; params.push(query.inicio); }
    if (query.fim)        { sql += ' AND r.periodo_fim <= ?';    params.push(query.fim); }
    sql += ' ORDER BY r.id DESC';
    return { sql, params };
  }

  app.get('/api/relatorios', autenticado, (req, res) => {
    const { sql, params } = buildFiltro(req.query);
    res.json(db.query(sql, params));
  });

  app.get('/api/relatorios/:id', autenticado, (req, res) => {
    const r = db.queryOne(
      'SELECT r.*, u.nome as autor, u.cargo FROM relatorios r JOIN usuarios u ON r.usuario_id = u.id WHERE r.id = ?',
      [parseInt(req.params.id)]
    );
    if (!r) return res.status(404).json({ erro: 'Relatório não encontrado' });
    res.json(r);
  });

  app.post('/api/relatorios', autenticado, (req, res) => {
    const { tipo, titulo, conteudo, periodo_inicio, periodo_fim } = req.body;
    if (!tipo || !titulo || !conteudo || !periodo_inicio || !periodo_fim)
      return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    const id = db.execute(
      'INSERT INTO relatorios (usuario_id, tipo, titulo, conteudo, periodo_inicio, periodo_fim) VALUES (?,?,?,?,?,?)',
      [req.session.usuario.id, tipo, titulo, conteudo, periodo_inicio, periodo_fim]
    );
    res.json({ sucesso: true, id });
  });

  app.put('/api/relatorios/:id', autenticado, (req, res) => {
    const id = parseInt(req.params.id);
    const r = db.queryOne('SELECT * FROM relatorios WHERE id = ?', [id]);
    if (!r) return res.status(404).json({ erro: 'Não encontrado' });
    if (r.usuario_id !== req.session.usuario.id && req.session.usuario.cargo !== 'Administrador')
      return res.status(403).json({ erro: 'Sem permissão' });
    const { titulo, conteudo, periodo_inicio, periodo_fim } = req.body;
    db.execute(
      `UPDATE relatorios SET titulo=?, conteudo=?, periodo_inicio=?, periodo_fim=?,
       atualizado_em=datetime('now','localtime') WHERE id=?`,
      [titulo, conteudo, periodo_inicio, periodo_fim, id]
    );
    res.json({ sucesso: true });
  });

  app.delete('/api/relatorios/:id', autenticado, (req, res) => {
    const id = parseInt(req.params.id);
    const r = db.queryOne('SELECT * FROM relatorios WHERE id = ?', [id]);
    if (!r) return res.status(404).json({ erro: 'Não encontrado' });
    if (r.usuario_id !== req.session.usuario.id && req.session.usuario.cargo !== 'Administrador')
      return res.status(403).json({ erro: 'Sem permissão' });
    db.execute('DELETE FROM relatorios WHERE id = ?', [id]);
    res.json({ sucesso: true });
  });

  // ── ESTATÍSTICAS ──
  app.get('/api/stats', autenticado, (req, res) => {
    const total    = db.queryOne("SELECT COUNT(*) as n FROM relatorios").n;
    const diarios  = db.queryOne("SELECT COUNT(*) as n FROM relatorios WHERE tipo='diario'").n;
    const semanais = db.queryOne("SELECT COUNT(*) as n FROM relatorios WHERE tipo='semanal'").n;
    const mensais  = db.queryOne("SELECT COUNT(*) as n FROM relatorios WHERE tipo='mensal'").n;
    const usuarios = db.queryOne("SELECT COUNT(*) as n FROM usuarios").n;
    const recentes = db.query(
      'SELECT r.titulo, r.tipo, u.nome as autor, r.criado_em FROM relatorios r JOIN usuarios u ON r.usuario_id = u.id ORDER BY r.id DESC LIMIT 5'
    );
    res.json({ total, diarios, semanais, mensais, usuarios, recentes });
  });

  // ── EXPORTAR EXCEL ──
  app.get('/api/exportar/excel', autenticado, async (req, res) => {
    const { sql, params } = buildFiltro(req.query);
    const relatorios = db.query(sql, params);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema de Relatórios';
    const ws = wb.addWorksheet('Relatórios');
    ws.columns = [
      { header: 'ID',             key: 'id',             width: 6  },
      { header: 'Tipo',           key: 'tipo',           width: 12 },
      { header: 'Título',         key: 'titulo',         width: 35 },
      { header: 'Autor',          key: 'autor',          width: 25 },
      { header: 'Cargo',          key: 'cargo',          width: 20 },
      { header: 'Período Início', key: 'periodo_inicio', width: 16 },
      { header: 'Período Fim',    key: 'periodo_fim',    width: 16 },
      { header: 'Conteúdo',       key: 'conteudo',       width: 60 },
      { header: 'Criado em',      key: 'criado_em',      width: 20 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    relatorios.forEach(r => ws.addRow({ ...r, tipo: r.tipo.charAt(0).toUpperCase() + r.tipo.slice(1) }));
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
    let relatorios;
    if (req.query.id) {
      const r = db.queryOne(
        'SELECT r.*, u.nome as autor, u.cargo FROM relatorios r JOIN usuarios u ON r.usuario_id = u.id WHERE r.id = ?',
        [parseInt(req.query.id)]
      );
      relatorios = r ? [r] : [];
    } else {
      const { sql, params } = buildFiltro(req.query);
      relatorios = db.query(sql, params);
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorios.pdf"');
    doc.pipe(res);

    doc.fontSize(22).fillColor('#2563EB').text('Sistema de Relatórios', { align: 'center' });
    doc.fontSize(11).fillColor('#64748b').text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
    doc.moveDown(1.5);

    if (!relatorios.length) {
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
    console.log('🗄️  Banco SQLite: banco.db');
    console.log('📧 Login padrão: admin@empresa.com / admin123');
  });

}).catch(err => {
  console.error('❌ Erro ao iniciar banco de dados:', err);
  process.exit(1);
});
