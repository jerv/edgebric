import nodemailer from "nodemailer";
import type { EmailIntegration, Escalation } from "@edgebric/types";

/** Send an escalation notification email. */
export async function sendEscalationEmail(
  emailConfig: EmailIntegration,
  toEmail: string,
  escalation: Escalation,
  conversationUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      secure: emailConfig.useTls,
      auth: {
        user: emailConfig.smtpUser,
        pass: emailConfig.smtpPass,
      },
    });

    const questionExcerpt = escalation.question.length > 60
      ? escalation.question.slice(0, 57) + "..."
      : escalation.question;

    const truncatedAnswer = escalation.aiAnswer.length > 500
      ? escalation.aiAnswer.slice(0, 500) + "..."
      : escalation.aiAnswer;

    const citationsHtml = escalation.sourceCitations
      .slice(0, 3)
      .map((c) => `<li>${c.documentName}${c.pageNumber > 0 ? ` (p. ${c.pageNumber})` : ""}</li>`)
      .join("");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">
          Verification Request
        </h2>

        <div style="margin: 16px 0;">
          <p style="color: #64748b; font-size: 14px; margin-bottom: 4px;">Employee question:</p>
          <blockquote style="margin: 0; padding: 8px 16px; background: #f8fafc; border-left: 3px solid #3b82f6; color: #1e293b;">
            ${escapeHtml(escalation.question)}
          </blockquote>
        </div>

        <div style="margin: 16px 0;">
          <p style="color: #64748b; font-size: 14px; margin-bottom: 4px;">AI answer:</p>
          <div style="padding: 8px 16px; background: #f8fafc; border-radius: 6px; color: #334155;">
            ${escapeHtml(truncatedAnswer)}
          </div>
        </div>

        ${citationsHtml ? `
          <div style="margin: 16px 0;">
            <p style="color: #64748b; font-size: 14px; margin-bottom: 4px;">Sources cited:</p>
            <ul style="color: #334155; padding-left: 20px;">${citationsHtml}</ul>
          </div>
        ` : ""}

        <div style="margin: 24px 0;">
          <a href="${conversationUrl}"
             style="display: inline-block; padding: 10px 20px; background: #1e293b; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
            View Conversation
          </a>
        </div>

        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
          Escalation ${escalation.id} | ${new Date(escalation.createdAt).toISOString()}
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: emailConfig.fromAddress,
      to: toEmail,
      subject: `Verification Request: ${questionExcerpt}`,
      html,
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Email send failed" };
  }
}

/** Test SMTP connection without sending an email. */
export async function testEmailConfig(
  emailConfig: EmailIntegration,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      secure: emailConfig.useTls,
      auth: {
        user: emailConfig.smtpUser,
        pass: emailConfig.smtpPass,
      },
    });

    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SMTP connection failed" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}
