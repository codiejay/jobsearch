import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { getCvPdf, type Profile } from "./store";

/* Sends one application email over SMTP with the CV PDF attached. Gmail
   keeps a copy in Sent. dryRun builds the message and sends nothing. */

function creds() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error("Add SMTP_USER and SMTP_PASS to .env.local, then restart the board.");
  return { user, pass };
}

export async function buildMessage(p: Profile, { to, subject, body }: { to: string; subject: string; body: string }): Promise<Mail.Options> {
  const pdf = await getCvPdf();
  if (!pdf) throw new Error("No CV PDF. Put it at data/cv.pdf (hosted: run jobsearch sync).");
  return {
    from: `${p.name} <${process.env.SMTP_USER || ""}>`,
    to,
    subject,
    text: body,
    attachments: [{ filename: `${p.name} CV.pdf`, content: pdf.bytes }],
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
  // jsonTransport puts the built message on info.message; the types omit it.
  const info = (await transport.sendMail(msg)) as { messageId?: string; message?: string };
  return { messageId: String(info.messageId || ""), message: dryRun ? JSON.parse(String(info.message)) : null };
}
