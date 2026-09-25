import path from "node:path";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { DIR, type Profile } from "./store";

/* Sends one application email over SMTP with the CV PDF attached. Gmail
   keeps a copy in Sent. dryRun builds the message and sends nothing. */

function creds() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error("Add SMTP_USER and SMTP_PASS to .env.local, then restart the board.");
  return { user, pass };
}

export function buildMessage(p: Profile, { to, subject, body }: { to: string; subject: string; body: string }): Mail.Options {
  const cv = String(p.cvFile || "cv.pdf");
  return {
    from: `${p.name} <${process.env.SMTP_USER || ""}>`,
    to,
    subject,
    text: body,
    attachments: [{ filename: `${p.name} CV.pdf`, path: path.join(DIR, cv) }],
  };
}

export async function sendMail(msg: Mail.Options, { dryRun }: { dryRun: boolean }) {
  const transport = dryRun
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: creds(),
      });
  const info = await transport.sendMail(msg);
  return { messageId: String(info.messageId || ""), message: dryRun ? JSON.parse(String(info.message)) : null };
}
