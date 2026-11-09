import 'server-only';

/**
 * Delivery channels for the notification outbox (table `notification_deliveries`).
 * Email works today via Resend. SMS / WhatsApp are wired as stubs: add a provider
 * (e.g. Twilio) here and start inserting 'sms' / 'whatsapp' rows in notify().
 */
export type Delivery = { id: string; channel: 'email' | 'sms' | 'whatsapp'; destination: string };
export type Message = { title: string; body: string | null; link: string | null };

export interface Channel {
  configured(): boolean;
  send(to: string, msg: Message): Promise<void>;
}

const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const email: Channel = {
  configured: () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  async send(to, msg) {
    const url = msg.link ? `${site()}${msg.link}` : site();
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject: msg.title,
        text: `${msg.title}\n\n${msg.body ?? ''}\n\nOpen: ${url}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;color:#23272a">
          <p style="letter-spacing:.15em;color:#44583b;font-size:12px;margin:0 0 16px">HERITAGE HOUSEKEEPERS</p>
          <h2 style="font-size:18px;margin:0 0 8px">${esc(msg.title)}</h2>
          ${msg.body ? `<p style="font-size:15px;line-height:1.5;margin:0 0 20px">${esc(msg.body)}</p>` : ''}
          <a href="${esc(url)}" style="display:inline-block;background:#44583b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Open Operations Hub</a>
          <p style="font-size:12px;color:#888;margin-top:24px">You can turn off email notifications in your profile.</p></div>`,
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  },
};

export const sms: Channel = {
  configured: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
  async send(to, msg) {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: `${msg.title}${msg.body ? ' — ' + msg.body : ''}` }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}`);
  },
};

// WhatsApp via Twilio uses the same API with "whatsapp:" prefixed numbers.
export const whatsapp: Channel = {
  configured: sms.configured,
  send: (to, msg) => sms.send(to.startsWith('whatsapp:') ? to : `whatsapp:${to}`, msg),
};

export const CHANNELS: Record<Delivery['channel'], Channel> = { email, sms, whatsapp };
