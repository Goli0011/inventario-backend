const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const QRCode = require("qrcode");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();

const SECRET = process.env.JWT_SECRET || "clave_secreta_inventario";

// ==================== CONFIGURACIÓN MULTER ====================

if (!fs.existsSync("./uploads")) {
    fs.mkdirSync("./uploads", { recursive: true });
}

if (!fs.existsSync("./qrs")) {
    fs.mkdirSync("./qrs", { recursive: true });
}

const upload = multer({
    dest: "uploads/"
});

// ==================== MIDDLEWARE ====================

app.use(bodyParser.json());
app.use(cors());

// Permitir que Flutter vea las fotografías y QRs
app.use("/uploads", express.static("uploads"));
app.use("/qrs", express.static("qrs"));

// ==================== CONEXIÓN MYSQL / RAILWAY ====================

const conexion = mysql.createConnection({
    host: process.env.MYSQLHOST || process.env.DB_HOST || "localhost",
    user: process.env.MYSQLUSER || process.env.DB_USER || "root",
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "cafemusunxd23",
    database: process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || process.env.DB_NAME || "railway",
    port: Number(process.env.MYSQLPORT) || 3306
});

conexion.connect(err => {
    if (err) {
        console.error("Error al conectar con la base de datos:", err);
        return;
    }
    console.log("✅ Conectado exitosamente a la base de datos MySQL");
});

// ==================== INICIO ====================

app.get("/", (req, res) => {
    res.send("Bienvenido a Inventario API");
});

// ==================== MIDDLEWARE JWT ====================

function verificarToken(req, res, next) {
    const token = req.headers["authorization"];

    if (!token) {
        return res.status(401).json({
            status: "error",
            mensaje: "Token requerido"
        });
    }

    jwt.verify(token, SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({
                status: "error",
                mensaje: "Token inválido"
            });
        }
        req.usuario = decoded;
        next();
    });
}

// ==================== VERIFICAR ADMIN ====================

function verificarAdmin(req, res, next) {
    if (req.usuario.rol !== "administrador") {
        return res.status(403).json({
            status: "error",
            mensaje: "Acceso denegado"
        });
    }
    next();
}

// ============================================================
// ==================== MATERIALES ============================
// ============================================================

// ---------- REGISTRAR MATERIAL ----------

app.post(
    "/materiales",
    verificarToken,
    verificarAdmin,
    upload.single("foto"),
    (req, res) => {
        const {
            nombre,
            cantidad,
            estado,
            categoria
        } = req.body;

        if (!nombre || !categoria) {
            return res.status(400).json({
                status: "error",
                mensaje: "Nombre y categoría son obligatorios"
            });
        }

        const foto = req.file
            ? req.file.path.replace(/\\/g, "/")
            : null;

        const sql = `
            INSERT INTO materiales
            (nombre, cantidad, estado, categoria, foto)
            VALUES (?, ?, ?, ?, ?)
        `;

        conexion.query(
            sql,
            [
                nombre,
                cantidad || 1,
                estado || "Bueno",
                categoria,
                foto
            ],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                generarQR(result.insertId, nombre);

                res.status(201).json({
                    status: "ok",
                    mensaje: "Material agregado correctamente",
                    id: result.insertId
                });
            }
        );
    }
);

// ---------- LISTAR MATERIALES ----------

app.get(
    "/materiales",
    verificarToken,
    (req, res) => {
        const sql = `
            SELECT
                id,
                nombre,
                cantidad,
                estado,
                categoria,
                foto
            FROM materiales
            ORDER BY id DESC
        `;

        conexion.query(
            sql,
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result);
            }
        );
    }
);

// ---------- EDITAR MATERIAL ----------

app.put(
    "/materiales/:id",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const {
            nombre,
            categoria
        } = req.body;

        if (!nombre || !categoria) {
            return res.status(400).json({
                status: "error",
                mensaje: "Nombre y categoría son obligatorios"
            });
        }

        const sql = `
            UPDATE materiales
            SET nombre = ?,
                categoria = ?
            WHERE id = ?
        `;

        conexion.query(
            sql,
            [
                nombre,
                categoria,
                req.params.id
            ],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({
                        status: "error",
                        mensaje: "Material no encontrado"
                    });
                }

                res.json({
                    status: "ok",
                    mensaje: "Material actualizado correctamente"
                });
            }
        );
    }
);

// ---------- ELIMINAR MATERIAL ----------

app.delete(
    "/materiales/:id",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const sql = `
            DELETE FROM materiales
            WHERE id = ?
        `;

        conexion.query(
            sql,
            [req.params.id],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({
                        status: "error",
                        mensaje: "Material no encontrado"
                    });
                }

                res.json({
                    status: "ok",
                    mensaje: "Material eliminado correctamente"
                });
            }
        );
    }
);

// ============================================================
// ==================== LISTA DE MAESTROS =====================
// ============================================================

app.get(
    "/usuarios/maestros",
    verificarToken,
    (req, res) => {
        const sql = `
            SELECT
                id,
                usuario,
                rol
            FROM usuarios
            WHERE rol = 'maestro'
        `;

        conexion.query(
            sql,
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result);
            }
        );
    }
);

// ============================================================
// ==================== REGISTRO SEGURO =======================
// ============================================================

app.post(
    "/registro",
    (req, res) => {
        const {
            usuario,
            correo,
            password,
            rol
        } = req.body;

        if (!usuario || !correo || !password || !rol) {
            return res.status(400).json({
                status: "error",
                mensaje: "Todos los campos son obligatorios"
            });
        }

        const hashedPassword = bcrypt.hashSync(password, 8);

        const sql = `
            INSERT INTO usuarios
            (usuario, correo, password_hash, rol)
            VALUES (?, ?, ?, ?)
        `;

        conexion.query(
            sql,
            [
                usuario,
                correo,
                hashedPassword,
                rol
            ],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                res.json({
                    status: "ok",
                    mensaje: "Usuario registrado"
                });
            }
        );
    }
);

// ============================================================
// ==================== LOGIN ================================
// ============================================================

const handleLogin = (req, res) => {
    const usuario = req.body.usuario || req.body.email;
    const clave = req.body.clave || req.body.password;

    const sql = `
        SELECT *
        FROM usuarios
        WHERE usuario = ?
    `;

    conexion.query(
        sql,
        [usuario],
        (err, result) => {
            if (err) {
                return res.status(500).json({
                    status: "error",
                    mensaje: err
                });
            }

            if (result.length === 0) {
                return res.json({
                    status: "error",
                    mensaje: "Usuario no encontrado"
                });
            }

            const usuarioDB = result[0];

            if (usuarioDB.password_hash) {
                const passwordValido = bcrypt.compareSync(
                    clave,
                    usuarioDB.password_hash
                );

                if (!passwordValido) {
                    return res.json({
                        status: "error",
                        mensaje: "Contraseña incorrecta"
                    });
                }
            } else {
                if (usuarioDB.clave !== clave) {
                    return res.json({
                        status: "error",
                        mensaje: "Contraseña incorrecta"
                    });
                }

                const hashedPassword = bcrypt.hashSync(clave, 8);
                const sqlActualizar = `
                    UPDATE usuarios
                    SET password_hash = ?
                    WHERE id = ?
                `;

                conexion.query(
                    sqlActualizar,
                    [hashedPassword, usuarioDB.id],
                    error => {
                        if (error) {
                            console.log("Error al generar hash:", error);
                        }
                    }
                );
            }

            const token = jwt.sign(
                {
                    id: usuarioDB.id,
                    rol: usuarioDB.rol
                },
                SECRET,
                {
                    expiresIn: "8h"
                }
            );

            res.json({
                status: "ok",
                token: token,
                rol: usuarioDB.rol,
                usuario: usuarioDB.usuario
            });
        }
    );
};

// Responde a ambas rutas para que no falle jamás
app.post("/login", handleLogin);
app.post("/api/auth/login", handleLogin);

// ============================================================
// ==================== PRUEBA ADMIN ==========================
// ============================================================

app.get(
    "/admin/reportes",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        res.json({
            status: "ok",
            mensaje: "Bienvenido administrador"
        });
    }
);

// ============================================================
// ==================== PRÉSTAMOS =============================
// ============================================================

app.post(
    "/prestamos",
    (req, res) => {
        const {
            material_id,
            fecha_prestamo,
            maestro
        } = req.body;

        const sqlPermiso = `
            SELECT *
            FROM permisos
            WHERE maestro = ?
            AND material_id = ?
            AND puede_prestar = TRUE
        `;

        conexion.query(
            sqlPermiso,
            [
                maestro,
                material_id
            ],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                if (result.length === 0) {
                    return res.json({
                        status: "fail",
                        mensaje: "No tienes permiso para prestar este material"
                    });
                }

                const sql = `
                    INSERT INTO prestamos
                    (material_id, fecha_prestamo, maestro)
                    VALUES (?, ?, ?)
                `;

                conexion.query(
                    sql,
                    [
                        material_id,
                        fecha_prestamo,
                        maestro
                    ],
                    (err2, result2) => {
                        if (err2) {
                            return res.status(500).json({
                                status: "error",
                                mensaje: err2
                            });
                        }

                        res.json({
                            status: "ok",
                            mensaje: "Préstamo registrado"
                        });
                    }
                );
            }
        );
    }
);

// ---------- LISTA DE PRÉSTAMOS ----------

app.get(
    "/prestamos",
    (req, res) => {
        const sql = `
            SELECT
                prestamos.id,
                prestamos.material_id,
                materiales.nombre AS material,
                prestamos.fecha_prestamo,
                prestamos.fecha_devolucion,
                prestamos.maestro
            FROM prestamos
            INNER JOIN materiales
                ON prestamos.material_id = materiales.id
            ORDER BY prestamos.fecha_prestamo DESC
        `;

        conexion.query(
            sql,
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result);
            }
        );
    }
);

// ---------- ACTUALIZAR PRÉSTAMO ----------

app.put(
    "/prestamos/:id",
    (req, res) => {
        const { fecha_devolucion } = req.body;

        const sql = `
            UPDATE prestamos
            SET fecha_devolucion = ?
            WHERE id = ?
        `;

        conexion.query(
            sql,
            [fecha_devolucion, req.params.id],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                res.json({
                    status: "ok",
                    mensaje: "Préstamo actualizado"
                });
            }
        );
    }
);

// ---------- DEVOLVER POR MATERIAL ----------

app.put(
    "/prestamos/devolver/:material_id",
    (req, res) => {
        const sql = `
            UPDATE prestamos
            SET fecha_devolucion = NOW()
            WHERE material_id = ?
            AND fecha_devolucion IS NULL
        `;

        conexion.query(
            sql,
            [req.params.material_id],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                if (result.affectedRows === 0) {
                    return res.json({
                        status: "fail",
                        mensaje: "No hay un préstamo pendiente para este material"
                    });
                }

                res.json({
                    status: "ok",
                    mensaje: "Entrega registrada"
                });
            }
        );
    }
);

// ============================================================
// ==================== REPORTES ==============================
// ============================================================

// ---------- TOTAL ----------

app.get(
    "/reportes/total",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const sql = "SELECT COUNT(*) AS total FROM prestamos";

        conexion.query(
            sql,
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result[0]);
            }
        );
    }
);

// ---------- PENDIENTES ----------

app.get(
    "/reportes/pendientes",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const sql = `
            SELECT COUNT(*) AS pendientes
            FROM prestamos
            WHERE fecha_devolucion IS NULL
        `;

        conexion.query(
            sql,
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result[0]);
            }
        );
    }
);

// ---------- DEVUELTOS ----------

app.get(
    "/reportes/devueltos",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const sql = `
            SELECT COUNT(*) AS devueltos
            FROM prestamos
            WHERE fecha_devolucion IS NOT NULL
        `;

        conexion.query(
            sql,
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result[0]);
            }
        );
    }
);

// ============================================================
// ==================== NOTIFICACIONES ========================
// ============================================================

app.get(
    "/notificaciones/:maestro",
    (req, res) => {
        const sql = `
            SELECT *
            FROM prestamos
            WHERE maestro = ?
            AND fecha_devolucion IS NULL
        `;

        conexion.query(
            sql,
            [req.params.maestro],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result);
            }
        );
    }
);

// ============================================================
// ==================== PERMISOS ==============================
// ============================================================

app.post(
    "/permisos",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const {
            maestro,
            material_id,
            puede_ver,
            puede_prestar,
            puede_devolver
        } = req.body;

        const sql = `
            INSERT INTO permisos
            (maestro, material_id, puede_ver, puede_prestar, puede_devolver)
            VALUES (?, ?, ?, ?, ?)
        `;

        conexion.query(
            sql,
            [
                maestro,
                material_id,
                puede_ver,
                puede_prestar,
                puede_devolver
            ],
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                res.json({
                    status: "ok",
                    mensaje: "Permiso asignado"
                });
            }
        );
    }
);

// ============================================================
// ==================== QR ====================================
// ============================================================

function generarQR(materialId, nombre) {
    const ruta = `./qrs/${materialId}.png`;

    QRCode.toFile(
        ruta,
        materialId.toString(),
        {
            color: {
                dark: "#000000",
                light: "#FFFFFF"
            },
            margin: 2,
            width: 300
        },
        function (err) {
            if (err) {
                console.error("Error generando QR:", err);
                return;
            }
            console.log(`QR generado en: ${ruta}`);
        }
    );
}

// ============================================================
// ==================== REPORTE PDF ============================
// ============================================================

app.get(
    "/reportes/pdf",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const {
            maestro,
            fecha_inicio,
            fecha_fin
        } = req.query;

        let sql = `
            SELECT
                prestamos.id,
                prestamos.material_id,
                materiales.nombre AS material,
                prestamos.fecha_prestamo,
                prestamos.fecha_devolucion,
                prestamos.maestro
            FROM prestamos
            INNER JOIN materiales
                ON prestamos.material_id = materiales.id
            WHERE 1 = 1
        `;

        const valores = [];

        if (maestro && maestro.trim() !== "") {
            sql += " AND prestamos.maestro = ?";
            valores.push(maestro);
        }

        if (fecha_inicio) {
            sql += " AND DATE(prestamos.fecha_prestamo) >= ?";
            valores.push(fecha_inicio);
        }

        if (fecha_fin) {
            sql += " AND DATE(prestamos.fecha_prestamo) <= ?";
            valores.push(fecha_fin);
        }

        sql += " ORDER BY prestamos.fecha_prestamo DESC";

        conexion.query(
            sql,
            valores,
            (err, resultados) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                const doc = new PDFDocument({ margin: 40 });

                res.setHeader("Content-Type", "application/pdf");
                res.setHeader(
                    "Content-Disposition",
                    "attachment; filename=reporte_prestamos.pdf"
                );

                doc.pipe(res);

                doc.fontSize(18).text("Reporte de Préstamos", { align: "center" });
                doc.moveDown();
                doc.fontSize(10).text(`Maestro: ${maestro || "Todos"}`);
                doc.text(`Fecha inicio: ${fecha_inicio || "Todas"}`);
                doc.text(`Fecha fin: ${fecha_fin || "Todas"}`);
                doc.moveDown();

                resultados.forEach((p, index) => {
                    doc.fontSize(11).text(`${index + 1}. Material: ${p.material}`);
                    doc.fontSize(9).text(`ID: ${p.material_id} | Maestro: ${p.maestro}`);
                    doc.text(`Préstamo: ${p.fecha_prestamo}`);
                    doc.text(`Devolución: ${p.fecha_devolucion || "Pendiente"}`);
                    doc.moveDown();
                });

                if (resultados.length === 0) {
                    doc.fontSize(12).text(
                        "No se encontraron préstamos con los filtros seleccionados."
                    );
                }

                doc.end();
            }
        );
    }
);

// ============================================================
// ==================== REPORTE EXCEL =========================
// ============================================================

app.get(
    "/reportes/excel",
    verificarToken,
    verificarAdmin,
    async (req, res) => {
        const {
            maestro,
            fecha_inicio,
            fecha_fin
        } = req.query;

        let sql = `
            SELECT
                prestamos.id,
                prestamos.material_id,
                materiales.nombre AS material,
                prestamos.fecha_prestamo,
                prestamos.fecha_devolucion,
                prestamos.maestro
            FROM prestamos
            INNER JOIN materiales
                ON prestamos.material_id = materiales.id
            WHERE 1 = 1
        `;

        const valores = [];

        if (maestro && maestro.trim() !== "") {
            sql += " AND prestamos.maestro = ?";
            valores.push(maestro);
        }

        if (fecha_inicio) {
            sql += " AND DATE(prestamos.fecha_prestamo) >= ?";
            valores.push(fecha_inicio);
        }

        if (fecha_fin) {
            sql += " AND DATE(prestamos.fecha_prestamo) <= ?";
            valores.push(fecha_fin);
        }

        sql += " ORDER BY prestamos.fecha_prestamo DESC";

        conexion.query(
            sql,
            valores,
            async (err, resultados) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }

                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet("Préstamos");

                worksheet.columns = [
                    { header: "ID", key: "id", width: 10 },
                    { header: "Material ID", key: "material_id", width: 15 },
                    { header: "Material", key: "material", width: 25 },
                    { header: "Maestro", key: "maestro", width: 25 },
                    { header: "Fecha préstamo", key: "fecha_prestamo", width: 25 },
                    { header: "Fecha devolución", key: "fecha_devolucion", width: 25 }
                ];

                resultados.forEach(p => {
                    worksheet.addRow({
                        id: p.id,
                        material_id: p.material_id,
                        material: p.material,
                        maestro: p.maestro,
                        fecha_prestamo: p.fecha_prestamo,
                        fecha_devolucion: p.fecha_devolucion || "Pendiente"
                    });
                });

                worksheet.getRow(1).font = { bold: true };

                res.setHeader(
                    "Content-Type",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                );
                res.setHeader(
                    "Content-Disposition",
                    "attachment; filename=reporte_prestamos.xlsx"
                );

                await workbook.xlsx.write(res);
                res.end();
            }
        );
    }
);

// ============================================================
// ==================== DASHBOARD =============================
// ============================================================

app.get(
    "/dashboard",
    verificarToken,
    verificarAdmin,
    (req, res) => {
        const sql = `
            SELECT
                (SELECT COUNT(*) FROM materiales) AS total_materiales,
                (SELECT COUNT(*) FROM prestamos WHERE fecha_devolucion IS NULL) AS prestados,
                (SELECT COUNT(*) FROM prestamos WHERE fecha_devolucion IS NOT NULL) AS devueltos,
                (SELECT COUNT(*) FROM materiales WHERE estado = 'Malo') AS danados
        `;

        conexion.query(
            sql,
            (err, result) => {
                if (err) {
                    return res.status(500).json({
                        status: "error",
                        mensaje: err
                    });
                }
                res.json(result[0]);
            }
        );
    }
);

app.get("/historial", (req, res) => {
    const { maestro, material, fecha_inicio, fecha_fin } = req.query;

    let sql = `
        SELECT 
            p.id,
            m.nombre AS material,
            p.maestro AS docente,
            p.fecha_prestamo,
            p.fecha_devolucion
        FROM prestamos p
        JOIN materiales m ON p.material_id = m.id
        WHERE 1=1
    `;

    const params = [];

    if (maestro) {
        sql += " AND p.maestro = ?";
        params.push(maestro);
    }

    if (material) {
        sql += " AND LOWER(TRIM(m.nombre)) = LOWER(TRIM(?))";
        params.push(material);
    }

    if (fecha_inicio && fecha_fin) {
        sql += " AND DATE(p.fecha_prestamo) BETWEEN ? AND ?";
        params.push(fecha_inicio, fecha_fin);
    }

    sql += " ORDER BY p.fecha_prestamo DESC";

    conexion.query(sql, params, (err, result) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                mensaje: err.message
            });
        }
        res.json(result);
    });
});

// ============================================================
// ==================== SERVIDOR ==============================
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
