const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const QRCode = require('qrcode');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_super_segura_2026';

// ----------------------------------------------------
// 1. CARPETAS Y ARCHIVOS ESTÁTICOS
// ----------------------------------------------------
const uploadDir = path.join(__dirname, 'uploads');
const qrDir = path.join(__dirname, 'qrs');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

// ----------------------------------------------------
// 2. MIDDLEWARES GLOBALES
// ----------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));
app.use('/qrs', express.static(qrDir));

// ----------------------------------------------------
// 3. CONEXIÓN A BASE DE DATOS (MYSQL POOL)
// ----------------------------------------------------
const pool = mysql.createPool({
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || 'cafemusunxd23',
    database: process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway',
    port: Number(process.env.MYSQLPORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Probar conexión inicial
(async () => {
    try {
        const conn = await pool.getConnection();
        console.log('✅ Conexión exitosa a MySQL');
        conn.release();
    } catch (err) {
        console.error('❌ Error al conectar a la base de datos:', err.message);
    }
})();

// ----------------------------------------------------
// 4. CONFIGURACIÓN DE SUBIDA DE IMÁGENES (MULTER)
// ----------------------------------------------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const mimeType = allowedTypes.test(file.mimetype);
        const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        if (mimeType && extName) return cb(null, true);
        cb(new Error('Formato de imagen no permitido (solo jpg, png, webp)'));
    }
});

// ----------------------------------------------------
// 5. MIDDLEWARE DE AUTENTICACIÓN (JWT)
// ----------------------------------------------------
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ mensaje: 'Acceso denegado: Token no proporcionado' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ mensaje: 'Token inválido o expirado' });
    }
}

// ----------------------------------------------------
// 6. RUTAS DE AUTENTICACIÓN
// ----------------------------------------------------

// Registrar usuario
app.post('/api/auth/register', async (req, res) => {
    const { nombre, email, password, rol = 'empleado' } = req.body;
    if (!nombre || !email || !password) {
        return res.status(400).json({ mensaje: 'Todos los campos son obligatorios' });
    }

    try {
        const [existente] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
        if (existente.length > 0) {
            return res.status(400).json({ mensaje: 'El correo ya está registrado' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const [result] = await pool.query(
            'INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)',
            [nombre, email, passwordHash, rol]
        );

        res.status(201).json({ mensaje: 'Usuario registrado con éxito', id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Inicio de sesión
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [usuarios] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
        if (usuarios.length === 0) {
            return res.status(401).json({ mensaje: 'Credenciales inválidas' });
        }

        const usuario = usuarios[0];
        const passValido = await bcrypt.compare(password, usuario.password);
        if (!passValido) {
            return res.status(401).json({ mensaje: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            mensaje: 'Inicio de sesión exitoso',
            token,
            usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// 7. RUTAS DE CATEGORÍAS
// ----------------------------------------------------
app.get('/api/categorias', verificarToken, async (req, res) => {
    try {
        const [categorias] = await pool.query('SELECT * FROM categorias ORDER BY nombre ASC');
        res.json(categorias);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/categorias', verificarToken, async (req, res) => {
    const { nombre, descripcion } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO categorias (nombre, descripcion) VALUES (?, ?)',
            [nombre, descripcion]
        );
        res.status(201).json({ id: result.insertId, nombre, descripcion });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// 8. RUTAS DE PRODUCTOS / INVENTARIO
// ----------------------------------------------------

// Listar productos (con soporte para búsqueda y paginación)
app.get('/api/productos', verificarToken, async (req, res) => {
    const { buscar, categoria_id } = req.query;
    try {
        let query = `
            SELECT p.*, c.nombre AS categoria_nombre 
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.id
            WHERE 1=1
        `;
        const params = [];

        if (buscar) {
            query += ' AND (p.nombre LIKE ? OR p.codigo_barras LIKE ?)';
            params.push(`%${buscar}%`, `%${buscar}%`);
        }
        if (categoria_id) {
            query += ' AND p.categoria_id = ?';
            params.push(categoria_id);
        }

        query += ' ORDER BY p.id DESC';
        const [productos] = await pool.query(query, params);
        res.json(productos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener un producto por ID
app.get('/api/productos/:id', verificarToken, async (req, res) => {
    try {
        const [producto] = await pool.query(
            `SELECT p.*, c.nombre AS categoria_nombre 
             FROM productos p 
             LEFT JOIN categorias c ON p.categoria_id = c.id 
             WHERE p.id = ?`,
            [req.params.id]
        );

        if (producto.length === 0) {
            return res.status(404).json({ mensaje: 'Producto no encontrado' });
        }
        res.json(producto[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crear producto con código QR e imagen
app.post('/api/productos', verificarToken, upload.single('imagen'), async (req, res) => {
    const { nombre, descripcion, precio, stock, stock_minimo = 5, categoria_id, codigo_barras } = req.body;
    const imagen_url = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        // Código único identificador
        const codigo = codigo_barras || `PROD-${Date.now()}`;
        const qrFilename = `${codigo}.png`;
        const qrPath = path.join(qrDir, qrFilename);

        // Generar código QR en disco
        await QRCode.toFile(qrPath, JSON.stringify({ codigo, nombre, precio }));
        const qr_url = `/qrs/${qrFilename}`;

        const [result] = await pool.query(
            `INSERT INTO productos 
             (codigo_barras, nombre, descripcion, precio, stock, stock_minimo, categoria_id, imagen_url, qr_url) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [codigo, nombre, descripcion, precio, stock, stock_minimo, categoria_id, imagen_url, qr_url]
        );

        res.status(201).json({
            mensaje: 'Producto creado exitosamente',
            id: result.insertId,
            codigo,
            qr_url,
            imagen_url
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Actualizar producto
app.put('/api/productos/:id', verificarToken, upload.single('imagen'), async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio, stock, stock_minimo, categoria_id } = req.body;

    try {
        let query = `UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, stock = ?, stock_minimo = ?, categoria_id = ?`;
        const params = [nombre, descripcion, precio, stock, stock_minimo, categoria_id];

        if (req.file) {
            query += `, imagen_url = ?`;
            params.push(`/uploads/${req.file.filename}`);
        }

        query += ` WHERE id = ?`;
        params.push(id);

        const [result] = await pool.query(query, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: 'Producto no encontrado' });
        }

        res.json({ mensaje: 'Producto actualizado con éxito' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar producto
app.delete('/api/productos/:id', verificarToken, async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: 'Producto no encontrado' });
        }
        res.json({ mensaje: 'Producto eliminado del inventario' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// 9. MOVIMIENTOS DE ENTRADA Y SALIDA (KARDEX / STOCK)
// ----------------------------------------------------
app.post('/api/movimientos', verificarToken, async (req, res) => {
    const { producto_id, tipo, cantidad, motivo } = req.body; // tipo: 'ENTRADA' o 'SALIDA'
    const usuario_id = req.usuario.id;

    if (!['ENTRADA', 'SALIDA'].includes(tipo) || cantidad <= 0) {
        return res.status(400).json({ mensaje: 'Datos de movimiento inválidos' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [prod] = await conn.query('SELECT stock FROM productos WHERE id = ? FOR UPDATE', [producto_id]);
        if (prod.length === 0) {
            await conn.rollback();
            return res.status(404).json({ mensaje: 'Producto no encontrado' });
        }

        const stockActual = prod[0].stock;
        if (tipo === 'SALIDA' && stockActual < cantidad) {
            await conn.rollback();
            return res.status(400).json({ mensaje: 'Stock insuficiente para esta salida' });
        }

        const nuevoStock = tipo === 'ENTRADA' ? stockActual + Number(cantidad) : stockActual - Number(cantidad);

        await conn.query('UPDATE productos SET stock = ? WHERE id = ?', [nuevoStock, producto_id]);
        await conn.query(
            'INSERT INTO movimientos (producto_id, usuario_id, tipo, cantidad, motivo) VALUES (?, ?, ?, ?, ?)',
            [producto_id, usuario_id, tipo, cantidad, motivo]
        );

        await conn.commit();
        res.json({ mensaje: 'Movimiento registrado', nuevoStock });
    } catch (error) {
        await conn.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        conn.release();
    }
});

// ----------------------------------------------------
// 10. GENERACIÓN DE REPORTES (EXCEL Y PDF)
// ----------------------------------------------------

// Reporte en Excel
app.get('/api/reportes/excel', verificarToken, async (req, res) => {
    try {
        const [productos] = await pool.query(`
            SELECT p.id, p.codigo_barras, p.nombre, c.nombre AS categoria, p.precio, p.stock, p.stock_minimo
            FROM productos p
            LEFT JOIN categorias c ON p.categoria_id = c.id
        `);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventario');

        worksheet.columns = [
            { header: 'ID', key: 'id', width: 8 },
            { header: 'Código', key: 'codigo_barras', width: 20 },
            { header: 'Nombre', key: 'nombre', width: 30 },
            { header: 'Categoría', key: 'categoria', width: 20 },
            { header: 'Precio ($)', key: 'precio', width: 12 },
            { header: 'Stock Actual', key: 'stock', width: 14 },
            { header: 'Stock Mínimo', key: 'stock_minimo', width: 14 }
        ];

        // Estilos para la cabecera
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1F4E78' }
        };

        productos.forEach(p => worksheet.addRow(p));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=reporte_inventario.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reporte en PDF
app.get('/api/reportes/pdf', verificarToken, async (req, res) => {
    try {
        const [productos] = await pool.query('SELECT nombre, precio, stock FROM productos ORDER BY nombre ASC');

        const doc = new PDFDocument({ margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=inventario.pdf');

        doc.pipe(res);

        // Encabezado
        doc.fontSize(20).text('Reporte de Inventario', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Fecha de emisión: ${new Date().toLocaleString()}`, { align: 'right' });
        doc.moveDown();

        // Tabla simple
        doc.fontSize(12).text('Producto', 50, doc.y, { continued: true, width: 250 });
        doc.text('Precio', 320, doc.y, { continued: true, width: 100 });
        doc.text('Stock', 440, doc.y);
        doc.moveTo(40, doc.y + 5).lineTo(550, doc.y + 5).stroke();
        doc.moveDown(0.5);

        productos.forEach(p => {
            const y = doc.y;
            doc.fontSize(10).text(p.nombre, 50, y, { width: 250 });
            doc.text(`$${Number(p.precio).toFixed(2)}`, 320, y, { width: 100 });
            doc.text(`${p.stock}`, 440, y);
            doc.moveDown(0.5);
        });

        doc.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// 11. INICIO DEL SERVIDOR
// ----------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});
