import { Resend } from 'resend';

/**
 * Cliente do Resend criado sob demanda.
 *
 * Instanciar no topo do módulo fazia a falta de RESEND_API_KEY derrubar o
 * servidor inteiro no import — o login parava por causa do e-mail. Aqui a
 * ausência da chave vira um erro tratável de uma rota só.
 */
let resendClient = null;
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resendClient) resendClient = new Resend(key);
  return resendClient;
}
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@playfashcards.com.br';
const RESEND_TEST_FROM = 'Play Flash Cards <onboarding@resend.dev>';

export function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function getCodeExpiration() {
  return new Date(Date.now() + 15 * 60 * 1000);
}

export async function sendVerificationEmail(to, code) {
  const emailPayload = {
    to,
    subject: `${code} — Seu código de verificação`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#06b6d4,#2563eb);padding:32px 24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">🎓 Play Flash Cards</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 24px;">
              <p style="margin:0 0 8px;color:#334155;font-size:18px;font-weight:600;">Verifique seu email</p>
              <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
                Use o código abaixo para concluir seu cadastro. Ele expira em <strong>15 minutos</strong>.
              </p>
              <!-- Code -->
              <div style="background-color:#f8fafc;border:2px dashed #cbd5e1;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
                <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a;">${code}</span>
              </div>
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                Se você não solicitou este código, ignore este email. Sua conta não será criada.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;border-top:1px solid #f1f5f9;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:11px;">
                &copy; ${new Date().getFullYear()} Play Flash Cards — Seu aplicativo de estudo e revisão espaçada
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  };

  const resend = getResend();
  if (!resend) {
    console.error('[email] RESEND_API_KEY ausente — e-mail de verificação não enviado.');
    const e = new Error('Envio de e-mail não configurado no servidor');
    e.status = 503;
    throw e;
  }

  // Tenta com o domínio configurado; se falhar (domínio não verificado), usa o remetente de teste do Resend
  const { error } = await resend.emails.send({
    from: `Play Flash Cards <${EMAIL_FROM}>`,
    ...emailPayload,
  });

  if (error) {
    console.warn('Resend: domínio principal falhou, tentando remetente de teste...', error.message);

    const { error: fallbackError } = await resend.emails.send({
      from: RESEND_TEST_FROM,
      ...emailPayload,
    });

    if (fallbackError) {
      console.error('Resend fallback error:', fallbackError);
      throw new Error('Falha ao enviar email de verificação');
    }
  }
}
