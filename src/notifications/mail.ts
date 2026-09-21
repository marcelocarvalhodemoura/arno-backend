import { existsSync } from "node:fs";
import type { Transporter } from "nodemailer";
import { logoFilePath, LOGO_CID } from "./templates";

export type MailSendResult = {
  ok: boolean;
  skipped: boolean;
  error?: string;
};

let transporter: Transporter | null = null;

export function mailConfigured() {
  if (process.env.MAIL_MOCK === "1") return true;
  const host = process.env.MAIL_HOST?.trim() ?? "";
  const from = process.env.MAIL_FROM?.trim() ?? "";
  return Boolean(host && from);
}

export function mailFrom() {
  return process.env.MAIL_FROM?.trim() || "tesouraria@arnofriedrich.org.br";
}

export function resetMailTransport() {
  if (transporter && "close" in transporter) {
    try {
      transporter.close();
    } catch {
      /* ignore */
    }
  }
  transporter = null;
}

function queueConcurrency() {
  const value = Number(process.env.MAIL_QUEUE_CONCURRENCY ?? 3);
  return Number.isFinite(value) && value >= 1 ? Math.min(10, Math.floor(value)) : 3;
}

async function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.MAIL_PORT ?? 587);
  const secure = process.env.MAIL_SECURE === "1" || port === 465;
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure,
    pool: true,
    maxConnections: queueConcurrency(),
    maxMessages: 200,
    auth:
      process.env.MAIL_USER && process.env.MAIL_PASS
        ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
        : undefined,
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<MailSendResult> {
  if (!to.trim()) return { ok: false, skipped: true, error: "Destinatário sem e-mail" };
  if (process.env.MAIL_MOCK === "1") return { ok: true, skipped: false };
  if (!mailConfigured()) {
    return { ok: false, skipped: true, error: "E-mail não configurado (MAIL_HOST e MAIL_FROM)" };
  }
  try {
    const mailer = await getTransporter();
    const logoPath = logoFilePath();
    await mailer.sendMail({
      from: mailFrom(),
      to,
      subject,
      text,
      ...(html?.trim() ? { html } : {}),
      attachments:
        html?.trim() && existsSync(logoPath)
          ? [{ filename: "arno_logo.png", path: logoPath, cid: LOGO_CID }]
          : undefined,
    });
    return { ok: true, skipped: false };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : "Falha ao enviar e-mail",
    };
  }
}
