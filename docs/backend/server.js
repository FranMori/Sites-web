import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import multer from "multer";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
app.set("trust proxy", 1);
app.use(helmet());

// CORS: autoriser ton GitHub Pages
const allowedOrigins = [
    process.env.ALLOWED_ORIGIN,
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["POST", "OPTIONS"],
    })
);

// Multer: upload en mémoire (on attache le PDF à l'email)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
    fileFilter: (req, file, cb) => {
        const ok =
            file.mimetype === "application/pdf" ||
            file.originalname.toLowerCase().endsWith(".pdf");
        cb(ok ? null : new Error("Only PDF files are allowed"), ok);
    },
});

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// Petit rate limit ultra-simple (anti spam basique)
const lastHit = new Map();
function basicRateLimit(req, res, next) {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const prev = lastHit.get(ip) || 0;
    if (now - prev < 10_000) return res.status(429).json({ ok: false, error: "Too many requests" });
    lastHit.set(ip, now);
    next();
}

app.post("/api/apply", basicRateLimit, upload.single("cv"), async (req, res) => {
    try {
        console.log("➡️ New application received");
        const {
            firstName,
            lastName,
            email,
            availability,
            languages,
            otherLanguage,
            mission_preferences
        } = req.body;
        console.log("BODY:", req.body);
        // validations minimales
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ ok: false, error: "Missing required fields" });
        }

        const cvFile = req.file; // peut être undefined si non fourni
        const langText = languages ? languages : "";
        const otherLangText = otherLanguage ? `Other: ${otherLanguage}` : "";

        const text = `
New Bridgi Application

Name: ${firstName} ${lastName}
Email: ${email}
Availability: ${availability || "-"}

Languages: ${langText}
${otherLangText ? otherLangText : ""}

Mission preferences:
${mission_preferences || "-"}
`.trim();

        const mailOptions = {
            from: process.env.MAIL_FROM,
            to: process.env.MAIL_TO,
            subject: `Bridgi - New Application: ${firstName} ${lastName}`,
            text,
            replyTo: email,
            attachments: cvFile
                ? [
                    {
                        filename: cvFile.originalname || "cv.pdf",
                        content: cvFile.buffer,
                        contentType: "application/pdf",
                    },
                ]
                : [],
        };

        await transporter.sendMail(mailOptions);
        console.log("✅ Email sent successfully");
        return res.json({ ok: true });
    } catch (err) {
        console.error("❌ Mail error:", err);
        return res.status(500).json({ ok: false, error: err.message || "Server error" });
    }
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(process.env.PORT || 3000, () => {
    console.log("Server listening on port", process.env.PORT || 3000);
});